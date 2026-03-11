import { logInfo } from '../core/utils.js';
import { state } from '../state.js';

// ============================
// TRANSLATION CACHE (GM storage, persists across reloads)
// ============================

const MAX_CACHE_ENTRIES = 20; // ~10 episodes × 2 keys = ~1MB, safe for all browsers

/** @returns {Object} */
function loadCache() {
  try { return JSON.parse(GM_getValue('translationCache', '{}')); } catch { return {}; }
}

let translationCache = loadCache();

/** Determine which cache keys to evict using LRU strategy */
export function evictOldestEntries(cache, maxSize, preserveKey) {
  const keys = Object.keys(cache);
  if (keys.length <= maxSize) return [];
  const sorted = keys
    .filter(k => k !== preserveKey)
    .map(k => ({ k, ts: (typeof cache[k] === 'object' && cache[k]?._ts) || 0 }))
    .sort((a, b) => a.ts - b.ts);
  return sorted.slice(0, keys.length - maxSize).map(e => e.k);
}

export function cacheGet(key) {
  const entry = translationCache[key];
  if (entry === undefined || entry === null) return null;
  if (typeof entry === 'object' && !Array.isArray(entry)) entry._ts = Date.now();
  return entry;
}

export function cacheSet(key, value) {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) value._ts = Date.now();
  translationCache[key] = value;
  const toRemove = evictOldestEntries(translationCache, MAX_CACHE_ENTRIES, 'url:' + location.pathname);
  for (const k of toRemove) delete translationCache[k];
  if (toRemove.length > 0) logInfo(`Cache evicted ${toRemove.length} old entries`);
  try { GM_setValue('translationCache', JSON.stringify(translationCache)); } catch { /* ignore */ }
}

export function cacheClear() {
  translationCache = {};
  GM_setValue('translationCache', '{}');
}

export function cacheSetWithUrl(cacheKey, translatedArr, originalCues, fullPassProgress) {
  cacheSet(cacheKey, translatedArr);
  const urlData = {
    translatedCues: translatedArr,
    originalCues: originalCues,
    cacheKey: cacheKey,
    flaggedLines: [...state.flaggedLines],
  };
  if (fullPassProgress !== undefined) urlData.fullPassProgress = fullPassProgress;
  cacheSet('url:' + location.pathname, urlData);
}
