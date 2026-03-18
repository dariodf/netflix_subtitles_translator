// Netflix Subtitle Translator
// MIT License — Copyright (c) 2025 Contributors
//
// Not affiliated with Netflix, Inc. For personal, non-commercial use only.
// Users are responsible for complying with Netflix's Terms of Use.
// This software is provided "as is" without warranty. Use at your own risk.

// Must be first — captures native refs before SES lockdown
import { startNetworkObserver } from './intercept.js';

import { CONFIG, saveConfig } from '../config.js';
import { PROVIDERS } from '../core/providers/definitions.js';
import { state } from '../state.js';
import { cacheGet } from './cache.js';
import { logInfo } from '../core/utils.js';
import { showStatus } from '../ui/status.js';
import { createOverlay, resetVideoCache } from '../ui/overlay.js';
import { createFab } from '../ui/fab.js';
import { togglePanel } from '../ui/settings/index.js';
import { handleKeydown, retranslateAll } from './shortcuts.js';
import { glossary } from '../core/glossary.js';
import { clearShowMetadata } from './metadata-fetcher.js';
import { createBrowserContext } from './context.js';
import { handleSubtitlePayload } from '../pipeline/handler.js';
import { runFullPass } from '../pipeline/cleanup.js';

// ============================
// MENU COMMANDS
// ============================
GM_registerMenuCommand('Open Settings (Shift+T)', () => togglePanel());
GM_registerMenuCommand('Toggle Subtitles (T)', () => {
  if (!state.overlayEl) return;
  state.enabled = !state.enabled;
  state.overlayEl.style.display = state.enabled ? 'block' : 'none';
  showStatus(state.enabled ? 'Subtitles ON' : 'Subtitles OFF', 'success');
});
GM_registerMenuCommand('Set API Key', () => {
  const key = prompt('Enter your API key:', CONFIG.apiKey);
  if (key !== null) {
    CONFIG.apiKey = key.trim();
    saveConfig();
    showStatus('API key saved!', 'success');
  }
});

// ============================
// INIT
// ============================
logInfo(`v${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'} loaded | ${CONFIG.provider}/${CONFIG.model || 'default'} | ${CONFIG.sourceLang || 'auto'}→${CONFIG.targetLang} | chunk:${CONFIG.chunkSize}`);

// Wire retranslation callback so non-browser layers can trigger it via state
state.onRetranslate = retranslateAll;

function tryRestoreFromCache() {
  const urlKey = 'url:' + location.pathname;
  const saved = cacheGet(urlKey);
  if (saved && saved.translatedCues && saved.originalCues) {
    state.translatedCues = saved.translatedCues;
    state.originalCues = saved.originalCues;
    state.activeCacheKey = saved.cacheKey;
    state.flaggedLines = new Set(saved.flaggedLines || []);
    const flaggedMsg = state.flaggedLines.size > 0 ? ` (${state.flaggedLines.size} flagged)` : '';
    const resumeMsg = saved.fullPassProgress ? ` (full pass: ${saved.fullPassProgress.done} done, ${saved.fullPassProgress.order.length} remaining)` : '';
    logInfo(`✅ Restored ${state.translatedCues.length} cached lines for ${location.pathname}${flaggedMsg}${resumeMsg}`);
    if (document.body) {
      if (!state.overlayEl) createOverlay();
      showStatus('Restored cached subtitles' + flaggedMsg, 'success');
    }

    // Resume interrupted full pass in background
    const remainingOrder = saved.fullPassProgress?.order;
    if (remainingOrder && remainingOrder.length > 0 && CONFIG.secondEnabled && CONFIG.fullPassEnabled) {
      logInfo(`🔄 Resuming full pass: ${remainingOrder.length} chunks remaining...`);
      setTimeout(() => {
        if (!state.isTranslating) {
          state.isTranslating = true;
          const context = createBrowserContext();
          runFullPass(state.originalCues, state.activeCacheKey, 0, context, context.getSecondProviderOverride(), remainingOrder).finally(() => {
            state.isTranslating = false;
          });
        }
      }, 2000);
    }

    return true;
  }
  return false;
}
// Try to restore cached translations (data only, no DOM)
tryRestoreFromCache();

// Detect Netflix SPA navigation (episode changes without page reload)
let lastPathname = location.pathname;

// Keep _lastUrl on the handleSubtitleData function for URL change detection
handleSubtitlePayload._lastUrl = null;

function onUrlChange() {
  if (location.pathname === lastPathname) return;
  logInfo(`🔄 URL changed: ${lastPathname} → ${location.pathname}`);
  lastPathname = location.pathname;
  state.translatedCues = [];
  state.originalCues = null;
  state.activeCacheKey = null;
  state.isTranslating = false;
  resetVideoCache();
  state.cueHead = 0;
  handleSubtitlePayload._lastUrl = null;
  clearShowMetadata();
  state.interceptedNetflixMetadata = null;
  state.flaggedLines = new Set();
  glossary.clear();
  if (state.overlayEl) {
    state.overlayEl.textContent = '';
    state.overlayEl.style.display = 'none';
  }
  if (state.origOverlayEl) {
    state.origOverlayEl.textContent = '';
    state.origOverlayEl.style.display = 'none';
  }
  state.enabled = true;
  tryRestoreFromCache();
}
window.addEventListener('popstate', onUrlChange);
const _origPush = History.prototype.pushState;
const _origReplace = History.prototype.replaceState;
History.prototype.pushState = function() { _origPush.apply(this, arguments); onUrlChange(); };
History.prototype.replaceState = function() { _origReplace.apply(this, arguments); onUrlChange(); };

// Start PerformanceObserver as fallback (or primary if SES blocked overrides)
startNetworkObserver();

// Wait for DOM to be ready before creating UI elements
function initUI() {
  createFab();
  if (state.translatedCues.length > 0 && !state.overlayEl) {
    createOverlay();
  }
  const activeProvider = PROVIDERS[CONFIG.provider];
  if (state.translatedCues.length > 0) {
    const flaggedMsg = state.flaggedLines.size > 0 ? ` (${state.flaggedLines.size} flagged)` : '';
    showStatus('Restored cached subtitles' + flaggedMsg, 'success');
  } else if (activeProvider?.needsKey && !CONFIG.apiKey) {
    showStatus('Subtitle Translator ready — click 🎬 to configure', 'info');
  } else {
    showStatus(`Subtitle Translator ready — ${activeProvider?.name || CONFIG.provider}`, 'info');
  }
}

// Register keyboard shortcuts
document.addEventListener('keydown', handleKeydown, true);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initUI, 500));
} else {
  setTimeout(initUI, 500);
}
