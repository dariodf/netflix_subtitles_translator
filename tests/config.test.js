import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('saveConfig', () => {
  const setValueCalls = [];

  beforeEach(() => {
    setValueCalls.length = 0;
    // Track all GM_setValue calls
    globalThis.GM_setValue = (key, value) => {
      setValueCalls.push({ key, value });
    };
  });

  it('persists all config keys via GM_setValue', async () => {
    // Re-import to get fresh module
    const { saveConfig, CONFIG } = await import('../src/config.js');

    saveConfig();

    const keys = setValueCalls.map(c => c.key);
    expect(keys).toContain('provider');
    expect(keys).toContain('apiKey');
    expect(keys).toContain('model');
    expect(keys).toContain('ollamaUrl');
    expect(keys).toContain('libreTranslateUrl');
    expect(keys).toContain('targetLang');
    expect(keys).toContain('sourceLang');
    expect(keys).toContain('fontSize');
    expect(keys).toContain('timingOffset');
    expect(keys).toContain('timingStep');
    expect(keys).toContain('secondEnabled');
    expect(keys).toContain('secondProvider');
    expect(keys).toContain('secondModel');
    expect(keys).toContain('secondApiKey');
    expect(keys).toContain('fullPassEnabled');
    expect(keys).toContain('advancedMode');
    expect(keys).toContain('showMetadata');
    expect(keys).toContain('showSynopsis');
    expect(keys).toContain('episodeSynopsis');
    expect(keys).toContain('fastStart');
    expect(keys).toContain('glossaryPerChunk');
    expect(keys).toContain('glossaryUpfront');
    expect(keys).toContain('glossaryUpfrontSecond');
    expect(keys).toContain('chunkSizes');
    expect(keys).toContain('secondChunkSizes');
  });

  it('stores boolean config values as native booleans', async () => {
    const { saveConfig, CONFIG } = await import('../src/config.js');
    CONFIG.secondEnabled = true;
    CONFIG.fullPassEnabled = false;

    saveConfig();

    const secondEnabled = setValueCalls.find(c => c.key === 'secondEnabled');
    const fullPass = setValueCalls.find(c => c.key === 'fullPassEnabled');
    expect(secondEnabled.value).toBe(true);
    expect(fullPass.value).toBe(false);
  });

  it('stores chunk sizes as JSON strings', async () => {
    const { saveConfig, CONFIG } = await import('../src/config.js');
    CONFIG.chunkSize = 75;

    saveConfig();

    const chunkSizes = setValueCalls.find(c => c.key === 'chunkSizes');
    expect(typeof chunkSizes.value).toBe('string');
    const parsed = JSON.parse(chunkSizes.value);
    expect(parsed[CONFIG.provider]).toBe(75);
  });
});

describe('CONFIG defaults', () => {
  it('has expected default values from GM_getValue stubs', async () => {
    const { CONFIG } = await import('../src/config.js');
    // GM_getValue returns defaultValue in tests, so these should match the defaults
    expect(CONFIG.provider).toBe('gemini');
    expect(CONFIG.apiKey).toBe('');
    expect(CONFIG.ollamaUrl).toBe('http://localhost:11434');
    expect(CONFIG.targetLang).toBe('English');
    expect(CONFIG.sourceLang).toBe('');
    expect(CONFIG.chunkOverlap).toBe(10);
    expect(CONFIG.timingOffset).toBe(0);
    expect(CONFIG.timingStep).toBe(200);
    expect(CONFIG.fontSize).toBe('2.2vw');
  });
});
