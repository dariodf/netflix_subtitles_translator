import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PROVIDERS, hasOllamaVisionCapability } from '../src/core/providers/definitions.js';
import { buildOcrPrompt, NO_TEXT } from '../src/core/vision-prompts.js';
import { createImageOverlay, updateImageOverlay } from '../src/ui/image-overlay.js';
import { state } from '../src/state.js';
import { CONFIG } from '../src/config.js';

// ─── Mock browser-side modules used by image-translate.js ───

vi.mock('../src/ui/status.js', () => ({ showStatus: vi.fn() }));
vi.mock('../src/browser/context.js', () => ({ createBrowserContext: vi.fn(() => ({})) }));
vi.mock('../src/pipeline/translate.js', () => ({
  translateChunkLLM: vi.fn(async ([cue]) => [cue.text + ' (translated)']),
  translateWithLLM: vi.fn(),
}));
vi.mock('../src/browser/http.js', () => ({
  postJsonViaGM: vi.fn(async () => ({ status: 200, data: {} })),
  fetchJsonViaGM: vi.fn(),
}));
vi.mock('../src/browser/cache.js', () => ({
  cacheGet: vi.fn(() => null),
  cacheSet: vi.fn(),
}));

import { showStatus } from '../src/ui/status.js';
import { translateChunkLLM } from '../src/pipeline/translate.js';
import { postJsonViaGM } from '../src/browser/http.js';
import { cacheGet, cacheSet } from '../src/browser/cache.js';
import {
  isImageTranslationEnabled,
  restoreImageCuesFromCache,
  clearImageCues,
  triggerImageTranslation,
} from '../src/browser/image-translate.js';

// ─── buildOcrPrompt ───

describe('buildOcrPrompt', () => {
  it('includes source language hint when provided', () => {
    const prompt = buildOcrPrompt('Japanese');
    expect(prompt).toContain('Japanese');
    expect(prompt).toContain('NO_TEXT');
  });

  it('omits language hint when source language is empty', () => {
    const prompt = buildOcrPrompt('');
    expect(prompt).not.toContain('likely in');
    expect(prompt).toContain('NO_TEXT');
  });

  it('instructs to return NO_TEXT when no text visible', () => {
    const prompt = buildOcrPrompt('Korean');
    expect(prompt).toContain('NO_TEXT');
  });

  it('asks to preserve line breaks', () => {
    const prompt = buildOcrPrompt('');
    expect(prompt).toContain('line breaks');
  });
});

// ─── buildVisionRequest per provider ───

