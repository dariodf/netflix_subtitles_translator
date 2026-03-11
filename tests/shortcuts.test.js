import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { state } from '../src/state.js';
import { CONFIG } from '../src/config.js';

// Stub out modules with heavy browser/DOM side effects
vi.mock('../src/ui/settings/index.js', () => ({ togglePanel: vi.fn() }));
vi.mock('../src/ui/status.js', () => ({ showStatus: vi.fn() }));
vi.mock('../src/ui/transcript.js', () => ({ toggleTranscript: vi.fn(), refreshTranscriptContent: vi.fn() }));
vi.mock('../src/providers/secondary.js', () => ({ getSecondProviderOverride: vi.fn(() => null) }));
vi.mock('../src/pipeline/handler.js', () => ({ buildCacheKey: vi.fn(() => 'key') }));
vi.mock('../src/pipeline/translate.js', () => ({ translateWithLLM: vi.fn(), translateChunkLLM: vi.fn() }));
vi.mock('../src/pipeline/cleanup.js', () => ({ runFullPass: vi.fn() }));
vi.mock('../src/pipeline/request.js', () => ({ _callLLMTranslate: vi.fn() }));
vi.mock('../src/browser/context.js', () => ({ createBrowserContext: vi.fn(() => ({})) }));

import { handleKeydown } from '../src/browser/shortcuts.js';
import { togglePanel } from '../src/ui/settings/index.js';
import { toggleTranscript } from '../src/ui/transcript.js';
import { showStatus } from '../src/ui/status.js';

// Dispatch a keyboard event on document.body so e.target is never null
function fireKey(key, shiftKey = false) {
  Object.defineProperty(window, 'location', { value: { pathname: '/watch/123' }, configurable: true });
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
}

