import { PROVIDERS, codeToLanguage } from '../core/providers/definitions.js';
import { parseTTML, simpleHash } from '../core/parser.js';
import { makeCue, logInfo, logWarn, logError } from '../core/utils.js';
import { translateWithLLM } from './translate.js';
import { translateWithSimple } from './translate-simple.js';
import { buildUpfrontGlossary } from './glossary-upfront.js';
import { runCleanupPass, runFullPass } from './cleanup.js';
import { buildSystemPrompt } from '../core/prompts.js';
import { sendProviderRequest } from './request.js';
import { fetchAllMetadata } from '../core/metadata.js';
import { fetchAnilistCharacters, buildCharacterNameMap, buildNameResolutionPrompt, parseNameResolutionResponse } from '../core/anilist.js';
import { extractUniqueSpeakerLabels, extractLeadingSpeakerLabel, replaceSpeakerLabels, normalizeSpeakerNames, pickCanonicalName } from '../core/speaker-labels.js';

// ============================
// CORE TRANSLATION PIPELINE
// ============================

export function buildCacheKey(config, cues) {
  return (config.targetLang || '') + ':' + simpleHash(cues.map(c => c.text).join('|'));
}

/**
 * Shared translation pipeline: parse TTML → enrich → translate → second pass.
 * Used by both browser (handleSubtitlePayload) and headless (translateTtml).
 * Owns TTML parsing, language detection, metadata enrichment, caching, and translation.
 *
 * @param {string} xml - Raw TTML/XML subtitle payload
 * @param {Object} context - Translation context (DI)
 * @param {Object} [options]
 * @param {number|null} [options.startTime] - External start time for TTFC measurement
 * @returns {{ cached: boolean, skipped: boolean, cues: Array }}
 */
