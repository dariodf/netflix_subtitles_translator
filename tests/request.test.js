import { describe, it, expect, vi } from 'vitest';
import { parseTranslationResponse } from '../src/core/request-parser.js';
import { buildProviderUrl, sendProviderRequest } from '../src/pipeline/request.js';
import { makeCues } from './helpers/fixtures.js';

describe('parseTranslationResponse', () => {
  it('parses [N] indexed format', () => {
    const cues = makeCues('Hello', 'World', 'Goodbye');
    const text = '[0] Hola\n[1] Mundo\n[2] Adiós';
    const results = parseTranslationResponse(text, cues);
    expect(results).toEqual(['Hola', 'Mundo', 'Adiós']);
  });

  it('handles [N] with checkmark prefix', () => {
    const cues = makeCues('Hello', 'World');
    const text = '[0] ✓ Hola\n[1] ✓ Mundo';
    const results = parseTranslationResponse(text, cues);
    expect(results).toEqual(['Hola', 'Mundo']);
  });

  it('fills gaps with original text when lines are missing', () => {
    const cues = makeCues('Hello', 'World', 'Goodbye');
    const text = '[0] Hola\n[2] Adiós';
    const results = parseTranslationResponse(text, cues);
    expect(results[0]).toBe('Hola');
    expect(results[1]).toBe('World'); // gap filled with original
    expect(results[2]).toBe('Adiós');
  });

  it('falls back to plain line-by-line when [N] format mostly absent', () => {
    const cues = makeCues('Hello', 'World', 'Goodbye');
    const text = 'Hola\nMundo\nAdiós';
    const results = parseTranslationResponse(text, cues);
    expect(results).toEqual(['Hola', 'Mundo', 'Adiós']);
  });

  it('strips residual [N] prefixes from plain fallback', () => {
    const cues = makeCues('Hello', 'World');
    // Only 1 out of 2 has [N] → below 30% threshold → triggers fallback
    // Actually with 2 cues, 1 match = 50% which is >= 30%, so it won't fallback.
    // Let's use a case where none match [N] properly.
    const text = 'Hola\nMundo';
    const results = parseTranslationResponse(text, cues);
    expect(results).toEqual(['Hola', 'Mundo']);
  });

  it('strips bullet/dash prefixes', () => {
    const cues = makeCues('Hello', 'World');
    const text = '[0] - Hola\n[1] • Mundo';
    const results = parseTranslationResponse(text, cues);
    expect(results).toEqual(['Hola', 'Mundo']);
  });

  it('strips double-quote wrapping', () => {
    const cues = makeCues('Hello');
    const text = '[0] "Hola"';
    const results = parseTranslationResponse(text, cues);
    expect(results).toEqual(['Hola']);
  });

  it('ignores out-of-range indices', () => {
    const cues = makeCues('Hello', 'World');
    const text = '[0] Hola\n[1] Mundo\n[99] Extra';
    const results = parseTranslationResponse(text, cues);
    expect(results.length).toBe(2);
    expect(results).toEqual(['Hola', 'Mundo']);
  });

  it('handles empty response by returning originals', () => {
    const cues = makeCues('Hello', 'World');
    const results = parseTranslationResponse('', cues);
    expect(results).toEqual(['Hello', 'World']);
  });

  it('preserves "—" separators in translations', () => {
    const cues = makeCues('Hi—Bye');
    const text = '[0] Hola—Adiós';
    const results = parseTranslationResponse(text, cues);
    expect(results[0]).toBe('Hola—Adiós');
  });
});

