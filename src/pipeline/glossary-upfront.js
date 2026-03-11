import { PROVIDERS } from '../core/providers/definitions.js';
import { logInfo, logWarn } from '../core/utils.js';
import { buildGlossarySystemPrompt, buildGlossaryUserMessage, buildMetadataPrompt } from '../core/prompts.js';
import { buildProviderUrl } from './request.js';

// ============================
// UPFRONT GLOSSARY
// ============================
export async function buildUpfrontGlossary(cues, context, providerOverride = null) {
  const glossary = context.glossary;
  const config = context.config;
  if (cues.length === 0) return;

  const glossaryStartTime = Date.now();
  const providerKey = providerOverride?.provider || config.provider;
  const providerModel = providerOverride?.model || config.model;
  const providerApiKey = providerOverride?.apiKey || config.apiKey;
  const provider = PROVIDERS[providerKey];

  if (!provider || provider.type !== 'llm') return;
  if (provider.needsKey && !providerApiKey) return;

  const allText = cues.map(c => c.text).join('\n');
  const charCount = allText.length;
  const tokenEstimate = Math.ceil(charCount / 3);

  logInfo(`📖 Upfront glossary: sending ${cues.length} lines (~${tokenEstimate} tokens) to ${provider.name}/${providerModel}`);
  context.reportStatus('Scanning script for glossary...', 'working');

  const system = buildGlossarySystemPrompt();
  const showCtx = buildMetadataPrompt(config, context.showMetadata);
  const userMsg = buildGlossaryUserMessage(allText, showCtx, config);

  const req = provider.buildRequest(system, userMsg, providerModel, providerApiKey);
  // Pass override-resolved model/apiKey so URL suffix (e.g. Gemini key-in-path) is correct
  const url = buildProviderUrl(provider, providerKey, { ...config, model: providerModel, apiKey: providerApiKey });

  try {
    const { status, data } = await context.postJson(url, req.headers, req.data, 120000);
    if (status === 429) throw new Error('Rate limited');
    const responseText = provider.extractText(data);

    let termCount = 0;
    const lines = responseText.split('\n');
    for (const rawLine of lines) {
      // Strip leading numbering, bullets, dashes
      const line = rawLine.replace(/^\s*[\d]+[.)]\s*/, '').replace(/^\s*[-•*]\s*/, '');
      // Support both = and → as separators
      const match = line.match(/^(.+?)\s*(?:=|→)\s*(.+)$/);
      if (!match) continue;
      const source = match[1].trim();
      const translated = match[2].trim();
      if (!source || !translated || source.length > 50 || translated.length > 80) continue;

      const key = source.toLowerCase();
      if (!glossary.terms.has(key)) {
        glossary.terms.set(key, { source, translated, count: 5 });
        termCount++;
      }
    }

    const elapsedMs = Date.now() - glossaryStartTime;
    const elapsed = (elapsedMs / 1000).toFixed(1);
    logInfo(`📖 Upfront glossary: ${termCount} terms extracted in ${elapsed}s via ${provider.name}/${providerModel} (${cues.length} lines, ~${tokenEstimate} tok)`);
    if (termCount > 0) {
      context.reportStatus(`Glossary: ${termCount} terms (${elapsed}s)`, 'success');
    } else {
      logWarn('📖 Upfront glossary: no terms found in response');
    }
    return elapsedMs;

  } catch (err) {
    const elapsedMs = Date.now() - glossaryStartTime;
    const elapsed = (elapsedMs / 1000).toFixed(1);
    logWarn(`📖 Upfront glossary failed after ${elapsed}s: ${err.message}`);
    context.reportStatus('Glossary scan failed, continuing without', 'error');
    return elapsedMs;
  }
}