async function runTranslationPipeline(xml, context, { startTime = null } = {}) {
  const config = context.config;
  const sharedTranslationState = context.sharedTranslationState;
  const provider = PROVIDERS[config.provider];

  // Warn about common misconfigurations
  if (config.sourceLang && config.sourceLang.toLowerCase() === config.targetLang.toLowerCase()) {
    logWarn('⚠️ Source and target language are the same — translation will have no effect');
  }
  if (config.glossaryPerChunk && config.glossaryUpfront) {
    logWarn('⚠️ Both glossaryPerChunk and glossaryUpfront are enabled — upfront glossary already covers per-chunk extraction');
  }
  if (config.secondEnabled && config.secondProvider === config.provider && config.secondModel === config.model) {
    logWarn('⚠️ Second model is identical to first model — cleanup pass will produce similar results');
  }

  // Validate provider
  if (!provider) {
    context.reportStatus(`Unknown provider: ${config.provider}`, 'error');
    throw new Error(`Unknown provider: ${config.provider}`);
  }
  if (provider.needsKey && !config.apiKey) {
    context.reportStatus(`No API key set for ${provider.name}. Press Shift+T to configure.`, 'error');
    throw new Error(`No API key set for ${provider.name}`);
  }

  // Parse TTML
  const parsed = parseTTML(xml);
  let cues = parsed.cues;
  if (parsed.meta && context.onTtmlMetadata) context.onTtmlMetadata(parsed.meta);

  if (cues.length === 0) {
    return { cached: false, skipped: true, cues: [] };
  }

  // Skip if same subtitle data already translated
  if (sharedTranslationState.originalCues && sharedTranslationState.translatedCues.length > 0) {
    const newHash = simpleHash(cues.map(c => c.text).join('|'));
    const oldHash = simpleHash(sharedTranslationState.originalCues.map(c => c.text).join('|'));
    if (newHash === oldHash) {
      logInfo('⏭️ Same subtitle data, already translated');
      return { cached: true, skipped: false, cues };
    }
  }

  const cacheKey = buildCacheKey(config, cues);
  sharedTranslationState.originalCues = cues;
  sharedTranslationState.activeCacheKey = cacheKey;
  context.glossary.clear();

  // Detect source language from TTML xml:lang
  const ttmlLang = parsed.meta?.lang || '';
  if (!config.sourceLang && ttmlLang) {
    const detected = codeToLanguage(ttmlLang);
    if (detected) {
      config.sourceLang = detected;
      logInfo(`🌐 Source language (from TTML): ${detected}`);
    }
  }

  // Skip if subtitles appear to already be in target language
  if (!config.sourceLang) {
    const sampleText = cues.slice(0, 10).map(c => c.text).join(' ');
    const targetLower = config.targetLang.toLowerCase();
    const LATIN_LANGS = ['english', 'french', 'spanish', 'german', 'italian', 'portuguese', 'dutch', 'polish', 'swedish', 'danish', 'norwegian', 'finnish', 'czech', 'romanian', 'hungarian', 'turkish', 'indonesian', 'vietnamese', 'malay', 'tagalog'];
    const isTargetLatin = LATIN_LANGS.some(l => targetLower.includes(l));
    const latinChars = (sampleText.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
    const isSourceLatin = latinChars / Math.max(sampleText.length, 1) > 0.7;
    if (isTargetLatin && isSourceLatin) {
      logInfo('⏭️ Subtitles appear to already be in a Latin-script language matching target, skipping. Set Source Language to override.');
      context.reportStatus('Subtitles appear to already be in target language', 'success');
      return { cached: false, skipped: true, cues };
    }
  }

  // Await show metadata (Netflix metadata in browser, file metadata in headless)
  if (config.showMetadata && context.fetchShowMetadata) {
    await context.fetchShowMetadata();
  }

  // Fire enrichment in background — translation starts immediately.
  // buildSystemPrompt is called per-chunk and reads live metadata,
  // so later chunks automatically benefit from enriched context.
  const enrichmentPromise = _enrichMetadataInBackground(context.showMetadata, config, context, cues, provider);

  // Restore flagged lines from URL cache (browser has pathname, headless returns '')
  const urlCached = context.cacheGet('url:' + (context.locationPathname || ''));
  if (urlCached?.flaggedLines && sharedTranslationState.flaggedLines.size === 0) {
    sharedTranslationState.flaggedLines = new Set(urlCached.flaggedLines);
  }

  // Full cache hit
  const cached = context.cacheGet(cacheKey);
  if (cached && cached.length >= cues.length) {
    const timingOk = cached.length === cues.length &&
      Math.abs(cached[0].begin - cues[0].begin) < 100 &&
      Math.abs(cached[cached.length - 1].end - cues[cues.length - 1].end) < 100;
    if (timingOk) {
      sharedTranslationState.translatedCues = cached;
      context.commitTranslation(cached);
      const flaggedMsg = sharedTranslationState.flaggedLines.size > 0 ? ` (${sharedTranslationState.flaggedLines.size} flagged)` : '';
      logInfo('✅ Cached (' + cached.length + ' lines)' + flaggedMsg);
      context.reportStatus('Using cached translation' + flaggedMsg, 'success');
      return { cached: true, skipped: false, cues };
    }
    logInfo('⚠️ Cache timing mismatch, retranslating');
  }

  // Partial cache — resume
  let resumeFromLine = 0;
  if (cached && Array.isArray(cached) && cached.length > 0 && cached.length < cues.length) {
    const partialOk = Math.abs(cached[0].begin - cues[0].begin) < 100;
    if (partialOk) {
      sharedTranslationState.translatedCues = cached;
      resumeFromLine = cached.length;
      context.commitTranslation(cached);
      logInfo('📦 Resuming from cache (' + cached.length + '/' + cues.length + ', ' + sharedTranslationState.flaggedLines.size + ' flagged)');
    } else {
      logInfo('⚠️ Partial cache timing mismatch, starting fresh');
    }
  }

  // Initialize translated cues with originals if not populated by partial cache
  if (sharedTranslationState.translatedCues.length === 0 || resumeFromLine === 0 && !cached) {
    sharedTranslationState.translatedCues = cues.map(c => makeCue(c, c.text));
  }
  context.commitTranslation(sharedTranslationState.translatedCues);

  // Feed canonical speaker names into the system prompt as chunks accumulate.
  // After each commit, we scan source↔translated pairs to find the most frequent
  // romanization for each source label, then set it on characterNameMap so
  // buildSystemPrompt includes it in the next chunk's prompt.
  const speakerFrequencies = new Map();
  const preExistingNames = new Set(context.showMetadata?.characterNameMap?.keys() || []);
  let speakerProcessedUpTo = 0;
  const changedLabels = new Set();
  const originalCommitTranslation = context.commitTranslation;
  context.commitTranslation = (translatedArray, ...args) => {
    changedLabels.clear();
    for (let i = speakerProcessedUpTo; i < translatedArray.length; i++) {
      if (!translatedArray[i] || translatedArray[i].text === cues[i]?.text) continue;
      const sourceLabel = extractLeadingSpeakerLabel(cues[i]?.text);
      if (!sourceLabel) continue;
      const translatedLabel = extractLeadingSpeakerLabel(translatedArray[i].text);
      if (!translatedLabel) continue;
      if (!speakerFrequencies.has(sourceLabel)) speakerFrequencies.set(sourceLabel, new Map());
      const counts = speakerFrequencies.get(sourceLabel);
      counts.set(translatedLabel, (counts.get(translatedLabel) || 0) + 1);
      changedLabels.add(sourceLabel);
    }
    speakerProcessedUpTo = translatedArray.length;

    // Update characterNameMap only for labels whose counts changed this commit
    if (changedLabels.size > 0 && context.showMetadata) {
      if (!context.showMetadata.characterNameMap) context.showMetadata.characterNameMap = new Map();
      const castCharacters = (context.showMetadata.cast || []).filter(c => c.character).map(c => c.character);
      for (const sourceLabel of changedLabels) {
        if (preExistingNames.has(sourceLabel)) continue;
        const best = pickCanonicalName(speakerFrequencies.get(sourceLabel), castCharacters);
        if (best) context.showMetadata.characterNameMap.set(sourceLabel, best);
      }
    }

    originalCommitTranslation(translatedArray, ...args);
  };

  logInfo(`🚀 Translating ${cues.length} lines (${Math.ceil(cues.length / config.chunkSize)} chunks of ${config.chunkSize})`);
  context.reportStatus(`Translating ${cues.length} lines via ${provider.name}...`, 'working');

  // Translate
  let translated;
  let glossaryPromise = null;
  if (provider.type === 'llm') {
    if (config.glossaryUpfront) {
      // Fire glossary async — terms populate context.glossary as they arrive,
      // chunks starting after completion benefit automatically
      glossaryPromise = buildUpfrontGlossary(cues, context).then(ms => {
        sharedTranslationState.glossaryElapsedMs = ms || 0;
      });
    }
    translated = await translateWithLLM(cues, cacheKey, resumeFromLine, context, null, startTime);
  } else {
    translated = await translateWithSimple(cues, context);
  }
  if (glossaryPromise) await glossaryPromise;
  if (enrichmentPromise) await enrichmentPromise;
  context.commitTranslation = originalCommitTranslation;

  // Normalize speaker names across chunks (e.g., "Seok-ryu" vs "Seokryu")
  const { normalizedCount } = normalizeSpeakerNames(cues, translated, context.showMetadata?.cast);
  if (normalizedCount > 0) {
    logInfo(`🎬 Normalized ${normalizedCount} speaker name variants`);
  }

  // Capture system prompt for debugging (after enrichment is complete)
  const systemPrompt = provider.type === 'llm' ? buildSystemPrompt(config, context.showMetadata) : null;

  sharedTranslationState.translatedCues = translated;
  context.cacheSetWithUrl(cacheKey, translated, cues);

  // Second model pass
  if (config.secondEnabled && provider.type === 'llm') {
    const override = context.getSecondProviderOverride();
    if (override) {
      if (config.glossaryUpfrontSecond) {
        context.glossary.clear();
        await buildUpfrontGlossary(cues, context, override);
      }
      if (config.fullPassEnabled) {
        const startChunk = _getChunkStartForVideoPosition(cues, config.secondChunkSize, config.chunkOverlap, context);
        await runFullPass(cues, cacheKey, startChunk, context, override);
      } else if (sharedTranslationState.flaggedLines.size > 0) {
        logInfo(`🧹 ${sharedTranslationState.flaggedLines.size} flagged → cleanup via ${PROVIDERS[config.secondProvider].name}/${config.secondModel}`);
        await runCleanupPass(cues, translated, context, override);
      }
      context.cacheSetWithUrl(cacheKey, sharedTranslationState.translatedCues, cues);
    } else {
      logInfo('⏭️ Second model skipped — no valid provider/key');
    }
  }

  return { cached: false, skipped: false, cues, systemPrompt, normalizedCount };
}

// ============================
// BACKGROUND METADATA ENRICHMENT
// ============================

/**
 * Enrich metadata in the background while translation proceeds.
 * Updates context.showMetadata in-place — buildSystemPrompt reads it per-chunk,
 * so later chunks automatically get richer context.
 * Mutates cues in-place for speaker label replacement so future chunks benefit.
 */
async function _enrichMetadataInBackground(metadata, config, context, cues, provider) {
  if (!metadata?.title || metadata.metadataEnriched) return;
  await _applyProviderMetadata(metadata, context.fetchJson);
  _applySourceLanguageFallback(config, metadata);
  await _resolveCharacterNames(metadata, config, cues, context, provider);
  _applyResolvedSpeakerLabels(cues, config, metadata);
}

/** Fetch and merge metadata from Cinemeta + TVMaze. */
async function _applyProviderMetadata(metadata, fetchJson) {
  const contentType = metadata.type === 'series' ? 'series' : 'movie';
  const fetched = await fetchAllMetadata(metadata.title, contentType, fetchJson);

  if (fetched.sources.length > 0) {
    if (fetched.genre.length > 0 && !metadata.genre?.length) metadata.genre = fetched.genre;
    if (fetched.year && !metadata.year) metadata.year = fetched.year;
    if (!metadata.country && fetched.country) metadata.country = fetched.country;
    if (!metadata.language && fetched.language) metadata.language = fetched.language;
    metadata.cast = fetched.cast;
    metadata.hasCharacterNames = fetched.hasCharacterNames;

    metadata.metadataSources = fetched.sources;
    const castCount = fetched.cast.filter(c => c.character).length;
    logInfo(`🎬 ${fetched.sources.join(' + ')}: ${fetched.cast.length} cast${castCount > 0 ? ` (${castCount} with character names)` : ''}`);
  }

  metadata.metadataEnriched = true;
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('st-metadata-updated'));
  }
}

