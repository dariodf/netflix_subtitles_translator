import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { reparentToFullscreen } from './fullscreen.js';

// ============================
// OVERLAY UI
// ============================

/**
 * Converts cue text for display: emdash (used to encode <br> line breaks)
 * and slash separators both become newlines.
 */
export function formatCueTextForDisplay(text) {
  return text.replace(/—/g, '\n').replace(/ \/ /g, '\n');
}

// Module-level: these are overlay implementation details, not shared state
let cachedVideo = null;
let videoCheckCount = 0;

/** Reset video cache on navigation (called by main.js) */
export function resetVideoCache() {
  cachedVideo = null;
  videoCheckCount = 0;
}

// Reused each frame to avoid per-frame allocation
const activeIndices = [];

export function createOverlay() {
  // Container for both overlays — stacked vertically, bottom-aligned
  const containerEl = document.createElement('div');
  containerEl.id = 'subtranslator-container';
  Object.assign(containerEl.style, {
    position: 'fixed', bottom: '12%', left: '50%', transform: 'translateX(-50%)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
    zIndex: '2147483647', pointerEvents: 'none', maxWidth: '80%',
  });

  // Original subtitle overlay (shown above translation in dual/flagged mode)
  state.origOverlayEl = document.createElement('div');
  state.origOverlayEl.id = 'subtranslator-orig-overlay';
  Object.assign(state.origOverlayEl.style, {
    color: 'rgba(255,255,200,0.85)', fontSize: `calc(${CONFIG.fontSize} * 0.75)`,
    fontFamily: 'Netflix Sans, Helvetica Neue, Arial, sans-serif', fontWeight: '400',
    textAlign: 'center',
    textShadow: '1px 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.7)',
    pointerEvents: 'none',
    lineHeight: '1.3', padding: '4px 12px', background: 'rgba(0,0,0,0.4)',
    borderRadius: '4px', transition: 'opacity 0.15s',
    whiteSpace: 'pre-wrap', letterSpacing: '0.02em',
    display: 'none',
  });
  containerEl.appendChild(state.origOverlayEl);

  // Translation overlay (primary)
  state.overlayEl = document.createElement('div');
  state.overlayEl.id = 'subtranslator-overlay';
  Object.assign(state.overlayEl.style, {
    color: 'white', fontSize: CONFIG.fontSize,
    fontFamily: 'Netflix Sans, Helvetica Neue, Arial, sans-serif', fontWeight: '600',
    textAlign: 'center',
    textShadow: '2px 2px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)',
    pointerEvents: 'none',
    lineHeight: '1.4', padding: '6px 16px', background: 'rgba(0,0,0,0.6)',
    borderRadius: '4px', transition: 'opacity 0.15s',
    whiteSpace: 'pre-wrap', letterSpacing: '0.02em',
  });
  containerEl.appendChild(state.overlayEl);

  document.body.appendChild(containerEl);

  // Move overlay into/out of fullscreen element so it stays visible
  document.addEventListener('fullscreenchange', reparentOverlay);
  document.addEventListener('webkitfullscreenchange', reparentOverlay);
  reparentOverlay();

  requestAnimationFrame(tick);
}

export function reparentOverlay() {
  const containerEl = document.getElementById('subtranslator-container');
  if (!containerEl) return;
  reparentToFullscreen(containerEl);
  reparentToFullscreen(state.transcriptPanelEl);
}

function tick() {
  if (!state.overlayEl) { requestAnimationFrame(tick); return; }
  if (!state.enabled || !CONFIG.masterEnabled || state.translatedCues.length === 0) {
    if (state.overlayEl.textContent) state.overlayEl.textContent = '';
    if (state.origOverlayEl?.textContent) { state.origOverlayEl.textContent = ''; state.origOverlayEl.style.display = 'none'; }
    requestAnimationFrame(tick);
    return;
  }

  // Re-query video element periodically (it can change on navigation)
  if (!cachedVideo || ++videoCheckCount > 300) {
    cachedVideo = document.querySelector('video');
    videoCheckCount = 0;
  }
  const video = cachedVideo;
  if (video) {
    const currentMs = video.currentTime * 1000 - CONFIG.timingOffset;

    // Reset head if we seeked backwards
    if (state.cueHead > 0 && (state.cueHead >= state.translatedCues.length || state.translatedCues[state.cueHead].begin > currentMs)) {
      state.cueHead = 0;
    }

    // Advance head past ended cues
    while (state.cueHead < state.translatedCues.length && state.translatedCues[state.cueHead].end < currentMs) {
      state.cueHead++;
    }

    // Collect active cues from head forward (reuse array to avoid per-frame allocation)
    activeIndices.length = 0;
    for (let i = state.cueHead; i < state.translatedCues.length; i++) {
      if (state.translatedCues[i].begin > currentMs) break;
      if (currentMs <= state.translatedCues[i].end) activeIndices.push(i);
    }
    const activeIdx = activeIndices.length > 0 ? activeIndices[activeIndices.length - 1] : -1;

    // Combine all active cue texts
    const newText = activeIndices
      .map(i => formatCueTextForDisplay(state.translatedCues[i].text))
      .join('\n');
    if (state.overlayEl.textContent !== newText) {
      state.overlayEl.textContent = newText;
      state.overlayEl.style.display = newText ? 'block' : 'none';
    }

    // Dual subtitle mode OR flagged line: show originals above translation
    if (state.origOverlayEl) {
      // Short-circuit: skip orig logic when neither mode is active
      if (!state.dualSubs && !state.showOrigOnFlagged) {
        if (state.origOverlayEl.style.display !== 'none') {
          state.origOverlayEl.textContent = '';
          state.origOverlayEl.style.display = 'none';
        }
      } else {
        const hasActiveFlagged = state.showOrigOnFlagged && activeIndices.some(i => state.flaggedLines.has(i));
        const showOrig = activeIndices.length > 0 && state.originalCues &&
          (state.dualSubs || hasActiveFlagged);
        if (showOrig) {
          const origText = activeIndices
            .filter(i => state.originalCues[i])
            .map(i => formatCueTextForDisplay(state.originalCues[i].text))
            .join('\n');
          if (state.origOverlayEl.textContent !== origText) {
            state.origOverlayEl.textContent = origText;
          }
          const origDisplay = origText ? 'block' : 'none';
          if (state.origOverlayEl.style.display !== origDisplay) {
            state.origOverlayEl.style.display = origDisplay;
          }
        } else {
          if (state.origOverlayEl.style.display !== 'none') {
            state.origOverlayEl.textContent = '';
            state.origOverlayEl.style.display = 'none';
          }
        }
      }
    }

    if (state.transcriptVisible && state.transcriptPanelEl) {
      updateTranscriptHighlight(activeIdx);
    }
  }

  requestAnimationFrame(tick);
}

function updateTranscriptHighlight(activeIdx) {
  if (activeIdx === state.transcriptLastHighlightIndex) return;

  const prevIdx = state.transcriptLastHighlightIndex;
  state.transcriptLastHighlightIndex = activeIdx;

  const prevEl = state.transcriptLineElements[prevIdx];
  if (prevEl) {
    prevEl.style.background = 'transparent';
    prevEl.style.borderLeftColor = 'transparent';
    prevEl.classList.remove('st-active');
  }

  const activeEl = state.transcriptLineElements[activeIdx];
  if (activeEl) {
    activeEl.style.background = 'rgba(229,9,20,0.2)';
    activeEl.style.borderLeftColor = '#e50914';
    activeEl.classList.add('st-active');
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