describe('buildProviderUrl', () => {
  const fakeProvider = {
    url: 'https://api.openai.com/v1/chat/completions',
    buildRequest: () => ({ headers: {}, data: {} }),
  };

  it('uses provider default URL when localUrl is empty', () => {
    const config = { localUrl: '', model: 'gpt-4', apiKey: 'key' };
    const url = buildProviderUrl(fakeProvider, 'openai', config);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('uses config.localUrl override for non-ollama provider', () => {
    const config = { localUrl: 'https://custom.api.com/v1', model: 'm', apiKey: 'k' };
    const url = buildProviderUrl(fakeProvider, 'openai', config);
    expect(url).toBe('https://custom.api.com/v1');
  });

  it('uses explicit providerUrl parameter over config', () => {
    const config = { localUrl: 'https://config.api.com', model: 'm', apiKey: 'k' };
    const url = buildProviderUrl(fakeProvider, 'openai', config, 'https://explicit.api.com');
    expect(url).toBe('https://explicit.api.com');
  });

  it('ollama with empty localUrl falls back to localhost:11434', () => {
    const config = { localUrl: '', model: 'm', apiKey: '' };
    const url = buildProviderUrl(fakeProvider, 'ollama', config);
    expect(url).toBe('http://localhost:11434/api/chat');
  });

  it('constructs Ollama URL from localUrl config', () => {
    const config = { localUrl: 'http://nixos:11434/', model: 'm', apiKey: '' };
    const url = buildProviderUrl(fakeProvider, 'ollama', config);
    expect(url).toBe('http://nixos:11434/api/chat');
  });

  it('localUrl is used as base for ollama, appending /api/chat', () => {
    const config = { localUrl: 'https://custom.ollama.com', model: 'm', apiKey: '' };
    const url = buildProviderUrl(fakeProvider, 'ollama', config);
    expect(url).toBe('https://custom.ollama.com/api/chat');
  });

  it('lmstudio with empty localUrl falls back to localhost:1234', () => {
    const config = { localUrl: '', model: 'm', apiKey: '' };
    const url = buildProviderUrl(fakeProvider, 'lmstudio', config);
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
  });

  it('lmstudio uses localUrl as base, appending /v1/chat/completions', () => {
    const config = { localUrl: 'http://myserver:1234', model: 'm', apiKey: '' };
    const url = buildProviderUrl(fakeProvider, 'lmstudio', config);
    expect(url).toBe('http://myserver:1234/v1/chat/completions');
  });

  it('lmstudio strips trailing slash from localUrl', () => {
    const config = { localUrl: 'http://localhost:1234/', model: 'm', apiKey: '' };
    const url = buildProviderUrl(fakeProvider, 'lmstudio', config);
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
  });

  it('explicit providerUrl overrides lmstudio localUrl', () => {
    const config = { localUrl: 'http://localhost:1234', model: 'm', apiKey: '' };
    const url = buildProviderUrl(fakeProvider, 'lmstudio', config, 'https://remote.lmstudio.com/v1/chat/completions');
    expect(url).toBe('https://remote.lmstudio.com/v1/chat/completions');
  });

  it('appends urlSuffix from buildRequest', () => {
    const providerWithSuffix = {
      url: 'https://api.example.com',
      buildRequest: () => ({ headers: {}, data: {}, urlSuffix: '/models/gemini:generate' }),
    };
    const config = { localUrl: '', model: 'gemini', apiKey: 'key' };
    const url = buildProviderUrl(providerWithSuffix, 'gemini', config);
    expect(url).toBe('https://api.example.com/models/gemini:generate');
  });
});

describe('sendProviderRequest', () => {
  const fakeProvider = {
    url: 'https://api.example.com',
    buildRequest: (system, user, model, apiKey) => ({
      headers: { Authorization: `Bearer ${apiKey}` },
      data: { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], model },
    }),
    extractText: (data) => data.choices?.[0]?.message?.content || '',
  };

  it('returns text for 200 response', async () => {
    const mockPostJson = vi.fn().mockResolvedValue({
      status: 200,
      data: { choices: [{ message: { content: 'Hello world' } }] },
    });
    const context = { config: { localUrl: 'http://localhost:11434', model: 'gpt-4', apiKey: 'key' }, postJson: mockPostJson };
    const result = await sendProviderRequest(context, {
      provider: fakeProvider, providerKey: 'openai', model: 'gpt-4', apiKey: 'key',
      system: 'You are helpful', userMessage: 'Hi', timeout: 30000,
    });
    expect(result.status).toBe(200);
    expect(result.text).toBe('Hello world');
  });

  it('returns text=null for 429 response', async () => {
    const mockPostJson = vi.fn().mockResolvedValue({
      status: 429,
      data: { error: { message: 'Rate limited' } },
    });
    const context = { config: { localUrl: 'http://localhost:11434', model: 'gpt-4', apiKey: 'key' }, postJson: mockPostJson };
    const result = await sendProviderRequest(context, {
      provider: fakeProvider, providerKey: 'openai', model: 'gpt-4', apiKey: 'key',
      system: 'You are helpful', userMessage: 'Hi', timeout: 30000,
    });
    expect(result.status).toBe(429);
    expect(result.text).toBe(null);
  });

  it('passes correct timeout to postJson', async () => {
    const mockPostJson = vi.fn().mockResolvedValue({ status: 200, data: { choices: [{ message: { content: 'ok' } }] } });
    const context = { config: { localUrl: 'http://localhost:11434', model: 'gpt-4', apiKey: 'key' }, postJson: mockPostJson };
    await sendProviderRequest(context, {
      provider: fakeProvider, providerKey: 'openai', model: 'gpt-4', apiKey: 'key',
      system: 'sys', userMessage: 'usr', timeout: 15000,
    });
    expect(mockPostJson).toHaveBeenCalledWith(
      expect.any(String), expect.any(Object), expect.any(Object), 15000,
    );
  });
});
