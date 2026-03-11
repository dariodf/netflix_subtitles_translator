import { PROVIDERS } from '../core/providers/definitions.js';
import { makeCue, logInfo } from '../core/utils.js';
import { validateTranslation, LANG_SIGNATURES } from '../core/validation.js';
import { buildDiagnosticPrompt, buildRetryNote, buildSweepRetryNote } from '../core/prompts.js';
import { _callLLMTranslate, _callLLMTranslateRaw } from './request.js';

// ============================
// PURE HELPERS (exported for testing)
// ============================

/** Check if retry result introduced source-script characters the first-pass didn't have */
function retryIntroducedSourceScript(firstPass, retryResult, sourceLang) {
  if (!sourceLang) return false;
  const sig = LANG_SIGNATURES.find(s => s.aliases.some(a => sourceLang.toLowerCase().includes(a)));
  if (!sig) return false;
  return sig.markers.test(retryResult) && !sig.markers.test(firstPass);
}

/** Reorder chunk queue to prioritize chunks near the given playback position */
export function reorderFromPosition(ms, cues, allChunkStarts, step, completedChunks) {
  let currentLineIdx = cues.findIndex(c => ms >= c.begin && ms <= c.end);
  if (currentLineIdx < 0) {
    currentLineIdx = cues.findIndex(c => c.begin > ms) - 1;
  }
  if (currentLineIdx <= 0) return null;

  const priorityStart = Math.floor(currentLineIdx / step) * step;
  const idx = allChunkStarts.indexOf(priorityStart);
  if (idx <= 0) return null;

  const reordered = [...allChunkStarts.slice(idx), ...allChunkStarts.slice(0, idx)]
    .filter(s => !completedChunks.has(s));
  if (reordered.length === 0) return null;

  return reordered;
}