/** Set source language from metadata if not already configured. */
function _applySourceLanguageFallback(config, metadata) {
  if (!config.sourceLang && metadata.language) {
    const primaryLanguage = metadata.language.split(',')[0].trim();
    if (primaryLanguage) {
      config.sourceLang = primaryLanguage;
      logInfo(`🌐 Source language (from metadata): ${primaryLanguage}`);
    }
  }
}

/** Resolve character names via AniList + LLM fallback, set characterNameMap. */
async function _resolveCharacterNames(metadata, config, cues, context, provider) {
  if (!config.anilistNames || !metadata.title || metadata.characterNameMap) return;

  const labels = extractUniqueSpeakerLabels(cues);
  if (labels.length === 0) return;

  if (!metadata.anilistCharacters) {
    try {
      const characters = await fetchAnilistCharacters(metadata.title, context.postJson);
      if (characters.length > 0) {
        metadata.anilistCharacters = characters;
      }
    } catch (err) {
      logWarn('🎬 AniList fetch failed:', err.message);
    }
  }

  const anilistChars = metadata.anilistCharacters || [];
  const { matched, unmatched } = buildCharacterNameMap(labels, anilistChars);

  // LLM fallback for unmatched labels
  if (unmatched.length > 0 && provider?.type === 'llm') {
    try {
      const { system, user } = buildNameResolutionPrompt(unmatched, metadata.title, config.sourceLang, metadata.cast);
      const { text: responseText } = await sendProviderRequest(context, {
        provider, providerKey: config.provider, model: config.model, apiKey: config.apiKey,
        system, userMessage: user, timeout: 30000,
      });
      const llmNames = parseNameResolutionResponse(responseText || '');
      for (const [source, english] of llmNames) {
        matched.set(source, english);
      }
      if (llmNames.size > 0) {
        logInfo(`🎬 AniList: ${matched.size - llmNames.size} matched, ${llmNames.size} via LLM fallback`);
      }
    } catch (err) {
      logWarn('🎬 LLM name resolution failed:', err.message);
    }
  }

  if (matched.size > 0) {
    metadata.characterNameMap = matched;
    logInfo(`🎬 AniList: ${matched.size} speaker names resolved`);
  }
}

