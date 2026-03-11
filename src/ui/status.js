import { state } from '../state.js';
import { getFullscreenParent, reparentToFullscreen } from './fullscreen.js';

// ============================
// STATUS INDICATOR
// ============================
export function showStatus(msg, type = 'info', priority = false) {
  if (!state.statusEl) {
    state.statusEl = document.createElement('div');
    state.statusEl.id = 'subtranslator-status';
    Object.assign(state.statusEl.style, {
      position: 'fixed', top: '20px', right: '20px',
      padding: '10px 18px', borderRadius: '8px',
      fontFamily: 'Netflix Sans, Arial, sans-serif', fontSize: '14px', fontWeight: '500',
      zIndex: '2147483647', transition: 'opacity 0.3s', pointerEvents: 'none', maxWidth: '400px',
    });
    document.body.appendChild(state.statusEl);
  }

  // Reparent into fullscreen element if active
  reparentToFullscreen(state.statusEl);

  // In fullscreen, only show priority messages
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl && !priority && type === 'working') {
    return;
  }

  const colors = {
    success: 'rgba(34,197,94,0.9)', error: 'rgba(239,68,68,0.9)',
    working: 'rgba(59,130,246,0.9)', info: 'rgba(100,100,100,0.9)',
  };

  state.statusEl.style.background = colors[type] || colors.info;
  state.statusEl.style.color = 'white';
  state.statusEl.textContent = msg;
  state.statusEl.style.opacity = '1';

  clearTimeout(state.statusEl._timer);
  state.statusEl._timer = setTimeout(() => { state.statusEl.style.opacity = '0'; }, 3000);
}

// ============================
// RATE LIMIT BANNER (persistent, top-right)
// ============================
export function showRateLimitBanner(providerName, { onSwapModel } = {}) {
  state.rateLimitHit = true;
  if (state.rateLimitBannerEl) return;

  state.rateLimitBannerEl = document.createElement('div');
  state.rateLimitBannerEl.id = 'subtranslator-ratelimit-banner';
  Object.assign(state.rateLimitBannerEl.style, {
    position: 'fixed', top: '20px', right: '20px', width: '320px',
    background: 'rgba(245,158,11,0.95)', backdropFilter: 'blur(8px)',
    borderRadius: '10px', padding: '14px 16px', zIndex: '2147483647',
    fontFamily: 'Netflix Sans, Arial, sans-serif', fontSize: '13px', color: '#1a1a2e',
    lineHeight: '1.5', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    animation: 'st-slidein 0.3s ease-out',
  });
  state.rateLimitBannerEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px;">
      <strong style="font-size:14px;">⚠️ Daily Quota Reached</strong>
      <div id="st-ratelimit-close" style="cursor:pointer;font-size:16px;opacity:0.6;padding:0 4px;margin:-2px -4px 0 0;">✕</div>
    </div>
    <div id="st-ratelimit-body">${providerName} daily quota exceeded. Switch to another model or wait for the quota to reset (midnight Pacific).</div>
    ${onSwapModel ? `<div style="margin-top:8px;">
      <button id="st-ratelimit-swap" style="background:#1a1a2e;color:white;border:none;border-radius:6px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;width:100%;">Try next model →</button>
    </div>` : ''}
    <div style="margin-top:8px;font-size:12px;opacity:0.8;">
      💡 <strong>Tip:</strong> Add a second provider (e.g. Groq — 14,400 req/day free) in <strong>Shift+T</strong> settings to keep translating.
    </div>
  `;

  if (!document.getElementById('st-ratelimit-style')) {
    const style = document.createElement('style');
    style.id = 'st-ratelimit-style';
    style.textContent = `@keyframes st-slidein { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }`;
    document.head.appendChild(style);
  }

  getFullscreenParent().appendChild(state.rateLimitBannerEl);

  state.rateLimitBannerEl.querySelector('#st-ratelimit-close').addEventListener('click', () => {
    dismissRateLimitBanner();
  });

  if (onSwapModel) {
    state.rateLimitBannerEl.querySelector('#st-ratelimit-swap').addEventListener('click', () => {
      const next = onSwapModel();
      if (!next) return;
      const body = state.rateLimitBannerEl.querySelector('#st-ratelimit-body');
      body.textContent = `Switched to ${next.name}. Retrying...`;
      clearTimeout(state.rateLimitBannerEl._timer);
      state.rateLimitBannerEl._timer = setTimeout(() => dismissRateLimitBanner(), 10000);
    });
  }

  state.rateLimitBannerEl._timer = setTimeout(() => dismissRateLimitBanner(), 30000);
}

export function dismissRateLimitBanner() {
  if (state.rateLimitBannerEl) {
    clearTimeout(state.rateLimitBannerEl._timer);
    state.rateLimitBannerEl.remove();
    state.rateLimitBannerEl = null;
  }
}
