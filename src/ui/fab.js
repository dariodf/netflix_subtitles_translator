import { state } from '../state.js';
import { showStatus } from './status.js';
import { togglePanel } from './settings/index.js';

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
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    background: 'rgba(229,9,20,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    zIndex: '2147483647',
    boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
    transition: 'transform 0.15s, opacity 0.15s, background 0.15s',
    opacity: '0.7',
    userSelect: 'none',
    fontSize: '22px',
  });
  state.fabEl.textContent = '🎬';
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
    state.fabEl.style.background = state.enabled ? 'rgba(229,9,20,0.85)' : 'rgba(100,100,100,0.85)';
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
}