// ============================
// LLM TRANSLATION (Gemini, Ollama, Anthropic, Groq, Mistral, OpenRouter)
// ============================
export async function translateWithLLM(cues, cacheKey, resumeFromLine, context, prefill = null, externalStartTime = null) {
  const config = context.config;
  const sharedTranslationState = context.sharedTranslationState;
  const { chunkSize, chunkOverlap } = config;
  const allTranslated = new Array(cues.length);
  const totalChunks = Math.ceil(cues.length / (chunkSize - chunkOverlap));
  let chunkNum = 0;
  // Use external start time (includes glossary scan) for accurate TTFC
  const translationStartTime = externalStartTime || Date.now();
  let firstChunkRecorded = false;

  // Pre-fill from existing translations (retranslate keeps old until replaced)
  if (prefill && prefill.length > 0) {
    for (let i = 0; i < Math.min(prefill.length, cues.length); i++) {
      if (prefill[i]) allTranslated[i] = prefill[i];
    }
  }

  // Pre-fill from cache if resuming
  if (resumeFromLine > 0) {
    for (let i = 0; i < Math.min(resumeFromLine, sharedTranslationState.translatedCues.length); i++) {
      allTranslated[i] = sharedTranslationState.translatedCues[i];
    }
  }

  // Build chunk start indices, prioritizing current position forward
  const step = chunkSize - chunkOverlap;
  const allChunkStarts = [];
  for (let i = 0; i < cues.length; i += step) allChunkStarts.push(i);

  let chunkQueue = [...allChunkStarts];
  const completedChunks = new Set();

  function _reorder(ms) {
    const result = reorderFromPosition(ms, cues, allChunkStarts, step, completedChunks);
    if (result) { chunkQueue = result; return true; }
    return false;
  }

  // Apply initial ordering from current video position
  const videoPositionMs = context.getVideoPositionMs();
  if (videoPositionMs !== null && videoPositionMs > 5000) {
    if (_reorder(videoPositionMs)) {
      logInfo(`⏩ Starting from video position ${(videoPositionMs / 1000).toFixed(1)}s`);
    }
  }

  // Listen for seeks during translation
  const cleanupSeekListener = context.onVideoSeek((ms) => {
    if (_reorder(ms)) {
      logInfo(`⏩ Seek detected → reprioritizing from ${(ms / 1000).toFixed(1)}s (${chunkQueue.length} chunks remaining)`);
    }
  });

  try {

  // Fast Start: translate a half-size first chunk for instant results.
  if (config.fastStart && chunkQueue.length > 0) {
    const fastStartOffset = chunkQueue[0];
    const fastStartSize = Math.max(10, Math.ceil(chunkSize / 2));
    const fastStartCues = cues.slice(fastStartOffset, fastStartOffset + fastStartSize);
    if (fastStartCues.length > 0) {
      context.reportStatus(`Fast start: ${fastStartCues.length} lines...`, 'working');
      sharedTranslationState.translationPassLabel = 'fast start';
      const previousContext = allTranslated.slice(Math.max(0, fastStartOffset - config.prevContextLines), fastStartOffset).filter(Boolean);
      const fastStartResults = await _callLLMTranslate(fastStartCues, previousContext, '', null, context);
      for (let j = 0; j < fastStartResults.length; j++) {
        const globalIndex = fastStartOffset + j;
        if (globalIndex < cues.length) {
          allTranslated[globalIndex] = makeCue(cues[globalIndex], fastStartResults[j] || cues[globalIndex].text);
        }
      }
      context.commitTranslation(cues.map((c, idx) => allTranslated[idx] || makeCue(c, c.text)));
      const fastElapsed = Date.now() - translationStartTime;
      logInfo(`⚡ Fast start: ${fastStartCues.length} lines in ${(fastElapsed / 1000).toFixed(1)}s`);
      if (!firstChunkRecorded) {
        firstChunkRecorded = true;
        sharedTranslationState.firstChunkMetrics = {
          elapsedMs: fastElapsed,
          cueCount: fastStartCues.length,
          beginMs: fastStartCues[0].begin,
          endMs: fastStartCues[fastStartCues.length - 1].end,
          fastStart: true,
        };
      }
    }
  }

  while (chunkQueue.length > 0) {
    const i = chunkQueue.shift();
    if (completedChunks.has(i)) continue;
    chunkNum++;
    if (i + chunkSize <= resumeFromLine) {
      completedChunks.add(i);
      logInfo(`⏩ Chunk ${chunkNum}/${totalChunks} cached, skipping`);
      continue;
    }
    completedChunks.add(i);
    const chunkCues = cues.slice(i, i + chunkSize);
    const chunkStartTime = Date.now();
    context.reportStatus(`Chunk ${chunkNum}/${totalChunks} via ${PROVIDERS[config.provider].name}...`, 'working');

    const prevContext = allTranslated.slice(Math.max(0, i - config.prevContextLines), i).filter(Boolean);
    sharedTranslationState.translationPassLabel = `1st pass ${chunkNum}/${totalChunks}`;

    // Set up callback so translateChunkLLM can push first-pass results
    translateChunkLLM._onFirstPass = (firstPassResults, offset) => {
      for (let j = 0; j < firstPassResults.length; j++) {
        const globalIndex = offset + j;
        if (globalIndex < cues.length) {
          allTranslated[globalIndex] = makeCue(cues[globalIndex], firstPassResults[j] || cues[globalIndex].text);
        }
      }
      context.commitTranslation(cues.map((c, idx) => allTranslated[idx] || makeCue(c, c.text)));
    };

    const results = await translateChunkLLM(chunkCues, prevContext, i, context);
    translateChunkLLM._onFirstPass = null;
    const chunkElapsedSeconds = ((Date.now() - chunkStartTime) / 1000).toFixed(1);
    const translated = results.filter((r, j) => r !== chunkCues[j].text).length;
    const chunkFlagged = Array.from(sharedTranslationState.flaggedLines).filter(f => f >= i && f < i + chunkCues.length).length;
    logInfo(`📦 Chunk ${chunkNum}/${totalChunks}: ${translated}/${chunkCues.length} translated, ${chunkFlagged} flagged (${chunkElapsedSeconds}s) | Total flagged: ${sharedTranslationState.flaggedLines.size}`);

    // Record first chunk metrics (when no fast start was used)
    if (!firstChunkRecorded) {
      firstChunkRecorded = true;
      sharedTranslationState.firstChunkMetrics = {
        elapsedMs: Date.now() - translationStartTime,
        cueCount: chunkCues.length,
        beginMs: chunkCues[0].begin,
        endMs: chunkCues[chunkCues.length - 1].end,
        fastStart: false,
      };
    }

    for (let j = 0; j < results.length; j++) {
      const globalIdx = i + j;
      if (globalIdx < cues.length) {
        const isOverlap = j < chunkOverlap && i !== 0;
        if (isOverlap && allTranslated[globalIdx] && allTranslated[globalIdx].text !== cues[globalIdx].text) {
          continue;
        }
        allTranslated[globalIdx] = makeCue(cues[globalIdx], results[j] || cues[globalIdx].text);
      }
    }
    context.commitTranslation(cues.map((c, idx) => allTranslated[idx] || makeCue(c, c.text)), { cacheKey, originalCues: cues });
  }

  } finally {
    cleanupSeekListener();
  }

  for (let i = 0; i < cues.length; i++) {
    if (!allTranslated[i]) allTranslated[i] = { ...cues[i] };
  }

  // Final sweep: check for any lines that slipped through untranslated and unflagged
  const missed = [];
  for (let i = 0; i < cues.length; i++) {
    if (!sharedTranslationState.flaggedLines.has(i) && allTranslated[i].text === cues[i].text) {
      missed.push(i);
    }
  }
  if (missed.length > 0) {
    logInfo(`🔍 Final sweep: ${missed.length} lines still untranslated, flagging for retry`);
    for (const idx of missed) {
      sharedTranslationState.flaggedLines.add(idx);
      sharedTranslationState.flagReasons?.set(idx, 'untranslated');
    }
    const gapSet = new Set(missed);
    const scriptLines = [];
    const diagnosticLines = [];
    for (let i = 0; i < cues.length; i++) {
      if (gapSet.has(i)) {
        scriptLines.push(`[${i}] ${cues[i].text}`);
        diagnosticLines.push(`[${i}] was NOT translated — still in source language`);
      } else {
        scriptLines.push(`[${i}] ${allTranslated[i].text}`);
      }
    }
    const SWEEP_BATCH = config.chunkSize;
    for (let b = 0; b < missed.length; b += SWEEP_BATCH) {
      const batchMissed = missed.slice(b, b + SWEEP_BATCH);
      const rangeStart = Math.max(0, batchMissed[0] - config.prevContextLines);
      const rangeEnd = Math.min(cues.length, batchMissed[batchMissed.length - 1] + config.prevContextLines + 1);
      const windowCues = cues.slice(rangeStart, rangeEnd);
      const windowScript = scriptLines.slice(rangeStart, rangeEnd).map((line, idx) => {
        return line.replace(/^\[\d+\]/, `[${idx}]`);
      });
      const windowDiag = [];
      const windowGapMap = {};
      for (const idx of batchMissed) {
        if (idx >= rangeStart && idx < rangeEnd) {
          const localIdx = idx - rangeStart;
          windowDiag.push(`[${localIdx}] was NOT translated — still in source language`);
          windowGapMap[localIdx] = idx;
        }
      }

      const retryNote = buildSweepRetryNote(windowDiag, config.targetLang);
      context.reportStatus(`Final sweep: ${Object.keys(windowGapMap).length} missed lines...`, 'working');
      const sweepResults = await _callLLMTranslateRaw(windowCues, windowScript, retryNote, null, context);

      for (const [localStr, globalIdx] of Object.entries(windowGapMap)) {
        const localIdx = parseInt(localStr);
        if (sweepResults[localIdx] && sweepResults[localIdx] !== cues[globalIdx].text) {
          if (retryIntroducedSourceScript(allTranslated[globalIdx]?.text || '', sweepResults[localIdx], config.sourceLang)) continue;
          const check = validateTranslation([cues[globalIdx]], [sweepResults[localIdx]], config.targetLang, config.sourceLang);
          if (check.gaps.length === 0) {
            allTranslated[globalIdx] = makeCue(cues[globalIdx], sweepResults[localIdx]);
            sharedTranslationState.flaggedLines.delete(globalIdx);
            sharedTranslationState.flagReasons?.delete(globalIdx);
          }
        }
      }
    }
    context.commitTranslation(allTranslated);
    const stillMissed = missed.filter(i => sharedTranslationState.flaggedLines.has(i)).length;
    if (stillMissed > 0) {
      logInfo(`🚩 Final sweep: ${stillMissed} lines still untranslated after retry`);
    } else {
      logInfo('✅ Final sweep: all missed lines recovered');
    }
  }

  return allTranslated;
}

