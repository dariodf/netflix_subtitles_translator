import { CONFIG } from '../config.js';
import { PROVIDERS } from '../core/providers/definitions.js';
import { state } from '../state.js';
import { cacheSetWithUrl, cacheClear } from './cache.js';
import { logInfo, logError } from '../core/utils.js';
import { getSecondProviderOverride } from '../providers/secondary.js';
import { buildCacheKey } from '../pipeline/handler.js';
import { showStatus } from '../ui/status.js';
import { togglePanel } from '../ui/settings/index.js';
import { toggleTranscript } from '../ui/transcript.js';
import { refreshTranscriptContent } from '../ui/transcript.js';
import { glossary } from '../core/glossary.js';
import { createBrowserContext } from './context.js';
import { _callLLMTranslate } from '../pipeline/request.js';
import { translateWithLLM, translateChunkLLM } from '../pipeline/translate.js';
import { runFullPass } from '../pipeline/cleanup.js';

// ============================
// KEYBOARD SHORTCUTS
// ============================
function getCurrentCueIndex() {
  const video = document.querySelector('video');
  if (!video || !state.originalCues) return -1;
  const ms = video.currentTime * 1000;
  const exact = state.originalCues.findIndex(c => ms >= c.begin && ms <= c.end);
  if (exact >= 0) return exact;
  let closest = -1;
  for (let i = 0; i < state.originalCues.length; i++) {
    if (state.originalCues[i].begin <= ms) closest = i;
    else break;
  }
  return closest;
}

export async function retryCurrentChunk() {
  if (!state.originalCues) {
    showStatus('No subtitles loaded yet', 'error', true);
    return;
  }
  if (state.isTranslating) {
    showStatus('Translation in progress, please wait', 'error', true);
    return;
  }
  const cueIdx = getCurrentCueIndex();
  if (cueIdx < 0) {
    showStatus('No active subtitle to retry', 'error', true);
    return;
  }

  let providerOverride = CONFIG.secondEnabled ? getSecondProviderOverride() : null;
  const modelLabel = providerOverride ? CONFIG.secondModel : CONFIG.model;

  const chunkSize = providerOverride ? CONFIG.secondChunkSize : CONFIG.chunkSize;
  const chunkOverlap = CONFIG.chunkOverlap;
  const step = chunkSize - chunkOverlap;
  const chunkStart = Math.floor(cueIdx / step) * step;
  const chunkCues = state.originalCues.slice(chunkStart, chunkStart + chunkSize);
  const chunkNum = Math.floor(chunkStart / step) + 1;

  logInfo(`Retrying chunk ${chunkNum} (lines ${chunkStart}-${chunkStart + chunkCues.length - 1}) → ${modelLabel}`);
  showStatus(`Retrying chunk ${chunkNum} via ${modelLabel}...`, 'working', true);

  const context = createBrowserContext();
  state.isTranslating = true;
  try {
    const retryContext = chunkStart > 0 ? state.translatedCues.slice(Math.max(0, chunkStart - CONFIG.prevContextLines), chunkStart) : [];
    const results = providerOverride
      ? await _callLLMTranslate(chunkCues, retryContext, '', providerOverride, context)
      : await translateChunkLLM(chunkCues, retryContext, chunkStart, context);
    let applied = 0;
    for (let j = 0; j < results.length; j++) {
      const globalIdx = chunkStart + j;
      if (globalIdx < state.originalCues.length && results[j]) {
        const original = state.originalCues[globalIdx].text;
        const translated = results[j] === original ? (state.translatedCues[globalIdx]?.text || original) : results[j];
        state.translatedCues[globalIdx] = {
          begin: state.originalCues[globalIdx].begin,
          end: state.originalCues[globalIdx].end,
          text: translated,
        };
        if (translated !== original) {
          state.flaggedLines.delete(globalIdx);
          applied++;
        }
      }
    }
    logInfo(`Chunk ${chunkNum} retried → ${applied}/${results.length} applied via ${modelLabel}`);
    for (let k = 0; k < state.originalCues.length; k++) {
      if (!state.translatedCues[k]) {
        state.translatedCues[k] = { ...state.originalCues[k] };
      }
    }
    if (state.activeCacheKey) cacheSetWithUrl(state.activeCacheKey, state.translatedCues, state.originalCues);
    showStatus(`Chunk ${chunkNum} retranslated via ${modelLabel}`, 'success', true);
  } catch (err) {
    logError('Retry failed:', err);
    showStatus('Retry failed: ' + err.message, 'error', true);
  }
  state.isTranslating = false;
}

