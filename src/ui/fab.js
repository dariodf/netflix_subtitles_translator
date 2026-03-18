import { state } from '../state.js';
import { showStatus } from './status.js';
import { togglePanel } from './settings/index.js';

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="56" height="56">
  <defs>
    <linearGradient id="st-fab-bar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ff2030"/>
      <stop offset="100%" stop-color="#b5000a"/>
    </linearGradient>
  </defs>
  <circle cx="64" cy="64" r="60" fill="#e8e8e8"/>
  <circle cx="64" cy="64" r="60" fill="none" stroke="#ccc" stroke-width="1"/>
  <rect x="22" y="38" width="84" height="18" rx="4" fill="rgba(0,0,0,0.08)"/>
  <text x="64" y="51" font-family="Helvetica Neue,Arial,sans-serif" font-size="11" font-weight="600" fill="rgba(0,0,0,0.35)" text-anchor="middle">字幕!</text>
  <path d="M64 60L64 68M58 64L64 68L70 64" stroke="rgba(0,0,0,0.25)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="22" y="74" width="84" height="18" rx="4" fill="url(#st-fab-bar)"/>
  <text x="64" y="87" font-family="Helvetica Neue,Arial,sans-serif" font-size="11" font-weight="700" fill="rgba(255,255,255,0.95)" text-anchor="middle">Subtitles!</text>
</svg>`;

// ============================
// FLOATING BUTTON (always visible)
// ============================
export function createFab() {
  state.fabEl = document.createElement('div');
  state.fabEl.id = 'subtranslator-fab';
  Object.assign(state.fabEl.style, {
    position: 'fixed',
    bottom: '20px',
    left: '20px',
    width: '56px',
    height: '56px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    zIndex: '2147483647',
    filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))',
    transition: 'transform 0.15s, opacity 0.15s',
    opacity: '0.7',
    userSelect: 'none',
  });
  state.fabEl.innerHTML = LOGO_SVG;
  state.fabEl.title = 'Subtitle Translator — click to open settings';

  state.fabEl.addEventListener('mouseenter', () => {
    state.fabEl.style.opacity = '1';
    state.fabEl.style.transform = 'scale(1.1)';
  });
  state.fabEl.addEventListener('mouseleave', () => {
    state.fabEl.style.opacity = '0.7';
    state.fabEl.style.transform = 'scale(1)';
  });

  state.fabEl.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanel();
  });

  // Right-click to toggle subtitles on/off
  state.fabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!state.overlayEl) return;
    state.enabled = !state.enabled;
    state.overlayEl.style.display = state.enabled ? 'block' : 'none';
    state.fabEl.style.opacity = state.enabled ? '0.7' : '0.3';
    showStatus(state.enabled ? 'Subtitles ON' : 'Subtitles OFF', 'success');
  });

  // Make it draggable
  let isDragging = false;
  let dragStartX, dragStartY, fabStartX, fabStartY;

  state.fabEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = state.fabEl.getBoundingClientRect();
    fabStartX = rect.left;
    fabStartY = rect.top;

    function onMove(ev) {
      const dx = ev.clientX - dragStartX;
      const dy = ev.clientY - dragStartY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) isDragging = true;
      if (isDragging) {
        state.fabEl.style.left = (fabStartX + dx) + 'px';
        state.fabEl.style.top = (fabStartY + dy) + 'px';
        state.fabEl.style.bottom = 'auto';
        state.fabEl.style.right = 'auto';
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Override click if it was a drag
  state.fabEl.addEventListener('click', (e) => {
    if (isDragging) {
      e.stopImmediatePropagation();
      isDragging = false;
    }
  }, true);

  document.body.appendChild(state.fabEl);

  // First-time tooltip
  showFirstTimeTooltip();
}

function showFirstTimeTooltip() {
  const STORAGE_KEY = 'subtranslator_seen_tooltip';
  try {
    if (localStorage.getItem(STORAGE_KEY)) return;
  } catch { return; }

  const tooltip = document.createElement('div');
  Object.assign(tooltip.style, {
    position: 'fixed',
    bottom: '84px',
    left: '20px',
    background: 'rgba(20,20,20,0.95)',
    color: 'white',
    fontFamily: 'Netflix Sans, Helvetica Neue, Arial, sans-serif',
    fontSize: '13px',
    lineHeight: '1.5',
    padding: '12px 16px',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.15)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    zIndex: '2147483647',
    maxWidth: '260px',
    opacity: '0',
    transform: 'translateY(8px)',
    transition: 'opacity 0.3s, transform 0.3s',
    pointerEvents: 'auto',
  });
  tooltip.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px;">Subtitle Translator</div>
    <div style="opacity:0.8;">Click this button to set up AI-powered subtitle translation. Supports Gemini, Ollama, OpenAI, and more.</div>
    <div style="margin-top:10px;text-align:right;">
      <button id="st-tooltip-dismiss" style="background:rgba(229,9,20,0.85);color:white;border:none;border-radius:6px;padding:5px 14px;cursor:pointer;font-size:12px;font-weight:600;">Got it</button>
    </div>
  `;

  // Speech bubble arrow pointing down toward the FAB
  const arrow = document.createElement('div');
  Object.assign(arrow.style, {
    position: 'absolute',
    bottom: '-7px',
    left: '28px',
    width: '14px',
    height: '14px',
    background: 'rgba(20,20,20,0.95)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderTop: 'none',
    borderLeft: 'none',
    transform: 'rotate(45deg)',
  });
  tooltip.appendChild(arrow);

  document.body.appendChild(tooltip);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      tooltip.style.opacity = '1';
      tooltip.style.transform = 'translateY(0)';
    });
  });

  function dismiss() {
    tooltip.style.opacity = '0';
    tooltip.style.transform = 'translateY(8px)';
    setTimeout(() => tooltip.remove(), 300);
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
  }

  tooltip.querySelector('#st-tooltip-dismiss').addEventListener('click', (e) => {
    e.stopPropagation();
    dismiss();
  });

  // Also dismiss when they click the FAB itself
  state.fabEl.addEventListener('click', dismiss, { once: true });
}