describe('buildVisionRequest', () => {
  const testBase64 = 'aW1hZ2VkYXRh'; // "imagedata" in base64
  const testPrompt = 'Extract text from this image';

  describe('ollama', () => {
    it('produces correct request shape with images array', () => {
      const result = PROVIDERS.ollama.buildVisionRequest(testBase64, testPrompt, 'moondream', '');
      const data = JSON.parse(result.data);

      expect(data.model).toBe('moondream');
      expect(data.stream).toBe(false);
      expect(data.messages).toHaveLength(1);
      expect(data.messages[0].role).toBe('user');
      expect(data.messages[0].content).toBe(testPrompt);
      expect(data.messages[0].images).toEqual([testBase64]);
    });

    it('includes auth header when API key provided', () => {
      const result = PROVIDERS.ollama.buildVisionRequest(testBase64, testPrompt, 'moondream', 'secret');
      expect(result.headers['Authorization']).toBe('Bearer secret');
    });

    it('omits auth header when no API key', () => {
      const result = PROVIDERS.ollama.buildVisionRequest(testBase64, testPrompt, 'moondream', '');
      expect(result.headers['Authorization']).toBeUndefined();
    });

    it('returns { headers, data } shape', () => {
      const result = PROVIDERS.ollama.buildVisionRequest(testBase64, testPrompt, 'moondream', '');
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('data');
      expect(typeof result.data).toBe('string');
    });
  });

  describe('gemini', () => {
    it('produces correct request shape with inlineData', () => {
      const result = PROVIDERS.gemini.buildVisionRequest(testBase64, testPrompt, 'gemini-2.0-flash', 'test-key');
      const data = JSON.parse(result.data);

      expect(data.contents).toHaveLength(1);
      expect(data.contents[0].role).toBe('user');
      expect(data.contents[0].parts).toHaveLength(2);
      expect(data.contents[0].parts[0].inlineData).toEqual({
        mimeType: 'image/jpeg',
        data: testBase64,
      });
      expect(data.contents[0].parts[1].text).toBe(testPrompt);
    });

    it('includes urlSuffix and API key header', () => {
      const result = PROVIDERS.gemini.buildVisionRequest(testBase64, testPrompt, 'gemini-2.0-flash', 'my-key');
      expect(result.urlSuffix).toBe('gemini-2.0-flash:generateContent');
      expect(result.headers['x-goog-api-key']).toBe('my-key');
    });
  });

  describe('anthropic', () => {
    it('produces correct request shape with image source block', () => {
      const result = PROVIDERS.anthropic.buildVisionRequest(testBase64, testPrompt, 'claude-haiku-4-5-20251001', 'sk-test');
      const data = JSON.parse(result.data);

      expect(data.model).toBe('claude-haiku-4-5-20251001');
      expect(data.max_tokens).toBe(8192);
      expect(data.messages).toHaveLength(1);
      expect(data.messages[0].content).toHaveLength(2);
      expect(data.messages[0].content[0]).toEqual({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: testBase64 },
      });
      expect(data.messages[0].content[1]).toEqual({
        type: 'text',
        text: testPrompt,
      });
    });

    it('includes correct headers', () => {
      const result = PROVIDERS.anthropic.buildVisionRequest(testBase64, testPrompt, 'claude-haiku-4-5-20251001', 'sk-test');
      expect(result.headers['x-api-key']).toBe('sk-test');
      expect(result.headers['anthropic-version']).toBe('2023-06-01');
    });
  });

  describe('groq', () => {
    it('produces OpenAI-compatible image_url format', () => {
      const result = PROVIDERS.groq.buildVisionRequest(testBase64, testPrompt, 'llama-4-scout-17b-16e-instruct', 'gsk-test');
      const data = JSON.parse(result.data);

      expect(data.model).toBe('llama-4-scout-17b-16e-instruct');
      expect(data.messages).toHaveLength(1);
      expect(data.messages[0].content).toHaveLength(2);
      expect(data.messages[0].content[0]).toEqual({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${testBase64}` },
      });
      expect(data.messages[0].content[1]).toEqual({
        type: 'text',
        text: testPrompt,
      });
    });
  });

  describe('openrouter', () => {
    it('produces OpenAI-compatible image_url format with custom headers', () => {
      const result = PROVIDERS.openrouter.buildVisionRequest(testBase64, testPrompt, 'google/gemini-2.0-flash-001:free', 'or-test');
      const data = JSON.parse(result.data);

      expect(data.messages[0].content[0].type).toBe('image_url');
      expect(data.messages[0].content[0].image_url.url).toContain('data:image/jpeg;base64,');
      expect(result.headers['HTTP-Referer']).toBeDefined();
      expect(result.headers['X-Title']).toBe('Netflix Subtitle Translator');
    });
  });

  describe('non-vision providers', () => {
    it('mistral does not have buildVisionRequest', () => {
      expect(PROVIDERS.mistral.buildVisionRequest).toBeUndefined();
      expect(PROVIDERS.mistral.supportsVision).toBeFalsy();
    });

    it('libretranslate does not have buildVisionRequest', () => {
      expect(PROVIDERS.libretranslate.buildVisionRequest).toBeUndefined();
      expect(PROVIDERS.libretranslate.supportsVision).toBeFalsy();
    });

    it('lingva does not have buildVisionRequest', () => {
      expect(PROVIDERS.lingva.buildVisionRequest).toBeUndefined();
      expect(PROVIDERS.lingva.supportsVision).toBeFalsy();
    });

    it('google_free does not have buildVisionRequest', () => {
      expect(PROVIDERS.google_free.buildVisionRequest).toBeUndefined();
      expect(PROVIDERS.google_free.supportsVision).toBeFalsy();
    });
  });
});

// ─── supportsVision flag ───

describe('supportsVision flag', () => {
  it('is true for vision-capable providers', () => {
    expect(PROVIDERS.ollama.supportsVision).toBe(true);
    expect(PROVIDERS.gemini.supportsVision).toBe(true);
    expect(PROVIDERS.anthropic.supportsVision).toBe(true);
    expect(PROVIDERS.groq.supportsVision).toBe(true);
    expect(PROVIDERS.openrouter.supportsVision).toBe(true);
  });

  it('is absent/falsy for non-vision providers', () => {
    expect(PROVIDERS.mistral.supportsVision).toBeFalsy();
    expect(PROVIDERS.libretranslate.supportsVision).toBeFalsy();
    expect(PROVIDERS.lingva.supportsVision).toBeFalsy();
    expect(PROVIDERS.google_free.supportsVision).toBeFalsy();
  });
});

// ─── visionModels curated lists ───

describe('visionModels lists', () => {
  it('gemini has vision models', () => {
    expect(PROVIDERS.gemini.visionModels.length).toBeGreaterThan(0);
    expect(PROVIDERS.gemini.visionModels[0]).toHaveProperty('id');
    expect(PROVIDERS.gemini.visionModels[0]).toHaveProperty('name');
  });

  it('anthropic has vision models', () => {
    expect(PROVIDERS.anthropic.visionModels.length).toBeGreaterThan(0);
  });

  it('groq has vision models', () => {
    expect(PROVIDERS.groq.visionModels.length).toBeGreaterThan(0);
  });

  it('openrouter has vision models', () => {
    expect(PROVIDERS.openrouter.visionModels.length).toBeGreaterThan(0);
  });

  it('ollama does not have a hardcoded visionModels list (dynamic detection)', () => {
    expect(PROVIDERS.ollama.visionModels).toBeUndefined();
  });
});

// ─── hasOllamaVisionCapability ───

describe('hasOllamaVisionCapability', () => {
  it('returns true when capabilities include vision', async () => {
    const mockPostJson = async () => ({
      data: { capabilities: ['completion', 'vision', 'tools'] },
    });
    const result = await hasOllamaVisionCapability(mockPostJson, 'http://localhost:11434', 'moondream');
    expect(result).toBe(true);
  });

  it('returns false when capabilities do not include vision', async () => {
    const mockPostJson = async () => ({
      data: { capabilities: ['completion', 'tools'] },
    });
    const result = await hasOllamaVisionCapability(mockPostJson, 'http://localhost:11434', 'qwen2.5:3b');
    expect(result).toBe(false);
  });

  it('returns false when capabilities field is missing', async () => {
    const mockPostJson = async () => ({
      data: { model: 'something' },
    });
    const result = await hasOllamaVisionCapability(mockPostJson, 'http://localhost:11434', 'unknown');
    expect(result).toBe(false);
  });

  it('returns false on network error', async () => {
    const mockPostJson = async () => { throw new Error('Connection refused'); };
    const result = await hasOllamaVisionCapability(mockPostJson, 'http://localhost:11434', 'moondream');
    expect(result).toBe(false);
  });

  it('strips /api/chat from URL before building /api/show path', async () => {
    let calledUrl = '';
    const mockPostJson = async (url) => {
      calledUrl = url;
      return { data: { capabilities: ['vision'] } };
    };
    await hasOllamaVisionCapability(mockPostJson, 'http://localhost:11434/api/chat', 'moondream');
    expect(calledUrl).toBe('http://localhost:11434/api/show');
  });

  it('works with custom Ollama URL', async () => {
    let calledUrl = '';
    const mockPostJson = async (url) => {
      calledUrl = url;
      return { data: { capabilities: ['vision'] } };
    };
    await hasOllamaVisionCapability(mockPostJson, 'http://nixos:11434', 'moondream');
    expect(calledUrl).toBe('http://nixos:11434/api/show');
  });
});

// ─── updateImageOverlay ───

describe('updateImageOverlay', () => {
  afterEach(() => {
    if (state.imageOverlayEl && state.imageOverlayEl.parentNode) {
      state.imageOverlayEl.parentNode.removeChild(state.imageOverlayEl);
    }
    state.imageOverlayEl = null;
  });

  beforeEach(() => {
    // Reset relevant state
    state.imageOverlayEnabled = true;
    state.imageShowOriginal = false;
    state.imageTranslatedCues = [];
    state.imageOriginalCues = [];
    state.imageOverlayEl = null;

    // Use the real createImageOverlay to set up DOM + cached refs
    createImageOverlay();
  });

  it('shows translated cue when currentMs is within [begin, end]', () => {
    state.imageTranslatedCues = [
      { begin: 1000, end: 3000, text: 'Hello world' },
    ];

    updateImageOverlay(2000);

    const textEl = state.imageOverlayEl.querySelector('#subtranslator-image-overlay-text');
    expect(textEl.textContent).toBe('Hello world');
    expect(state.imageOverlayEl.style.display).toBe('block');
  });

  it('clears overlay when currentMs is outside all cue windows', () => {
    state.imageTranslatedCues = [
      { begin: 1000, end: 3000, text: 'Hello world' },
    ];

    // First show something so we can verify it gets cleared
    updateImageOverlay(2000);
    expect(state.imageOverlayEl.querySelector('#subtranslator-image-overlay-text').textContent).toBe('Hello world');

    // Now move outside the window
    updateImageOverlay(5000);

    const textEl = state.imageOverlayEl.querySelector('#subtranslator-image-overlay-text');
    expect(textEl.textContent).toBe('');
    expect(state.imageOverlayEl.style.display).toBe('none');
  });

  it('shows last matching cue when multiple overlap', () => {
    state.imageTranslatedCues = [
      { begin: 1000, end: 5000, text: 'First cue' },
      { begin: 2000, end: 6000, text: 'Second cue' },
      { begin: 3000, end: 7000, text: 'Third cue' },
    ];

    // At 4000ms, all three overlap; should pick the last one (highest index)
    updateImageOverlay(4000);

    const textEl = state.imageOverlayEl.querySelector('#subtranslator-image-overlay-text');
    expect(textEl.textContent).toBe('Third cue');
  });

  it('shows original OCR text when state.imageShowOriginal is true', () => {
    state.imageOriginalCues = [
      { begin: 1000, end: 3000, text: 'Original OCR text' },
    ];
    state.imageTranslatedCues = [
      { begin: 1000, end: 3000, text: 'Translated text' },
    ];
    state.imageShowOriginal = true;

    updateImageOverlay(2000);

    const textEl = state.imageOverlayEl.querySelector('#subtranslator-image-overlay-text');
    expect(textEl.textContent).toBe('Original OCR text');
  });

  it('clears when state.imageOverlayEnabled is false', () => {
    state.imageTranslatedCues = [
      { begin: 1000, end: 3000, text: 'Hello world' },
    ];

    // First show a cue
    updateImageOverlay(2000);
    expect(state.imageOverlayEl.querySelector('#subtranslator-image-overlay-text').textContent).toBe('Hello world');

    // Disable the feature
    state.imageOverlayEnabled = false;
    updateImageOverlay(2000);

    const textEl = state.imageOverlayEl.querySelector('#subtranslator-image-overlay-text');
    expect(textEl.textContent).toBe('');
    expect(state.imageOverlayEl.style.display).toBe('none');
  });
});

// ─── isImageTranslationEnabled ───

describe('isImageTranslationEnabled', () => {
  let savedModel;

  beforeEach(() => {
    savedModel = CONFIG.imageVisionModel;
  });

  afterEach(() => {
    CONFIG.imageVisionModel = savedModel;
  });

  it('returns true when imageVisionModel is set', () => {
    CONFIG.imageVisionModel = 'moondream';
    expect(isImageTranslationEnabled()).toBe(true);
  });

  it('returns false when imageVisionModel is empty string', () => {
    CONFIG.imageVisionModel = '';
    expect(isImageTranslationEnabled()).toBe(false);
  });
});

// ─── clearImageCues ───

describe('clearImageCues', () => {
  it('resets both imageOriginalCues and imageTranslatedCues to empty arrays', () => {
    state.imageOriginalCues = [{ begin: 0, end: 3000, text: 'hello' }];
    state.imageTranslatedCues = [{ begin: 0, end: 3000, text: 'hola' }];

    clearImageCues();

    expect(state.imageOriginalCues).toEqual([]);
    expect(state.imageTranslatedCues).toEqual([]);
  });

  it('works when arrays are already empty', () => {
    state.imageOriginalCues = [];
    state.imageTranslatedCues = [];

    clearImageCues();

    expect(state.imageOriginalCues).toEqual([]);
    expect(state.imageTranslatedCues).toEqual([]);
  });
});

// ─── restoreImageCuesFromCache ───

describe('restoreImageCuesFromCache', () => {
  beforeEach(() => {
    state.imageOriginalCues = [];
    state.imageTranslatedCues = [];
    vi.clearAllMocks();
  });

  it('restores both arrays from cache when present', () => {
    const cachedOriginal = [{ begin: 0, end: 3000, text: 'hello' }];
    const cachedTranslated = [{ begin: 0, end: 3000, text: 'hola' }];
    cacheGet.mockReturnValue({
      imageOriginalCues: cachedOriginal,
      imageTranslatedCues: cachedTranslated,
    });

    restoreImageCuesFromCache();

    expect(state.imageOriginalCues).toEqual(cachedOriginal);
    expect(state.imageTranslatedCues).toEqual(cachedTranslated);
  });

  it('does nothing when cache returns null', () => {
    cacheGet.mockReturnValue(null);

    restoreImageCuesFromCache();

    expect(state.imageOriginalCues).toEqual([]);
    expect(state.imageTranslatedCues).toEqual([]);
  });

  it('does nothing when cached imageOriginalCues is empty', () => {
    cacheGet.mockReturnValue({
      imageOriginalCues: [],
      imageTranslatedCues: [],
    });

    restoreImageCuesFromCache();

    expect(state.imageOriginalCues).toEqual([]);
    expect(state.imageTranslatedCues).toEqual([]);
  });

  it('defaults imageTranslatedCues to empty array if missing from cache', () => {
    cacheGet.mockReturnValue({
      imageOriginalCues: [{ begin: 0, end: 3000, text: 'hello' }],
    });

    restoreImageCuesFromCache();

    expect(state.imageOriginalCues).toEqual([{ begin: 0, end: 3000, text: 'hello' }]);
    expect(state.imageTranslatedCues).toEqual([]);
  });

  it('uses location.pathname as the cache key', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/watch/81234567' },
      configurable: true,
    });
    cacheGet.mockReturnValue(null);

    restoreImageCuesFromCache();

    expect(cacheGet).toHaveBeenCalledWith('image:url:/watch/81234567');
  });
});

// ─── triggerImageTranslation ───
// Note: triggerImageTranslation requires getDisplayMedia + ImageCapture (browser APIs
// not available in jsdom). Tests here cover the parts that don't need frame capture.
// Full integration tests require a real browser environment.

describe('triggerImageTranslation', () => {
  let savedModel;

  beforeEach(() => {
    savedModel = CONFIG.imageVisionModel;
    state.imageOriginalCues = [];
    state.imageTranslatedCues = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    CONFIG.imageVisionModel = savedModel;
  });

  it('returns immediately when imageVisionModel is not configured', async () => {
    CONFIG.imageVisionModel = '';
    await triggerImageTranslation();
    expect(postJsonViaGM).not.toHaveBeenCalled();
    expect(state.imageOriginalCues).toEqual([]);
  });

  it('guard flag is cleared on error (try/finally) so feature does not lock', async () => {
    CONFIG.imageVisionModel = 'moondream';
    // getDisplayMedia doesn't exist in jsdom, so triggerImageTranslation will throw
    // but the finally block should clear the guard flag
    await triggerImageTranslation();
    // If guard flag was not cleared, this second call would be a no-op
    // and showStatus would only be called once. Two calls = guard was cleared.
    await triggerImageTranslation();
    // showStatus should have been called at least twice (once per failed attempt)
    expect(showStatus).toHaveBeenCalledTimes(2);
  });
});
