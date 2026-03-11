import { CONFIG, saveConfig } from '../config.js';
import { state } from '../state.js';
import { cacheGet, cacheSet, cacheClear, cacheSetWithUrl } from './cache.js';
import { postJsonViaGM, fetchJsonViaGM } from './http.js';
import { glossary } from '../core/glossary.js';
import { PROVIDERS } from '../core/providers/definitions.js';
import { showStatus, showRateLimitBanner } from '../ui/status.js';
import { createOverlay } from '../ui/overlay.js';
import { refreshTranscriptContent } from '../ui/transcript.js';
import { getSecondProviderOverride } from '../providers/secondary.js';
import { getShowMetadata, fetchShowMetadata } from './metadata-fetcher.js';

export function createBrowserContext() {
  return {
    config: CONFIG,

    postJson: postJsonViaGM,
    fetchJson: fetchJsonViaGM,

    cacheGet,
    cacheSet,
    cacheClear,
    cacheSetWithUrl,

    reportStatus(message, type) { showStatus(message, type); },
    reportRateLimit(providerName) {
      showRateLimitBanner(providerName, {
        onSwapModel: () => {
          const provider = PROVIDERS[CONFIG.provider];
          if (!provider?.models?.length) return null;
          const index = provider.models.findIndex(m => m.id === CONFIG.model);
          const next = provider.models[(index + 1) % provider.models.length];
          CONFIG.model = next.id;
          saveConfig();
          state.onRetranslate?.();
          return next;
        },
      });
    },

    glossary,

    sharedTranslationState: {
      get translatedCues() { return state.translatedCues; },
      set translatedCues(v) { state.translatedCues = v; },
      get originalCues() { return state.originalCues; },
      set originalCues(v) { state.originalCues = v; },
      get activeCacheKey() { return state.activeCacheKey; },
      set activeCacheKey(v) { state.activeCacheKey = v; },
      get flaggedLines() { return state.flaggedLines; },
      set flaggedLines(v) { state.flaggedLines = v; },
      get flagReasons() { return state.flagReasons; },
      set flagReasons(v) { state.flagReasons = v; },
      get isTranslating() { return state.isTranslating; },
      set isTranslating(v) { state.isTranslating = v; },
      get translationPassLabel() { return state.translationPassLabel; },
      set translationPassLabel(v) { state.translationPassLabel = v; },
    },

    getVideoPositionMs() {
      const video = document.querySelector('video');
      return video ? video.currentTime * 1000 : null;
    },

    onVideoSeek(callback) {
      const video = document.querySelector('video');
      if (!video) return () => {};
      const handler = () => callback(video.currentTime * 1000);
      video.addEventListener('seeked', handler);
      return () => video.removeEventListener('seeked', handler);
    },

    commitTranslation(translatedCues, options = {}) {
      state.translatedCues = translatedCues;
      if (!state.overlayEl) createOverlay();
      if (state.transcriptVisible) refreshTranscriptContent();
      if (options.cacheKey) {
        cacheSetWithUrl(options.cacheKey, translatedCues, options.originalCues, options.cacheExtra);
      }
    },

    get locationPathname() { return location.pathname; },

    get showMetadata() { return getShowMetadata(); },
    fetchShowMetadata,

    onTtmlMetadata(meta) { state.latestTtmlMetadata = meta; },

    getSecondProviderOverride,
  };
}
