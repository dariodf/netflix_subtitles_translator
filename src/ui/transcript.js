import { state } from '../state.js';
import { escapeHtml } from '../core/utils.js';
import { showStatus } from './status.js';
import { reparentToFullscreen } from './fullscreen.js';

// ============================
// TRANSCRIPT PANEL (L key)
// ============================

function getActiveCues() {
  return state.translatedCues.length > 0 ? state.translatedCues : (state.originalCues || []);
}

function lineIsTranslated(cue, orig, isFlagged) {
  const textChanged = orig && cue.text !== orig.text;
  return textChanged || (orig && !isFlagged && !state.isTranslating);
}

function dotState(isFlagged, isTranslated) {
  if (isFlagged) return { symbol: '▲', color: '#fbbf24', title: 'Flagged — may need cleanup' };
  if (isTranslated) return { symbol: '●', color: '#22c55e', title: '' };
  return { symbol: '○', color: 'rgba(255,255,255,0.2)', title: '' };
}

function updateTranscriptCount(countEl, cues, originals) {
  if (!countEl) return;
  const translated = cues.filter((c, i) => originals[i] && c.text !== originals[i].text).length;
  const flaggedCount = state.flaggedLines.size;
  countEl.textContent = `${translated}/${cues.length} translated` + (flaggedCount > 0 ? ` · ${flaggedCount} flagged` : '');
}

export function toggleTranscript() {
  if (state.transcriptPanelEl) {
    state.transcriptPanelEl.remove();
    state.transcriptPanelEl = null;
    state.transcriptVisible = false;
    state.transcriptLineElements = [];
    state.transcriptLastHighlightIndex = -2;
    showStatus('Transcript closed', 'success');
    return;
  }
  if (state.translatedCues.length === 0 && (!state.originalCues || state.originalCues.length === 0)) {
    showStatus('No subtitles loaded yet', 'error');
    return;
  }
  createTranscriptPanel();
}

