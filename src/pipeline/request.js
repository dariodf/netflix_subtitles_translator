import { PROVIDERS } from '../core/providers/definitions.js';
import { sleep, logInfo, logWarn, logError } from '../core/utils.js';
import { parseTranslationResponse } from '../core/request-parser.js';
import { buildSystemPrompt, buildUserMessage, buildPrevContext, buildGlossaryPerChunkBlock } from '../core/prompts.js';

/**
 * Build the full URL for an LLM provider request.
 * Handles Ollama special URL construction and urlSuffix from buildRequest.
 */
export function buildProviderUrl(provider, providerKey, config, providerUrl) {
  const localUrl = config.localUrl?.replace(/\/+$/, '');
  let url;
  if (providerKey === 'ollama') {
    url = providerUrl || (localUrl || 'http://localhost:11434') + '/api/chat';
  } else if (providerKey === 'lmstudio') {
    url = providerUrl || (localUrl || 'http://localhost:1234') + '/v1/chat/completions';
  } else {
    url = providerUrl || (localUrl || null) || provider.url;
  }
  // buildRequest may produce a urlSuffix (e.g. Gemini API key in path)
  const req = provider.buildRequest('', '', config.model, config.apiKey);
  if (req.urlSuffix) url = url + req.urlSuffix;
  return url;
}

/**
 * Send a single request to an LLM provider. Returns { status, data, text }.
 * text is null for non-2xx responses.
 */
export async function sendProviderRequest(context, { provider, providerKey, model, apiKey, system, userMessage, timeout, providerUrl }) {
  const url = buildProviderUrl(provider, providerKey, context.config, providerUrl);
  const requestData = provider.buildRequest(system, userMessage, model, apiKey);
  const { status, data } = await context.postJson(url, requestData.headers, requestData.data, timeout);
  const text = (status >= 200 && status < 300) ? provider.extractText(data) : null;
  return { status, data, text };
}

