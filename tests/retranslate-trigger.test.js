import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state } from '../src/state.js';
import { CONFIG } from '../src/config.js';

describe('state.onRetranslate callback', () => {
  beforeEach(() => {
    if (state.panelEl) { state.panelEl.remove(); state.panelEl = null; }
    if (state.rateLimitBannerEl) { state.rateLimitBannerEl.remove(); state.rateLimitBannerEl = null; }
    state.onRetranslate = null;
    state.rateLimitHit = false;
    state.translatedCues = [];
    state.originalCues = [];
    state.flaggedLines = new Set();
    state.overlayEl = document.createElement('div');
    state.origOverlayEl = document.createElement('div');
    document.body.appendChild(state.overlayEl);
    document.body.appendChild(state.origOverlayEl);
    CONFIG.masterEnabled = true;
  });

  describe('settings panel', () => {
    it('has no save button (settings are auto-saved)', async () => {
      const { togglePanel } = await import('../src/ui/settings/index.js');
      togglePanel(); // open panel
      expect(state.panelEl.querySelector('#st-save')).toBeNull();
    });
  });

  describe('rate limit model swap triggers retranslation', () => {
    it('calls state.onRetranslate when onSwapModel is invoked', async () => {
      const retranslateSpy = vi.fn();
      state.onRetranslate = retranslateSpy;

      const { createBrowserContext } = await import('../src/browser/context.js');
      const context = createBrowserContext();

      // Set up a provider with multiple models so swap works
      const { PROVIDERS } = await import('../src/core/providers/definitions.js');
      const provider = PROVIDERS[CONFIG.provider];
      if (!provider?.models?.length) {
        // Skip if provider has no models list (e.g. ollama with dynamic models)
        return;
      }

      CONFIG.model = provider.models[0].id;

      // reportRateLimit creates the banner with onSwapModel wired up
      context.reportRateLimit(provider.name);

      expect(state.rateLimitBannerEl).not.toBeNull();

      const swapButton = state.rateLimitBannerEl.querySelector('#st-ratelimit-swap');
      if (swapButton) {
        swapButton.click();
        expect(retranslateSpy).toHaveBeenCalledOnce();
        // Model should have changed to the next one
        expect(CONFIG.model).toBe(provider.models[1 % provider.models.length].id);
      }
    });
  });

  describe('no callback registered', () => {
    it('does not throw when opening panel with no onRetranslate', async () => {
      state.onRetranslate = null;
      const { togglePanel } = await import('../src/ui/settings/index.js');
      expect(() => togglePanel()).not.toThrow();
    });
  });
});