function createTranscriptPanel() {
  state.transcriptPanelEl = document.createElement('div');
  state.transcriptPanelEl.id = 'subtranslator-transcript';
  Object.assign(state.transcriptPanelEl.style, {
    position: 'fixed', top: '0', right: '0', width: '380px', height: '100vh',
    background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(12px)',
    borderLeft: '1px solid rgba(255,255,255,0.1)',
    zIndex: '2147483647', overflowY: 'auto', overflowX: 'hidden',
    fontFamily: 'Netflix Sans, Helvetica Neue, Arial, sans-serif',
    color: 'white', fontSize: '13px', padding: '0',
    transition: 'transform 0.2s ease',
    scrollBehavior: 'smooth',
  });

  // Header
  const header = document.createElement('div');
  Object.assign(header.style, {
    position: 'sticky', top: '0', zIndex: '10',
    background: 'rgba(10,10,10,0.95)', backdropFilter: 'blur(8px)',
    padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  });
  header.innerHTML = `
    <div style="font-size:14px;font-weight:700;opacity:0.9;">📜 Transcript View</div>
    <div style="display:flex;gap:8px;align-items:center;">
      <span style="font-size:11px;opacity:0.4;" id="st-transcript-count"></span>
      <div id="st-transcript-close" style="cursor:pointer;opacity:0.5;font-size:16px;padding:2px 6px;">✕</div>
    </div>
  `;
  state.transcriptPanelEl.appendChild(header);

  header.querySelector('#st-transcript-close').addEventListener('click', () => {
    toggleTranscript();
    if (state.panelEl) {
      const pill = state.panelEl.querySelector('#st-transcript-switch');
      if (pill) { pill.style.background = 'rgba(255,255,255,0.15)'; pill.firstElementChild.style.left = '2px'; }
    }
  });

  // Lines container
  const container = document.createElement('div');
  container.id = 'st-transcript-lines';
  Object.assign(container.style, { padding: '8px 0' });
  state.transcriptPanelEl.appendChild(container);

  // Build all lines
  const cues = getActiveCues();
  const originals = state.originalCues || [];
  state.transcriptLineElements = [];

  cues.forEach((cue, idx) => {
    const lineEl = document.createElement('div');
    Object.assign(lineEl.style, {
      padding: '8px 16px',
      borderLeft: '3px solid transparent',
      transition: 'background 0.15s, border-color 0.15s',
      lineHeight: '1.5',
    });

    const mins = Math.floor(cue.begin / 60000);
    const secs = Math.floor((cue.begin % 60000) / 1000);
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

    const orig = originals[idx];
    const isFlagged = state.flaggedLines.has(idx);
    const isTranslated = lineIsTranslated(cue, orig, isFlagged);
    const dot = dotState(isFlagged, isTranslated);
    const textChanged = orig && cue.text !== orig.text;

    lineEl.innerHTML = `
      <div style="display:flex;gap:8px;align-items:flex-start;">
        <span style="font-size:11px;opacity:0.3;min-width:36px;padding-top:1px;font-variant-numeric:tabular-nums;">${timeStr}</span>
        <span style="font-size:10px;padding-top:2px;"><span style="color:${dot.color};" title="${dot.title}">${dot.symbol}</span></span>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:500;">${escapeHtml(cue.text)}</div>
          ${orig && textChanged ? `<div style="font-size:11px;opacity:0.35;margin-top:2px;">${escapeHtml(orig.text)}</div>` : ''}
        </div>
      </div>
    `;

    // Store direct element references to avoid CSS-selector queries during refresh
    const innerDiv = lineEl.querySelector('div');
    lineEl._dotEl = innerDiv.children[1].firstElementChild;
    const textContainer = innerDiv.children[2];
    lineEl._mainDiv = textContainer.firstElementChild;
    lineEl._origDiv = textContainer.children[1] || null;

    container.appendChild(lineEl);
    state.transcriptLineElements.push(lineEl);
  });

  const countEl = state.transcriptPanelEl.querySelector('#st-transcript-count');
  updateTranscriptCount(countEl, cues, originals);

  document.body.appendChild(state.transcriptPanelEl);
  state.transcriptVisible = true;
  state.transcriptLastHighlightIndex = -2;

  reparentToFullscreen(state.transcriptPanelEl);
  showStatus('Transcript view — L to close', 'success');
}

export function refreshTranscriptContent() {
  if (!state.transcriptVisible || !state.transcriptPanelEl || state.transcriptLineElements.length === 0) return;
  const cues = getActiveCues();
  const originals = state.originalCues || [];

  for (let idx = 0; idx < state.transcriptLineElements.length && idx < cues.length; idx++) {
    const lineEl = state.transcriptLineElements[idx];
    const cue = cues[idx];
    const orig = originals[idx];
    const isFlagged = state.flaggedLines.has(idx);
    const isTranslated = lineIsTranslated(cue, orig, isFlagged);
    const dot = dotState(isFlagged, isTranslated);

    // Update status dot via stored ref (no querySelector needed)
    if (lineEl._dotEl) {
      lineEl._dotEl.innerHTML = dot.symbol;
      lineEl._dotEl.style.color = dot.color;
      lineEl._dotEl.title = dot.title;
    }

    // Update text content via stored refs
    if (lineEl._mainDiv) lineEl._mainDiv.textContent = cue.text;

    const textChanged = orig && cue.text !== orig.text;
    if (textChanged && orig) {
      if (lineEl._origDiv) {
        lineEl._origDiv.textContent = orig.text;
        lineEl._origDiv.style.display = '';
      } else {
        const newOrigDiv = document.createElement('div');
        Object.assign(newOrigDiv.style, { fontSize: '11px', opacity: '0.35', marginTop: '2px' });
        newOrigDiv.textContent = orig.text;
        lineEl._mainDiv.parentElement.appendChild(newOrigDiv);
        lineEl._origDiv = newOrigDiv;
      }
    } else if (lineEl._origDiv) {
      lineEl._origDiv.style.display = 'none';
    }
  }

  const countEl = state.transcriptPanelEl.querySelector('#st-transcript-count');
  updateTranscriptCount(countEl, cues, originals);
}
