export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function makeCue(original, text) {
  return { begin: original.begin, end: original.end, text };
}

/** Validate that a URL uses http:// or https:// scheme. */
export function isValidHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const LOG_PREFIX = '[SubTranslator]';
export function logInfo(...args) { console.log(LOG_PREFIX, ...args); }
export function logWarn(...args) { console.warn(LOG_PREFIX, ...args); }
export function logError(...args) { console.error(LOG_PREFIX, ...args); }