export async function translateChunkLLM(chunkCues, prevContext, globalOffset = 0, context) {
  const config = context.config;
  const sharedTranslationState = context.sharedTranslationState;

  // Clear any existing flags for lines in this chunk
  for (let i = 0; i < chunkCues.length; i++) {
    sharedTranslationState.flaggedLines.delete(globalOffset + i);
    sharedTranslationState.flagReasons?.delete(globalOffset + i);
  }

  // First pass: translate the chunk
  const results = await _callLLMTranslate(chunkCues, prevContext, '', null, context);

  // Validate
  const { gaps, reasons } = validateTranslation(chunkCues, results, config.targetLang, config.sourceLang);

  if (gaps.length === 0) {
    logInfo(`✅ Chunk validated: ${chunkCues.length}/${chunkCues.length} OK`);
    return results;
  }

  // Flag gaps immediately
  for (const idx of gaps) {
    sharedTranslationState.flaggedLines.add(globalOffset + idx);
    sharedTranslationState.flagReasons?.set(globalOffset + idx, reasons[idx] || 'unknown');
  }

  const reasonCounts = {};
  for (const idx of gaps) {
    const r = reasons[idx] || 'unknown';
    reasonCounts[r] = (reasonCounts[r] || 0) + 1;
  }
  const breakdown = Object.entries(reasonCounts).map(([r, c]) => `${r}:${c}`).join(', ');
  logInfo(`⚠️ ${gaps.length}/${chunkCues.length} flagged [${breakdown}] — showing first pass, then retrying...`);

  // Yield first-pass results immediately
  if (translateChunkLLM._onFirstPass) {
    translateChunkLLM._onFirstPass(results, globalOffset);
  }

  // Build diagnostic retry prompt from reasons
  const { scriptLines, diagnosticLines } = buildDiagnosticPrompt(chunkCues, results, gaps, reasons, config.targetLang);
  const retryNote = buildRetryNote(diagnosticLines, config.targetLang);

  const _retryStart = Date.now();
  const retryResults = await _callLLMTranslateRaw(chunkCues, scriptLines, retryNote, null, context);
  const retryMs = Date.now() - _retryStart;

  const gapSet = new Set(gaps);
  let fixed = 0;
  for (let i = 0; i < chunkCues.length; i++) {
    if (gapSet.has(i) && retryResults[i] && retryResults[i] !== chunkCues[i].text) {
      if (retryIntroducedSourceScript(results[i], retryResults[i], config.sourceLang)) continue;
      const { gaps: singleGaps } = validateTranslation([chunkCues[i]], [retryResults[i]], config.targetLang, config.sourceLang);
      if (singleGaps.length === 0) {
        results[i] = retryResults[i];
        sharedTranslationState.flaggedLines.delete(globalOffset + i);
        sharedTranslationState.flagReasons?.delete(globalOffset + i);
        fixed++;
      }
    }
  }

  const remaining = gaps.length - fixed;
  logInfo(`🔧 Retry: ${fixed}/${gaps.length} fixed in ${(retryMs / 1000).toFixed(1)}s${remaining > 0 ? ` — ${remaining} still flagged` : ''}`);
  return results;
}
// Static callback slot
translateChunkLLM._onFirstPass = null;