export async function retranslateAll() {
  if (!state.originalCues || state.originalCues.length === 0) {
    showStatus('No subtitles loaded yet', 'error', true);
    return;
  }
  if (state.isTranslating) {
    showStatus('Translation in progress, please wait', 'error', true);
    return;
  }

  const cues = state.originalCues;
  const cacheKey = buildCacheKey(CONFIG, cues);
  const context = createBrowserContext();

  state.isTranslating = true;
  state.flaggedLines = new Set();
  glossary.clear();
  const retranslateStartTime = Date.now();

  try {
    if (CONFIG.secondEnabled && getSecondProviderOverride()) {
      const chunkSize = CONFIG.secondChunkSize;
      const chunkOverlap = CONFIG.chunkOverlap;
      const step = chunkSize - chunkOverlap;
      const video = document.querySelector('video');
      const currentMs = video ? video.currentTime * 1000 : 0;
      let startChunk = 0;
      for (let ci = 0; ci < cues.length; ci++) {
        if (cues[ci].begin >= currentMs) {
          startChunk = Math.floor(ci / step);
          break;
        }
      }
      await runFullPass(cues, cacheKey, startChunk, context, getSecondProviderOverride());
      state.activeCacheKey = cacheKey;
    } else {
      const provider = PROVIDERS[CONFIG.provider];
      if (!provider || provider.type !== 'llm') {
        showStatus('Retranslate requires an LLM provider', 'error', true);
        state.isTranslating = false;
        return;
      }
      logInfo(`🔄 Retranslating ALL ${cues.length} lines → ${provider.name}/${CONFIG.model}`);
      showStatus(`Retranslating all ${cues.length} lines via ${CONFIG.model}...`, 'working', true);

      const translated = await translateWithLLM(cues, cacheKey, 0, context);
      state.translatedCues = translated;
      logInfo(`✅ Retranslation complete! ${cues.length} lines in ${((Date.now() - retranslateStartTime) / 1000).toFixed(1)}s via ${CONFIG.model}`);
      showStatus(`Retranslated! ${cues.length} lines via ${CONFIG.model}`, 'success', true);
      state.activeCacheKey = cacheKey;
    }

    cacheSetWithUrl(cacheKey, state.translatedCues, cues);

    if (state.flaggedLines.size > 0) {
      logInfo(`🚩 ${state.flaggedLines.size} lines still flagged after retranslation`);
    }
  } catch (err) {
    logError('Retranslation failed:', err);
    showStatus('Retranslation failed: ' + err.message, 'error', true);
  }

  state.isTranslating = false;
  refreshTranscriptContent();
}

// ============================
// TOGGLE ACTIONS (shared by keyboard shortcuts and settings panel)
// ============================
export const PILL_ON = 'rgba(59,130,246,0.6)';
export const PILL_OFF = 'rgba(255,255,255,0.15)';

function syncPill(switchId, active) {
  if (!state.panelEl) return;
  const pill = state.panelEl.querySelector(`#${switchId}`);
  if (!pill) return;
  pill.style.background = active ? PILL_ON : PILL_OFF;
  pill.firstElementChild.style.left = active ? '16px' : '2px';
}

