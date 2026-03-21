import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { reparentToFullscreen } from './fullscreen.js';
import { formatCueTextForDisplay } from './overlay.js';

// Cached reference to the text element — avoid per-frame querySelector
let _imageOverlayTextEl = null;

/**
 * Create the image translation overlay element (top-center, blue-tinted, sharp corners).
 * Must be called once; subsequent calls are no-ops.
 */
export function createImageOverlay() {
  if (state.imageOverlayEl) return;

  state.imageOverlayEl = document.createElement('div');
  state.imageOverlayEl.id = 'subtranslator-image-overlay';
  Object.assign(state.imageOverlayEl.style, {
    position: 'fixed',
    top: '60px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
    pointerEvents: 'none',
    color: 'white',
    fontSize: CONFIG.fontSize,
    fontFamily: 'Netflix Sans, Helvetica Neue, Arial, sans-serif',
    fontWeight: '600',
    textAlign: 'center',
    textShadow: '2px 2px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)',
    lineHeight: '1.4',
    padding: '8px 18px',
    background: 'rgba(30, 60, 120, 0.7)',
    borderRadius: '0',
    whiteSpace: 'pre-wrap',
    letterSpacing: '0.02em',
    transition: 'opacity 0.15s',
    maxWidth: '80%',
    display: 'none',
  });

  // "Image" label above the text
  const label = document.createElement('div');
  Object.assign(label.style, {
    fontSize: '0.6em',
    fontWeight: '400',
    opacity: '0.5',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: '2px',
  });
  label.textContent = 'Image';
  state.imageOverlayEl.appendChild(label);

  // Text content area
  _imageOverlayTextEl = document.createElement('div');
  _imageOverlayTextEl.id = 'subtranslator-image-overlay-text';
  state.imageOverlayEl.appendChild(_imageOverlayTextEl);

  document.body.appendChild(state.imageOverlayEl);
}

/**
 * Reparent the image overlay into fullscreen element if needed.
 */
export function reparentImageOverlay() {
  if (state.imageOverlayEl) {
    reparentToFullscreen(state.imageOverlayEl);
  }
}

/**
 * Update the image overlay content based on current video time.
 * Called from tick() in overlay.js — no own render loop.
 * @param {number} currentMs - current video playback position in milliseconds
 */
export function updateImageOverlay(currentMs) {
  if (!state.imageOverlayEl || !_imageOverlayTextEl) return;

  // Feature disabled or overlay hidden by Shift+I
  if (!state.imageOverlayEnabled || state.imageTranslatedCues.length === 0) {
    if (_imageOverlayTextEl.textContent) {
      _imageOverlayTextEl.textContent = '';
      state.imageOverlayEl.style.display = 'none';
    }
    return;
  }

  // Find last active cue (most recently captured one within its time window)
  const cues = state.imageShowOriginal ? state.imageOriginalCues : state.imageTranslatedCues;
  let activeCue = null;
  for (let i = cues.length - 1; i >= 0; i--) {
    if (currentMs >= cues[i].begin && currentMs <= cues[i].end) {
      activeCue = cues[i];
      break;
    }
  }

  const newText = activeCue ? formatCueTextForDisplay(activeCue.text) : '';
  if (_imageOverlayTextEl.textContent !== newText) {
    _imageOverlayTextEl.textContent = newText;
    state.imageOverlayEl.style.display = newText ? 'block' : 'none';
  }
}
