import { PROVIDERS } from '../core/providers/definitions.js';
import { makeCue, logInfo } from '../core/utils.js';
import { validateTranslation } from '../core/validation.js';
import { buildCleanupRetryNote } from '../core/prompts.js';
import { _callLLMTranslate } from './request.js';

// ============================
// CLEANUP PASS (second model, flagged lines only)
// ============================
export async function runCleanupPass(cues, translated, context, providerOverride) {
  if (!providerOverride) return;
  const config = context.config;
  const sharedTranslationState = context.sharedTranslationState;
  const flaggedArr = [...sharedTranslationState.flaggedLines].sort((a, b) => a - b);
  const secondProviderDef = PROVIDERS[config.secondProvider];
  logInfo(`🧹 Cleanup: ${flaggedArr.length} flagged → ${secondProviderDef.name}/${config.secondModel}`);
  context.reportStatus(`Cleanup: ${flaggedArr.length} lines via ${secondProviderDef.name}...`, 'working');

  const CLEANUP_BATCH = config.secondChunkSize;
  let fixed = 0;
  const cleanupStartTime = Date.now();

  for (let b = 0; b < flaggedArr.length; b += CLEANUP_BATCH) {
    const batchIndices = flaggedArr.slice(b, b + CLEANUP_BATCH);
    const miniCues = batchIndices.map(idx => cues[idx]);

    const firstIdx = batchIndices[0];
    const prevCtx = [];
    for (let c = Math.max(0, firstIdx - config.prevContextLines); c < firstIdx; c++) {
      if (translated[c] && translated[c].text !== cues[c].text) {
        prevCtx.push({ text: translated[c].text });
      }
    }

    context.reportStatus(`Cleanup batch ${Math.floor(b / CLEANUP_BATCH) + 1}/${Math.ceil(flaggedArr.length / CLEANUP_BATCH)} via ${secondProviderDef.name}...`, 'working');

    sharedTranslationState.translationPassLabel = `Cleanup ${Math.floor(b / CLEANUP_BATCH) + 1}/${Math.ceil(flaggedArr.length / CLEANUP_BATCH)}`;
    const results = await _callLLMTranslate(miniCues, prevCtx, buildCleanupRetryNote(config.targetLang), providerOverride, context);

    for (let r = 0; r < results.length; r++) {
      const globalIdx = batchIndices[r];
      if (results[r] && results[r] !== cues[globalIdx].text) {
        sharedTranslationState.translatedCues[globalIdx] = makeCue(cues[globalIdx], results[r]);
        translated[globalIdx] = sharedTranslationState.translatedCues[globalIdx];
        sharedTranslationState.flaggedLines.delete(globalIdx);
        sharedTranslationState.flagReasons?.delete(globalIdx);
        fixed++;
      }
    }
  }

  logInfo(`🧹 Cleanup fixed ${fixed}/${flaggedArr.length} lines in ${((Date.now() - cleanupStartTime) / 1000).toFixed(1)}s (${sharedTranslationState.flaggedLines.size} still flagged)`);
  context.reportStatus(`Cleanup done: fixed ${fixed}/${flaggedArr.length} lines` + (sharedTranslationState.flaggedLines.size > 0 ? ` (${sharedTranslationState.flaggedLines.size} remain)` : ''), 'success');
}

// ============================
// FULL PASS (secondary model, retranslate everything in background)
// ============================
export async function runFullPass(cues, cacheKey, startFromChunk = 0, context, providerOverride, resumeOrder = null) {
  if (!providerOverride) return;
  const config = context.config;
  const sharedTranslationState = context.sharedTranslationState;
  const secondProviderDef = PROVIDERS[config.secondProvider];

  const chunkSize = config.secondChunkSize;
  const chunkOverlap = config.chunkOverlap;
  const step = chunkSize - chunkOverlap;
  const totalChunks = Math.ceil(cues.length / step);

  let chunkOrder;
  if (resumeOrder && Array.isArray(resumeOrder)) {
    chunkOrder = resumeOrder.filter(c => c < totalChunks);
  } else {
    const startIdx = Math.min(startFromChunk, totalChunks - 1);
    chunkOrder = [];
    for (let c = startIdx; c < totalChunks; c++) chunkOrder.push(c);
    for (let c = 0; c < startIdx; c++) chunkOrder.push(c);
  }

  logInfo(`🔄 Full pass: ${cues.length} lines → ${secondProviderDef.name}/${config.secondModel} (${chunkOrder.length} chunks of ${chunkSize})`);
  context.reportStatus(`Full pass: ${cues.length} lines via ${secondProviderDef.name}...`, 'working');

  const fullPassStartTime = Date.now();
  let replaced = 0;
  let processed = 0;

  for (const chunkIdx of chunkOrder) {
    const chunkStart = chunkIdx * step;
    const chunkCues = cues.slice(chunkStart, chunkStart + chunkSize);
    processed++;

    const prevCtx = chunkStart > 0
      ? sharedTranslationState.translatedCues.slice(Math.max(0, chunkStart - config.prevContextLines), chunkStart)
      : [];

    context.reportStatus(`Full pass: ${processed}/${totalChunks} via ${secondProviderDef.name}...`, 'working');

    sharedTranslationState.translationPassLabel = `Full pass ${processed}/${totalChunks}, chunk ${chunkIdx + 1}`;
    const results = await _callLLMTranslate(chunkCues, prevCtx, '', providerOverride, context);

    const startLocal = chunkStart === 0 ? 0 : chunkOverlap;
    for (let j = startLocal; j < results.length; j++) {
      const globalIdx = chunkStart + j;
      if (globalIdx >= cues.length) break;
      if (!results[j] || results[j] === cues[globalIdx].text) continue;
      const check = validateTranslation([cues[globalIdx]], [results[j]], config.targetLang, config.sourceLang);
      if (check.gaps.length === 0) {
        sharedTranslationState.translatedCues[globalIdx] = makeCue(cues[globalIdx], results[j]);
        sharedTranslationState.flaggedLines.delete(globalIdx);
        sharedTranslationState.flagReasons?.delete(globalIdx);
        replaced++;
      }
    }

    logInfo(`🔄 Full pass ${processed}/${totalChunks} (chunk ${chunkIdx + 1}): ${replaced} improved (${sharedTranslationState.flaggedLines.size} flagged)`);
    context.commitTranslation(sharedTranslationState.translatedCues, { cacheKey, originalCues: cues, cacheExtra: processed < totalChunks ? { done: processed, order: chunkOrder.slice(processed) } : undefined });
  }

  sharedTranslationState.translationPassLabel = '';
  logInfo(`✅ Full pass done: ${replaced}/${cues.length} improved in ${((Date.now() - fullPassStartTime) / 1000).toFixed(1)}s (${sharedTranslationState.flaggedLines.size} flagged)`);
  context.reportStatus(`Full pass done: ${replaced} lines improved via ${secondProviderDef.name}`, 'success');
  context.commitTranslation(sharedTranslationState.translatedCues, { cacheKey, originalCues: cues });
}