/** Replace speaker labels in cues in-place so future chunks benefit. */
function _applyResolvedSpeakerLabels(cues, config, metadata) {
  if (config.replaceCharacterNames && metadata.characterNameMap) {
    const replaced = replaceSpeakerLabels(cues, metadata.characterNameMap);
    for (let i = 0; i < cues.length; i++) {
      cues[i] = replaced[i];
    }
  }
}

// ============================
// BROWSER ENTRY POINT
// ============================
export async function handleSubtitlePayload(xml, url, context) {
  const sharedTranslationState = context.sharedTranslationState;

  if (sharedTranslationState.isTranslating) {
    logInfo('⏭️ Already translating, skipping new subtitle data');
    return;
  }
  // Skip if we already processed this exact URL
  if (url && url === handleSubtitlePayload._lastUrl) {
    return;
  }
  handleSubtitlePayload._lastUrl = url;
  logInfo(`📥 Received subtitle payload (${xml.length} chars)`);

  sharedTranslationState.isTranslating = true;
  const translationStartTime = Date.now();

  try {
    const { cached, skipped, cues } = await runTranslationPipeline(xml, context, { startTime: translationStartTime });
    if (!cached && !skipped) {
      const provider = PROVIDERS[context.config.provider];
      logInfo(`✅ Translation complete! ${cues.length} lines in ${((Date.now() - translationStartTime) / 1000).toFixed(1)}s (${sharedTranslationState.flaggedLines.size} flagged)`);
      context.reportStatus(`Done! ${cues.length} lines via ${provider?.name || context.config.provider}`, 'success');
      if (sharedTranslationState.flaggedLines.size > 0) {
        logInfo(`🚩 ${sharedTranslationState.flaggedLines.size} lines still flagged after all passes`);
      }
    }
  } catch (err) {
    logError(`❌ Translation failed after ${((Date.now() - translationStartTime) / 1000).toFixed(1)}s:`, err);
    context.reportStatus(`Translation failed: ${err.message}`, 'error');
  }

  sharedTranslationState.isTranslating = false;
  context.commitTranslation(sharedTranslationState.translatedCues);
}
handleSubtitlePayload._lastUrl = null;

