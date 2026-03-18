import { isSubtitleUrl } from '../core/parser.js';
import { handleSubtitlePayload } from '../pipeline/handler.js';
import { logError, logWarn, logInfo } from '../core/utils.js';
import { createBrowserContext } from './context.js';
import { CONFIG } from '../config.js';
import { state } from '../state.js';

/** Check if text looks like XML subtitle data (TTML/DFXP) */
export function isXmlSubtitle(text) {
  return text && (text.includes('<tt') || text.includes('<body') || text.includes('<?xml'));
}

/** Check if URL is a Netflix metadata API call */
export function isMetadataUrl(url) {
  return url && url.includes('/nq/website/memberapi/release/metadata');
}

function handleMetadataResponse(text) {
  try {
    const data = JSON.parse(text);
    if (data?.video?.title) {
      state.interceptedNetflixMetadata = data;
      logInfo(`🎬 Intercepted Netflix metadata: "${data.video.title}"`);
      document.dispatchEvent(new CustomEvent('st-metadata-updated'));
    }
  } catch { /* not valid JSON, ignore */ }
}

export function handleSubtitleData(xml, url) {
  if (!CONFIG.masterEnabled) return;
  return handleSubtitlePayload(xml, url, createBrowserContext());
}

// ============================
// GRAB NATIVE REFS BEFORE SES LOCKDOWN
// ============================
const nativeMethods = { fetch: null, xhrOpen: null, xhrSend: null };
try {
  nativeMethods.fetch = window.fetch ? window.fetch.bind(window) : null;
  nativeMethods.xhrOpen = XMLHttpRequest.prototype.open;
  nativeMethods.xhrSend = XMLHttpRequest.prototype.send;
} catch (e) {
  logError('Failed to capture native refs:', e);
}

// Try to override fetch/XHR immediately (before SES freezes them)
let _fetchOverridden = false;
let _xhrOverridden = false;

try {
  const origFetchDesc = Object.getOwnPropertyDescriptor(window, 'fetch');
  if (!origFetchDesc || origFetchDesc.configurable !== false) {
    window.fetch = async function (...args) {
      const response = await nativeMethods.fetch(...args);
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (url && (isSubtitleUrl(url) || isMetadataUrl(url))) {
        try {
          const clone = response.clone();
          clone.text().then((text) => {
            if (isSubtitleUrl(url) && isXmlSubtitle(text)) {
              handleSubtitleData(text, url);
            } else if (isMetadataUrl(url)) {
              handleMetadataResponse(text);
            }
          }).catch(() => {});
        } catch (e) { logWarn('Clone error:', e); }
      }
      return response;
    };
    _fetchOverridden = true;
  } else {
    logWarn('fetch is non-configurable, skipping override');
  }
} catch (e) {
  logWarn('Could not override fetch (SES locked):', e.message);
}

try {
  const xhrOpenDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'open');
  if (!xhrOpenDesc || xhrOpenDesc.configurable !== false) {
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._interceptUrl = url;
      return nativeMethods.xhrOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      const url = this._interceptUrl;
      if (url && (isSubtitleUrl(url) || isMetadataUrl(url))) {
        this.addEventListener('load', () => {
          try {
            let text;

            if (this.responseType === '' || this.responseType === 'text') {
              text = this.responseText;
            } else if (this.responseType === 'arraybuffer' && this.response) {
              try { text = new TextDecoder('utf-8').decode(this.response); }
              catch { logWarn('⚠️ Failed to decode arraybuffer'); return; }
            } else if (this.responseType === 'blob' && this.response) {
              this.response.text().then((t) => {
                if (isSubtitleUrl(url) && isXmlSubtitle(t)) {
                  handleSubtitleData(t, url);
                } else if (isMetadataUrl(url)) {
                  handleMetadataResponse(t);
                }
              }).catch(() => {});
              return;
            } else {
              return;
            }
            if (isSubtitleUrl(url) && text && isXmlSubtitle(text)) {
              handleSubtitleData(text, url);
            } else if (isMetadataUrl(url) && text) {
              handleMetadataResponse(text);
            }
          } catch (e) { logWarn('XHR intercept error:', e); }
        });
      }
      return nativeMethods.xhrSend.apply(this, args);
    };
    _xhrOverridden = true;
  } else {
    logWarn('XHR is non-configurable, skipping override');
  }
} catch (e) {
  logWarn('Could not override XHR (SES locked):', e.message);
}

// ============================
// FALLBACK: PerformanceObserver to detect subtitle & metadata URLs
// ============================
let observerActive = false;

export function startNetworkObserver() {
  if (observerActive) return;
  try {
    const seen = new Set();
    let metadataCaptured = false;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.name || seen.has(entry.name)) continue;

        if (isSubtitleUrl(entry.name)) {
          seen.add(entry.name);
          GM_xmlhttpRequest({
            method: 'GET',
            url: entry.name,
            timeout: 15000,
            onload(resp) {
              if (isXmlSubtitle(resp.responseText)) {
                handleSubtitleData(resp.responseText, entry.name);
              }
            },
          });
        } else if (isMetadataUrl(entry.name) && !metadataCaptured) {
          metadataCaptured = true;
          seen.add(entry.name);
          GM_xmlhttpRequest({
            method: 'GET',
            url: entry.name,
            timeout: 10000,
            onload(resp) {
              handleMetadataResponse(resp.responseText);
            },
          });
        }
      }
    });
    observer.observe({ type: 'resource', buffered: true });
    observerActive = true;

  } catch (e) {
    logWarn('PerformanceObserver not available:', e.message);
  }
}