// Core LLM request: sends a prompt to the configured provider and parses the [N] response.
export async function _sendLLMRequest(cues, scriptLines, { retryNote = '', prevTranslations = '', providerOverride = null } = {}, context) {
  const config = context.config;
  const glossary = context.glossary;
  const providerKey = providerOverride?.provider || config.provider;
  const providerModel = providerOverride?.model || config.model;
  const providerApiKey = providerOverride?.apiKey || config.apiKey;
  const provider = PROVIDERS[providerKey];
  const lineCount = cues.length;

  const metadata = context.showMetadata;
  const system = buildSystemPrompt(config, metadata);
  const glossaryBlock = config.glossaryPerChunk ? buildGlossaryPerChunkBlock(glossary.buildContextBlock()) : '';
  const userMsg = buildUserMessage(lineCount, scriptLines, { retryNote, prevTranslations, glossaryBlock, targetLang: config.targetLang });

  const url = buildProviderUrl(provider, providerKey, config, providerOverride?.providerUrl);
  const req = provider.buildRequest(system, userMsg, providerModel, providerApiKey);
  if (config.extraBody) {
    const parsed = JSON.parse(req.data);
    req.data = JSON.stringify({ ...parsed, ...config.extraBody });
  }
  const isRetry = retryNote.length > 0;
  const modelLabel = providerOverride ? `${providerModel} (2nd)` : providerModel;
  const passLabel = context.sharedTranslationState.translationPassLabel ? ` [${context.sharedTranslationState.translationPassLabel}]` : '';

  logInfo(`🌐 ${isRetry ? 'Retry' : 'Sending'} ${lineCount} lines → ${modelLabel}${passLabel}`);

  const MAX_RETRIES = 3;
  const fallback = cues.map(c => c.text);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      let resp;
      try {
        resp = await context.postJson(url, req.headers, req.data, 300000);
      } catch (fetchErr) {
        if (fetchErr.message === 'Network error') throw { type: 'network', err: fetchErr };
        if (fetchErr.message === 'Request timed out') throw { type: 'timeout' };
        // Parse error — fall back to originals
        logError('LLM parse error:', fetchErr.message);
        return fallback;
      }

      const { status, data } = resp;

      // Gemini returns RESOURCE_EXHAUSTED for both per-minute (RPM) and daily (RPD) limits.
      // Daily quota messages contain "exceeded your current quota" or "free_tier_requests".
      // We differentiate to avoid showing alarming "quota exceeded" banners for normal RPM throttling.
      if (status === 429 || data.error?.status === 'RESOURCE_EXHAUSTED' || data.error?.code === 429) {
        const errorMessage = data.error?.message || '';
        const isDailyQuota = /exceeded your current quota|free_tier_requests|requests_per_day/i.test(errorMessage);
        throw { type: 'rate_limit', status: data.error?.code || status, isDailyQuota, errorMessage };
      }
      if (status === 503) throw { type: 'rate_limit', status: 503 };
      if (status >= 500) throw { type: 'server_error', status };

      const text = provider.extractText(data);

      // Capture request/response for debugging (opt-in via config.debugLog)
      if (config.debugLog && context.sharedTranslationState.debugLog) {
        context.sharedTranslationState.debugLog.push({
          timestamp: new Date().toISOString(),
          model: modelLabel,
          passLabel: passLabel.trim().replace(/^\[|\]$/g, '') || null,
          isRetry,
          lineCount,
          systemPrompt: system,
          userMessage: userMsg,
          responseText: text,
        });
      }

      if (config.glossaryPerChunk) {
        const termsBefore = glossary.terms.size;
        glossary.extractFromResponse(text);
        if (glossary.terms.size > termsBefore) {
          logInfo(`📖 Glossary: ${glossary.terms.size} terms (+${glossary.terms.size - termsBefore} new)`);
        }
      }
      return parseTranslationResponse(config.glossaryPerChunk ? glossary.stripFromResponse(text) : text, cues);
    } catch (err) {
      const isLast = attempt === MAX_RETRIES;
      let waitMs;
      if (err.type === 'rate_limit' || err.type === 'server_error') {
        // Wait 60s to clear provider per-minute request limits (e.g. Gemini RPM)
        waitMs = 60000;
        if (err.type === 'rate_limit') {
          if (err.isDailyQuota) {
            logWarn(`🚫 Daily quota exhausted (${err.status}) — ${err.errorMessage || 'limit reached'}`);
            context.reportRateLimit(PROVIDERS[providerKey]?.name || providerKey);
            return fallback;
          }
          logWarn(`⏳ Rate limited (${err.status}) — waiting 60s before retry ${attempt + 1}/${MAX_RETRIES}`);
          context.reportStatus('Rate limited — waiting 60s...', 'working');
        } else {
          logWarn(`⚠️ Server error (${err.status}) — retry ${attempt + 1}/${MAX_RETRIES} in 60s`);
        }
      } else if (err.type === 'network') {
        waitMs = 5000;
        logError(`❌ Network error — retry ${attempt + 1}/${MAX_RETRIES} in 5s`);
      } else if (err.type === 'timeout') {
        waitMs = 2000;
        logError(`⏱️ Request timed out (model: ${modelLabel}, ${lineCount} lines)`);
        if (isLast) context.reportStatus('LLM request timed out — try a smaller chunk size or faster model', 'error');
      } else {
        // Provider/parse errors (e.g. invalid model, auth failure)
        waitMs = 0;
        logWarn(`⚠️ Request error: ${err.message}`);
      }
      if (isLast) {
        logError(`❌ All ${MAX_RETRIES} retries exhausted — last error: ${err.message}`);
        return fallback;
      }
      if (waitMs) await sleep(waitMs);
    }
  }
  return fallback;
}

// Translate a chunk with pre-built script lines (used by retry and final sweep)
export async function _callLLMTranslateRaw(cues, scriptLines, retryNote = '', providerOverride = null, context) {
  return _sendLLMRequest(cues, scriptLines, { retryNote, providerOverride }, context);
}

// Translate a chunk: builds script lines from cues, adds context, delegates to _sendLLMRequest
export async function _callLLMTranslate(chunkCues, prevContext, retryNote = '', providerOverride = null, context) {
  const scriptLines = chunkCues.map((c, i) => `[${i}] ${c.text}`);
  const prevTranslations = buildPrevContext(prevContext);
  return _sendLLMRequest(chunkCues, scriptLines, { retryNote, prevTranslations, providerOverride }, context);
}