export function applyMasterToggle() {
  CONFIG.masterEnabled = !CONFIG.masterEnabled;
  GM_setValue('masterEnabled', CONFIG.masterEnabled);
  if (!CONFIG.masterEnabled) {
    if (state.overlayEl) state.overlayEl.textContent = '';
    if (state.origOverlayEl) state.origOverlayEl.textContent = '';
  }
  syncPill('st-master-switch', CONFIG.masterEnabled);
  if (state.panelEl) {
    const label = state.panelEl.querySelector('#st-master-label');
    if (label) { label.textContent = CONFIG.masterEnabled ? 'ON' : 'OFF'; label.style.opacity = CONFIG.masterEnabled ? '0.9' : '0.4'; }
    const mainContent = state.panelEl.querySelector('#st-main-content');
    if (mainContent) mainContent.style.display = CONFIG.masterEnabled ? 'block' : 'none';
  }
}

export function applySubtitleToggle() {
  if (!state.overlayEl) return;
  state.enabled = !state.enabled;
  state.overlayEl.style.display = state.enabled ? 'block' : 'none';
  if (state.fabEl) state.fabEl.style.background = state.enabled ? 'rgba(229,9,20,0.85)' : 'rgba(100,100,100,0.85)';
  syncPill('st-toggle-subs-switch', state.enabled);
}

export function applyDualSubsToggle() {
  state.dualSubs = !state.dualSubs;
  if (!state.dualSubs && state.origOverlayEl) {
    state.origOverlayEl.textContent = '';
    state.origOverlayEl.style.display = 'none';
  }
  syncPill('st-dual-subs-switch', state.dualSubs);
}

export function applyOrigOnFlaggedToggle() {
  state.showOrigOnFlagged = !state.showOrigOnFlagged;
  syncPill('st-show-orig-flagged-switch', state.showOrigOnFlagged);
}

export function applyTranscriptToggle() {
  toggleTranscript();
  syncPill('st-transcript-switch', state.transcriptVisible);
}

export function handleKeydown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  // Shift+T: exit fullscreen (if active) then open settings panel — works on any Netflix page
  if (e.key === 'T' && e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
    togglePanel();
    return;
  }

  // All other shortcuts only active on playback pages
  if (!location.pathname.startsWith('/watch/')) return;

  if (e.key === 'S' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    applyMasterToggle();
    showStatus(CONFIG.masterEnabled ? 'Translation ON' : 'Translation OFF', CONFIG.masterEnabled ? 'success' : 'error', true);
  } else if ((e.key === 's' || e.key === 'S') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    applySubtitleToggle();
    showStatus(state.enabled ? 'Subtitles ON' : 'Subtitles OFF', 'success', true);
  } else if (e.key === 'A' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    retranslateAll();
  } else if ((e.key === 'r' || e.key === 'R') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    retryCurrentChunk();
  } else if ((e.key === 'd' || e.key === 'D') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    CONFIG.timingOffset += CONFIG.timingStep;
    showStatus(`Offset: ${CONFIG.timingOffset}ms — delayed (+${CONFIG.timingStep})`, 'success', true);
  } else if ((e.key === 'e' || e.key === 'E') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    CONFIG.timingOffset -= CONFIG.timingStep;
    showStatus(`Offset: ${CONFIG.timingOffset}ms — earlier (-${CONFIG.timingStep})`, 'success', true);
  } else if ((e.key === 'l' || e.key === 'L') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    applyTranscriptToggle();
  } else if ((e.key === 'o' || e.key === 'O') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    applyDualSubsToggle();
    showStatus(state.dualSubs ? 'Dual subtitles ON — original + translation' : 'Dual subtitles OFF', 'success', true);
  } else if ((e.key === 'O') && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    applyOrigOnFlaggedToggle();
    showStatus(state.showOrigOnFlagged ? 'Show original on flagged lines ON' : 'Show original on flagged lines OFF', 'success', true);
  } else if ((e.key === 'C') && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    cacheClear();
    state.translatedCues = [];
    showStatus('Translation cache cleared', 'success', true);
  }
}
