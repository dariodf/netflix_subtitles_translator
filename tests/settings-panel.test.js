import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../src/state.js';
import { CONFIG } from '../src/config.js';

// Reset panel and relevant state before each test
beforeEach(() => {
  if (state.panelEl) {
    state.panelEl.remove();
    state.panelEl = null;
  }
  if (state.transcriptPanelEl) {
    state.transcriptPanelEl.remove();
    state.transcriptPanelEl = null;
  }
  state.enabled = true;
  state.dualSubs = false;
  state.showOrigOnFlagged = true;
  state.transcriptVisible = false;
  state.translatedCues = [{ begin: 0, end: 1000, text: 'hello' }];
  state.originalCues = [{ begin: 0, end: 1000, text: 'こんにちは' }];
  state.overlayEl = document.createElement('div');
  state.origOverlayEl = document.createElement('div');
  document.body.appendChild(state.overlayEl);
  document.body.appendChild(state.origOverlayEl);
  CONFIG.advancedMode = false;
});

async function openPanel() {
  const { togglePanel } = await import('../src/ui/settings/index.js');
  togglePanel();
  return state.panelEl;
}

describe('settings panel basic view', () => {
  it('shows master toggle and subtitles toggle', async () => {
    const panel = await openPanel();
    expect(panel.querySelector('#st-master-toggle')).not.toBeNull();
    expect(panel.querySelector('#st-toggle-subs')).not.toBeNull();
  });

  it('hides advanced section by default', async () => {
    const panel = await openPanel();
    const advanced = panel.querySelector('#st-advanced-section');
    expect(advanced.style.display).toBe('none');
  });

  it('dual-subs, orig-flagged, transcript are inside advanced section', async () => {
    const panel = await openPanel();
    const advanced = panel.querySelector('#st-advanced-section');
    expect(advanced.querySelector('#st-dual-subs')).not.toBeNull();
    expect(advanced.querySelector('#st-show-orig-flagged')).not.toBeNull();
    expect(advanced.querySelector('#st-transcript')).not.toBeNull();
  });

  it('shortcuts section is always visible outside advanced', async () => {
    const panel = await openPanel();
    expect(panel.querySelector('#st-shortcuts-section')).not.toBeNull();
    expect(panel.querySelector('#st-advanced-section').querySelector('#st-shortcuts-section')).toBeNull();
  });
});

describe('subtitles toggle pill', () => {
  it('toggles state.enabled on click', async () => {
    state.enabled = true;
    const panel = await openPanel();
    panel.querySelector('#st-toggle-subs').click();
    expect(state.enabled).toBe(false);
    panel.querySelector('#st-toggle-subs').click();
    expect(state.enabled).toBe(true);
  });

  it('updates pill position on click', async () => {
    state.enabled = true;
    const panel = await openPanel();
    const pill = panel.querySelector('#st-toggle-subs-switch');
    panel.querySelector('#st-toggle-subs').click();
    expect(pill.firstElementChild.style.left).toBe('2px');
    panel.querySelector('#st-toggle-subs').click();
    expect(pill.firstElementChild.style.left).toBe('16px');
  });
});

describe('dual subs toggle pill', () => {
  it('toggles state.dualSubs on click', async () => {
    state.dualSubs = false;
    const panel = await openPanel();
    panel.querySelector('#st-dual-subs').click();
    expect(state.dualSubs).toBe(true);
    panel.querySelector('#st-dual-subs').click();
    expect(state.dualSubs).toBe(false);
  });

  it('updates pill position on click', async () => {
    state.dualSubs = false;
    const panel = await openPanel();
    const pill = panel.querySelector('#st-dual-subs-switch');
    panel.querySelector('#st-dual-subs').click();
    expect(pill.firstElementChild.style.left).toBe('16px');
  });
});

