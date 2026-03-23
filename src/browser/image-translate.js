import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { PROVIDERS } from '../core/providers/definitions.js';
import { buildOcrPrompt, NO_TEXT } from '../core/vision-prompts.js';
import { translateChunkLLM } from '../pipeline/translate.js';
import { createBrowserContext } from './context.js';
import { postJsonViaGM } from './http.js';
import { logInfo } from '../core/utils.js';
import { showStatus } from '../ui/status.js';
import { cacheGet, cacheSet } from './cache.js';

let _imageTranslationInProgress = false;

/**
 * Capture the current browser tab as a JPEG base64 string via getDisplayMedia.
 * The caller must hide any overlays before calling this.
 */
async function captureDisplayFrame() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser' },
    preferCurrentTab: true,
  });

  try {
    const track = stream.getVideoTracks()[0];
    const imageCapture = new ImageCapture(track);
    const bitmap = await imageCapture.grabFrame();

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    // Release canvas backing store immediately (can be large at full resolution)
    canvas.width = 0;
    canvas.height = 0;
    return dataUrl.split(',')[1];
  } finally {
    stream.getTracks().forEach(t => t.stop());
  }
}

function resolveVisionProvider() {
  const providerKey = CONFIG.imageVisionProvider || CONFIG.provider;
  const provider = PROVIDERS[providerKey];
  if (!provider?.supportsVision) {
    throw new Error(`Provider "${providerKey}" does not support vision`);
  }
  const model = CONFIG.imageVisionModel;
  const apiKey = CONFIG.imageVisionApiKey || CONFIG.apiKey;
  return { providerKey, provider, model, apiKey };
}

function buildVisionUrl(provider, providerKey, model, apiKey) {
  let url = provider.url;
  if (providerKey === 'ollama') {
    url = CONFIG.ollamaUrl.replace(/\/+$/, '') + '/api/chat';
  }
  const req = provider.buildVisionRequest('', '', model, apiKey);
  if (req.urlSuffix) url = url + req.urlSuffix;
  return url;
}

async function callVisionOcr(imageBase64) {
  const { providerKey, provider, model, apiKey } = resolveVisionProvider();
  const sourceLang = CONFIG.imageSourceLang || CONFIG.sourceLang || '';
  const prompt = buildOcrPrompt(sourceLang);

  const requestData = provider.buildVisionRequest(imageBase64, prompt, model, apiKey);
  const url = buildVisionUrl(provider, providerKey, model, apiKey);

  const { status, data } = await postJsonViaGM(url, requestData.headers, requestData.data, 120000);
  if (status < 200 || status >= 300) {
    throw new Error(`Vision request failed (${status})`);
  }

  return provider.extractText(data);
}

export function isImageTranslationEnabled() {
  return CONFIG.imageVisionModel !== '';
}

export async function triggerImageTranslation() {
  if (_imageTranslationInProgress) return;
  if (!isImageTranslationEnabled()) return;

  _imageTranslationInProgress = true;

  try {
    // Pause video
    const video = document.querySelector('video');
    if (video && !video.paused) video.pause();
    const captureMs = video ? video.currentTime * 1000 : 0;

    // Temporarily disable overlays so tick() won't re-show them during the dialog
    const savedEnabled = state.enabled;
    const savedImageOverlayEnabled = state.imageOverlayEnabled;
    state.enabled = false;
    state.imageOverlayEnabled = false;
    // Force-hide all overlays (tick() will keep them hidden while disabled)
    if (state.overlayEl) state.overlayEl.style.display = 'none';
    if (state.origOverlayEl) { state.origOverlayEl.textContent = ''; state.origOverlayEl.style.display = 'none'; }
    if (state.imageOverlayEl) state.imageOverlayEl.style.display = 'none';

    // Hide all other UI elements that would appear in the screenshot
    const uiElements = [state.panelEl, state.statusEl, state.fabEl, state.transcriptPanelEl, state.rateLimitBannerEl];
    const savedDisplays = uiElements.map(el => el?.style.display);
    uiElements.forEach(el => { if (el) el.style.display = 'none'; });

    // Capture frame (getDisplayMedia dialog appears here — tick() runs but overlays stay hidden)
    let imageBase64;
    try {
      imageBase64 = await captureDisplayFrame();
    } finally {
      // Restore overlay state so tick() resumes normal rendering
      state.enabled = savedEnabled;
      state.imageOverlayEnabled = savedImageOverlayEnabled;
      // Restore UI elements
      uiElements.forEach((el, i) => { if (el) el.style.display = savedDisplays[i] || ''; });
    }

    // OCR via vision LLM
    logInfo('📷 Image capture complete, sending to vision LLM...');
    showStatus('Extracting image text...', 'working', true);
    const ocrText = await callVisionOcr(imageBase64);

    if (!ocrText || ocrText.trim() === NO_TEXT) {
      logInfo('📷 No text detected in image');
      showStatus('No text detected in image', 'info', true);
      return;
    }
    logInfo(`📷 OCR result: ${ocrText.replace(/\n/g, ' | ').slice(0, 200)}`);

    // Build image cue — encode line breaks as emdash (same as subtitle cues)
    // so the translation pipeline preserves them, and formatCueTextForDisplay converts back
    const displayDuration = CONFIG.imageDisplayDuration || 3000;
    const encodedText = ocrText.replace(/\n/g, '—');
    const cue = { begin: captureMs, end: captureMs + displayDuration, text: encodedText };

    // Push OCR text immediately (shown as placeholder)
    state.imageOriginalCues.push({ ...cue });
    state.imageTranslatedCues.push({ ...cue });
    const insertedIndex = state.imageTranslatedCues.length - 1;

    // Translate via pipeline — isolate flaggedLines so image translation
    // at globalOffset=0 doesn't pollute subtitle cue 0's flagged status
    showStatus('Translating image text...', 'working', true);
    const context = createBrowserContext();
    const savedFlagged = state.flaggedLines;
    const savedReasons = state.flagReasons;
    state.flaggedLines = new Set();
    state.flagReasons = new Map();
    let translatedText;
    try {
      [translatedText] = await translateChunkLLM([cue], [], 0, context);
    } finally {
      state.flaggedLines = savedFlagged;
      state.flagReasons = savedReasons;
    }

    // Update translated cue
    state.imageTranslatedCues[insertedIndex].text = translatedText;

    // Cache both arrays
    cacheSet('image:url:' + location.pathname, {
      imageOriginalCues: state.imageOriginalCues,
      imageTranslatedCues: state.imageTranslatedCues,
    });

    logInfo(`📷 Image translated: ${translatedText.replace(/\n/g, ' | ').slice(0, 200)}`);
    showStatus('Image text translated', 'success', true);
  } catch (err) {
    showStatus(`Image translation failed: ${err.message}`, 'error', true);
  } finally {
    _imageTranslationInProgress = false;
  }
}

/**
 * Restore cached image cues from GM storage.
 */
export function restoreImageCuesFromCache() {
  const cached = cacheGet('image:url:' + location.pathname);
  if (cached?.imageOriginalCues?.length) {
    state.imageOriginalCues = cached.imageOriginalCues;
    state.imageTranslatedCues = cached.imageTranslatedCues || [];
  }
}

/**
 * Clear image cues (e.g. on URL change).
 */
export function clearImageCues() {
  state.imageOriginalCues = [];
  state.imageTranslatedCues = [];
}
