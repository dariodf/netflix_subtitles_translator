import { glossary } from '../core/glossary.js';
import { createFileCache } from './cache.js';

async function nodeFetch(url, headers, data, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof data === 'string' ? data : JSON.stringify(data),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error('Parse error: ' + err.message);
    }

    return { status: response.status, data: parsed };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    if (err.message.startsWith('Parse error:')) throw err;
    throw new Error('Network error');
  } finally {
    clearTimeout(timer);
  }
}

async function nodeFetchJson(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export { nodeFetch as nodePostJson };

export function createHeadlessContext(config, { cachePath = null, showMetadata = null } = {}) {
  const cache = cachePath ? createFileCache(cachePath) : { get: () => null, set: () => {}, setWithUrl: () => {}, clear: () => {} };

  const sharedTranslationState = {
    translatedCues: [],
    originalCues: null,
    activeCacheKey: null,
    flaggedLines: new Set(),
    flagReasons: new Map(),
    isTranslating: false,
    translationPassLabel: null,
    firstChunkMetrics: null,
    glossaryElapsedMs: 0,
    debugLog: [],
  };

  return {
    config,

    postJson: nodeFetch,
    fetchJson: nodeFetchJson,

    cacheGet(key) { return cache.get(key); },
    cacheSet(key, value) { cache.set(key, value); },
    cacheClear() { cache.clear(); },
    cacheSetWithUrl(key, translatedCues, originalCues, cacheExtra) {
      cache.setWithUrl(key, translatedCues, originalCues, cacheExtra);
    },

    reportStatus(message, type) {
      const prefix = type === 'error' ? '❌' : type === 'working' ? '⏳' : type === 'success' ? '✅' : 'ℹ️';
      console.log(`${prefix} ${message}`);
    },
    reportRateLimit(providerName) {
      console.warn(`⚠️ Rate limited by ${providerName}`);
    },

    glossary,

    sharedTranslationState,

    // No video in headless mode — sequential chunk ordering
    getVideoPositionMs() { return null; },
    onVideoSeek() { return () => {}; },

    // No UI commit — just update state
    commitTranslation(translatedCues) {
      sharedTranslationState.translatedCues = translatedCues;
    },

    get locationPathname() { return ''; },

    get showMetadata() { return showMetadata; },
    fetchShowMetadata: async () => showMetadata,

    onTtmlMetadata() {},

    getSecondProviderOverride() {
      if (!config.secondEnabled || !config.secondProvider || !config.secondModel) return null;
      return {
        provider: config.secondProvider,
        model: config.secondModel,
        apiKey: config.secondApiKey || null,
      };
    },
  };
}