// ============================
// HEADLESS ENTRY POINT
// ============================
export async function translateTtml(xml, context) {
  const sharedTranslationState = context.sharedTranslationState;

  sharedTranslationState.isTranslating = true;

  try {
    const { cached, skipped, cues, systemPrompt, normalizedCount } = await runTranslationPipeline(xml, context);
    return {
      originalCues: cues,
      translatedCues: sharedTranslationState.translatedCues,
      flaggedLines: new Set(sharedTranslationState.flaggedLines),
      flagReasons: new Map(sharedTranslationState.flagReasons || []),
      glossaryTerms: new Map(context.glossary.terms),
      firstChunkMetrics: cached ? null : (sharedTranslationState.firstChunkMetrics || null),
      glossaryElapsedMs: cached ? 0 : (sharedTranslationState.glossaryElapsedMs || 0),
      systemPrompt: systemPrompt || null,
      skipped: skipped || false,
      debugLog: sharedTranslationState.debugLog || [],
      normalizedSpeakerNames: normalizedCount || 0,
    };
  } finally {
    sharedTranslationState.isTranslating = false;
  }
}

function _getChunkStartForVideoPosition(cues, chunkSize, chunkOverlap, context) {
  const currentMs = context.getVideoPositionMs() || 0;
  const step = chunkSize - chunkOverlap;
  let startChunk = 0;
  for (let ci = 0; ci < cues.length; ci++) {
    if (cues[ci].begin >= currentMs) {
      startChunk = Math.floor(ci / step);
      break;
    }
  }
  return startChunk;
}