describe('handleKeydown', () => {
  beforeEach(() => {
    state.translatedCues = [{ begin: 0, end: 1000, text: 'hello' }];
    state.showOrigOnFlagged = true;
    state.dualSubs = false;
    state.enabled = true;
    // Provide minimal overlay elements so shortcuts that guard on them don't bail early
    state.overlayEl = document.createElement('div');
    state.origOverlayEl = document.createElement('div');
    vi.clearAllMocks();
    document.addEventListener('keydown', handleKeydown);
  });

  afterEach(() => {
    document.removeEventListener('keydown', handleKeydown);
  });

  describe('Shift+C — clear cache', () => {
    it('resets translatedCues to empty array', () => {
      fireKey('C', true);
      expect(state.translatedCues).toEqual([]);
    });
  });

  describe('Shift+O — toggle orig on flagged', () => {
    it('toggles showOrigOnFlagged from true to false', () => {
      state.showOrigOnFlagged = true;
      fireKey('O', true);
      expect(state.showOrigOnFlagged).toBe(false);
    });

    it('toggles showOrigOnFlagged from false to true', () => {
      state.showOrigOnFlagged = false;
      fireKey('O', true);
      expect(state.showOrigOnFlagged).toBe(true);
    });
  });

  describe('s — toggle subtitles', () => {
    it('toggles enabled on and off', () => {
      state.enabled = true;
      fireKey('s');
      expect(state.enabled).toBe(false);
      fireKey('s');
      expect(state.enabled).toBe(true);
    });
  });

  describe('Shift+S — master toggle', () => {
    beforeEach(() => { CONFIG.masterEnabled = true; });

    it('toggles CONFIG.masterEnabled off', () => {
      fireKey('S', true);
      expect(CONFIG.masterEnabled).toBe(false);
    });

    it('toggles CONFIG.masterEnabled back on', () => {
      CONFIG.masterEnabled = false;
      fireKey('S', true);
      expect(CONFIG.masterEnabled).toBe(true);
    });

    it('clears overlay text when toggling off', () => {
      state.overlayEl.textContent = 'some subtitle';
      state.origOverlayEl.textContent = 'original text';
      fireKey('S', true);
      expect(state.overlayEl.textContent).toBe('');
      expect(state.origOverlayEl.textContent).toBe('');
    });

    it('shows status message', () => {
      fireKey('S', true);
      expect(showStatus).toHaveBeenCalledWith('Translation OFF', 'error', true);
      fireKey('S', true);
      expect(showStatus).toHaveBeenCalledWith('Translation ON', 'success', true);
    });
  });

  describe('o — toggle dual subs', () => {
    it('toggles dualSubs on and off', () => {
      state.dualSubs = false;
      fireKey('o');
      expect(state.dualSubs).toBe(true);
      fireKey('o');
      expect(state.dualSubs).toBe(false);
    });
  });

  describe('Shift+T — open settings panel', () => {
    it('calls togglePanel', () => {
      fireKey('T', true);
      expect(togglePanel).toHaveBeenCalled();
    });

    it('calls exitFullscreen when in fullscreen', () => {
      const exitMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(document, 'fullscreenElement', { value: document.body, configurable: true });
      document.exitFullscreen = exitMock;

      fireKey('T', true);
      expect(exitMock).toHaveBeenCalled();

      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    });

    it('does not call exitFullscreen when not in fullscreen', () => {
      const exitMock = vi.fn();
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
      document.exitFullscreen = exitMock;

      fireKey('T', true);
      expect(exitMock).not.toHaveBeenCalled();
    });
  });

  describe('d — timing offset delay', () => {
    it('increments timingOffset by timingStep', () => {
      const before = CONFIG.timingOffset;
      fireKey('d');
      expect(CONFIG.timingOffset).toBe(before + CONFIG.timingStep);
      CONFIG.timingOffset = before; // restore
    });

    it('also works with uppercase D', () => {
      const before = CONFIG.timingOffset;
      fireKey('D');
      expect(CONFIG.timingOffset).toBe(before + CONFIG.timingStep);
      CONFIG.timingOffset = before;
    });
  });

  describe('e — timing offset earlier', () => {
    it('decrements timingOffset by timingStep', () => {
      const before = CONFIG.timingOffset;
      fireKey('e');
      expect(CONFIG.timingOffset).toBe(before - CONFIG.timingStep);
      CONFIG.timingOffset = before;
    });

    it('also works with uppercase E', () => {
      const before = CONFIG.timingOffset;
      fireKey('E');
      expect(CONFIG.timingOffset).toBe(before - CONFIG.timingStep);
      CONFIG.timingOffset = before;
    });
  });

  describe('l — toggle transcript', () => {
    it('calls toggleTranscript', () => {
      fireKey('l');
      expect(toggleTranscript).toHaveBeenCalled();
    });

    it('also works with uppercase L', () => {
      vi.clearAllMocks();
      fireKey('L');
      expect(toggleTranscript).toHaveBeenCalled();
    });
  });

  describe('r — retry current chunk', () => {
    it('shows error status when no subtitles are loaded', () => {
      state.originalCues = null;
      fireKey('r');
      expect(showStatus).toHaveBeenCalledWith('No subtitles loaded yet', 'error', true);
    });

    it('also works with uppercase R', () => {
      state.originalCues = null;
      vi.clearAllMocks();
      fireKey('R');
      expect(showStatus).toHaveBeenCalledWith('No subtitles loaded yet', 'error', true);
    });
  });

  describe('Shift+A — retranslate all', () => {
    it('shows error status when no subtitles are loaded', () => {
      state.originalCues = null;
      fireKey('A', true);
      expect(showStatus).toHaveBeenCalledWith('No subtitles loaded yet', 'error', true);
    });

    it('shows error status when originalCues is empty', () => {
      state.originalCues = [];
      vi.clearAllMocks();
      fireKey('A', true);
      expect(showStatus).toHaveBeenCalledWith('No subtitles loaded yet', 'error', true);
    });
  });
});
