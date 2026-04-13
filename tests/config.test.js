import { describe, it, expect, beforeEach } from 'vitest';

describe('saveConfig', () => {
  const setValueCalls = [];

  beforeEach(() => {
    setValueCalls.length = 0;
    globalThis.GM_setValue = (key, value) => {
      setValueCalls.push({ key, value });
    };
  });

  it('persists all config keys via GM_setValue', async () => {
    const { saveConfig } = await import('../src/config.js');
    saveConfig();
    const keys = setValueCalls.map(c => c.key);
    expect(keys).toContain('provider');
    expect(keys).toContain('providerConfigs');
    expect(keys).toContain('secondProviderConfigs');
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
    // Old separate maps should NOT be saved anymore
    expect(keys).not.toContain('apiKeys');
    expect(keys).not.toContain('models');
    expect(keys).not.toContain('localUrls');
    expect(keys).not.toContain('chunkSizes');
    expect(keys).not.toContain('secondChunkSizes');
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

  it('stores all per-provider settings in providerConfigs JSON', async () => {
    const { saveConfig, CONFIG } = await import('../src/config.js');
    const orig = CONFIG.provider;
    CONFIG.provider = 'gemini';
    CONFIG.apiKey = 'gemini-key-123';
    CONFIG.model = 'gemini-2.5-flash';
    CONFIG.chunkSize = 75;

    saveConfig();

    const call = setValueCalls.find(c => c.key === 'providerConfigs');
    expect(typeof call.value).toBe('string');
    const parsed = JSON.parse(call.value);
    expect(parsed.gemini.apiKey).toBe('gemini-key-123');
    expect(parsed.gemini.model).toBe('gemini-2.5-flash');
    expect(parsed.gemini.chunkSize).toBe(75);
    // Restore
    CONFIG.provider = orig;
    CONFIG.apiKey = '';
    CONFIG.model = '';
    delete CONFIG.providerConfigs.gemini;
  });

  it('stores secondProviderConfigs with chunk size', async () => {
    const { saveConfig, CONFIG } = await import('../src/config.js');
    CONFIG.secondProvider = 'groq';
    CONFIG.secondChunkSize = 120;
    saveConfig();
    const call = setValueCalls.find(c => c.key === 'secondProviderConfigs');
    const parsed = JSON.parse(call.value);
    expect(parsed.groq.chunkSize).toBe(120);
  });
});

describe('CONFIG providerConfigs migration', () => {
  it('migrates legacy separate maps into providerConfigs', async () => {
    globalThis.GM_getValue = (key, def) => {
      if (key === 'providerConfigs') return '{}';
      if (key === 'apiKeys') return JSON.stringify({ gemini: 'my-gemini-key' });
      if (key === 'models') return JSON.stringify({ gemini: 'gemini-2.5-flash' });
      if (key === 'chunkSizes') return JSON.stringify({ gemini: 75 });
      if (key === 'localUrls') return JSON.stringify({ ollama: 'http://myserver:11434' });
      return def;
    };
    const { CONFIG } = await import('../src/config.js?legacymigrate=' + Date.now());
    expect(CONFIG.providerConfigs.gemini.apiKey).toBe('my-gemini-key');
    expect(CONFIG.providerConfigs.gemini.model).toBe('gemini-2.5-flash');
    expect(CONFIG.providerConfigs.gemini.chunkSize).toBe(75);
    expect(CONFIG.providerConfigs.ollama.localUrl).toBe('http://myserver:11434');
  });

  it('lmstudio defaults to localhost:1234 when no config saved', async () => {
    globalThis.GM_getValue = (key, def) => {
      if (key === 'provider') return 'lmstudio';
      if (key === 'providerConfigs') return '{}';
      return def;
    };
    const { CONFIG } = await import('../src/config.js?lmdefault=' + Date.now());
    expect(CONFIG.localUrl).toBe('http://localhost:1234');
  });

  it('restores saved localUrl for lmstudio', async () => {
    globalThis.GM_getValue = (key, def) => {
      if (key === 'provider') return 'lmstudio';
      if (key === 'providerConfigs') return JSON.stringify({ lmstudio: { localUrl: 'http://192.168.1.10:1234' } });
      return def;
    };
    const { CONFIG } = await import('../src/config.js?lmsaved=' + Date.now());
    expect(CONFIG.localUrl).toBe('http://192.168.1.10:1234');
  });
});

describe('CONFIG defaults', () => {
  it('has expected default values from GM_getValue stubs', async () => {
    const { CONFIG } = await import('../src/config.js');
    expect(CONFIG.provider).toBe('ollama');
    expect(CONFIG.apiKey).toBe('');
    expect(CONFIG.localUrl).toBe('http://localhost:11434');
    expect(CONFIG.targetLang).toBe('English');
    expect(CONFIG.sourceLang).toBe('');
    expect(CONFIG.chunkOverlap).toBe(10);
    expect(CONFIG.timingOffset).toBe(0);
    expect(CONFIG.timingStep).toBe(200);
    expect(CONFIG.fontSize).toBe('2.2vw');
  });
});