describe('orig-on-flagged toggle pill', () => {
  it('toggles state.showOrigOnFlagged on click', async () => {
    state.showOrigOnFlagged = true;
    const panel = await openPanel();
    panel.querySelector('#st-show-orig-flagged').click();
    expect(state.showOrigOnFlagged).toBe(false);
    panel.querySelector('#st-show-orig-flagged').click();
    expect(state.showOrigOnFlagged).toBe(true);
  });

  it('updates pill position on click', async () => {
    state.showOrigOnFlagged = true;
    const panel = await openPanel();
    const pill = panel.querySelector('#st-show-orig-flagged-switch');
    panel.querySelector('#st-show-orig-flagged').click();
    expect(pill.firstElementChild.style.left).toBe('2px');
  });
});

describe('transcript toggle pill', () => {
  it('toggles state.transcriptVisible on click', async () => {
    state.transcriptVisible = false;
    const panel = await openPanel();
    panel.querySelector('#st-transcript').click();
    expect(state.transcriptVisible).toBe(true);
    panel.querySelector('#st-transcript').click();
    expect(state.transcriptVisible).toBe(false);
  });

  it('updates pill position on click', async () => {
    state.transcriptVisible = false;
    const panel = await openPanel();
    const pill = panel.querySelector('#st-transcript-switch');
    panel.querySelector('#st-transcript').click();
    expect(pill.firstElementChild.style.left).toBe('16px');
  });
});

describe('advanced section toggle', () => {
  it('shows advanced section when toggle is clicked', async () => {
    const panel = await openPanel();
    panel.querySelector('#st-advanced-toggle').click();
    expect(panel.querySelector('#st-advanced-section').style.display).toBe('block');
  });

  it('hides advanced section on second click', async () => {
    const panel = await openPanel();
    panel.querySelector('#st-advanced-toggle').click();
    panel.querySelector('#st-advanced-toggle').click();
    expect(panel.querySelector('#st-advanced-section').style.display).toBe('none');
  });
});

describe('master toggle', () => {
  beforeEach(() => { CONFIG.masterEnabled = true; });

  it('is present in the header', async () => {
    const panel = await openPanel();
    expect(panel.querySelector('#st-master-toggle')).not.toBeNull();
  });

  it('shows main content when masterEnabled is true', async () => {
    CONFIG.masterEnabled = true;
    const panel = await openPanel();
    expect(panel.querySelector('#st-main-content').style.display).toBe('block');
  });

  it('hides main content when masterEnabled is false', async () => {
    CONFIG.masterEnabled = false;
    const panel = await openPanel();
    expect(panel.querySelector('#st-main-content').style.display).toBe('none');
  });

  it('toggles CONFIG.masterEnabled on click', async () => {
    CONFIG.masterEnabled = true;
    const panel = await openPanel();
    panel.querySelector('#st-master-toggle').click();
    expect(CONFIG.masterEnabled).toBe(false);
    panel.querySelector('#st-master-toggle').click();
    expect(CONFIG.masterEnabled).toBe(true);
  });

  it('shows/hides main content on click', async () => {
    CONFIG.masterEnabled = true;
    const panel = await openPanel();
    panel.querySelector('#st-master-toggle').click();
    expect(panel.querySelector('#st-main-content').style.display).toBe('none');
    panel.querySelector('#st-master-toggle').click();
    expect(panel.querySelector('#st-main-content').style.display).toBe('block');
  });

  it('updates pill position on click', async () => {
    CONFIG.masterEnabled = true;
    const panel = await openPanel();
    panel.querySelector('#st-master-toggle').click();
    expect(panel.querySelector('#st-master-switch').firstElementChild.style.left).toBe('2px');
    panel.querySelector('#st-master-toggle').click();
    expect(panel.querySelector('#st-master-switch').firstElementChild.style.left).toBe('16px');
  });

  it('updates label text on click', async () => {
    CONFIG.masterEnabled = true;
    const panel = await openPanel();
    panel.querySelector('#st-master-toggle').click();
    expect(panel.querySelector('#st-master-label').textContent).toBe('OFF');
    panel.querySelector('#st-master-toggle').click();
    expect(panel.querySelector('#st-master-label').textContent).toBe('ON');
  });
});
