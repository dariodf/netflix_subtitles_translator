import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PROVIDERS } from '../src/core/providers/definitions.js';

const loadFixture = (name) => JSON.parse(readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8'));

// ── Ollama extractText against real fixture ────────────────

describe('ollama extractText', () => {
  const ollamaResponse = loadFixture('ollama_chat_response.json');

  it('extracts translated text from real Ollama chat response', () => {
    const text = PROVIDERS.ollama.extractText(ollamaResponse);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  it('extracted text contains expected [N] indexed lines', () => {
    const text = PROVIDERS.ollama.extractText(ollamaResponse);
    expect(text).toContain('[0]');
    expect(text).toContain('[7]');
  });

  it('extracted text contains Spanish translations', () => {
    const text = PROVIDERS.ollama.extractText(ollamaResponse);
    expect(text).toContain('Algo viene');
    expect(text).toContain('hambriento de sangre');
    expect(text).toContain('Will, tu turno');
  });

  it('preserves "—" separators in multi-speaker lines', () => {
    const text = PROVIDERS.ollama.extractText(ollamaResponse);
    // Line [2] had "—" separator in the source
    expect(text).toMatch(/detrás de ti.*tragándote/);
  });

  it('preserves music markers', () => {
    const text = PROVIDERS.ollama.extractText(ollamaResponse);
    expect(text).toContain('♪');
  });

  it('throws on error response', () => {
    expect(() => PROVIDERS.ollama.extractText({ error: 'model not found' }))
      .toThrow('model not found');
  });
});

// ── Ollama buildRequest ────────────────────────────────────

describe('ollama buildRequest', () => {
  it('builds request with system prompt and user message', () => {
    const req = PROVIDERS.ollama.buildRequest('Be a translator.', 'Translate this', 'qwen2.5:3b');
    expect(req.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(req.data);
    expect(body.model).toBe('qwen2.5:3b');
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toBe('Be a translator.');
    expect(body.messages[1].role).toBe('user');
  });

  it('omits system message when null', () => {
    const req = PROVIDERS.ollama.buildRequest(null, 'Translate this', 'qwen2.5:3b');
    const body = JSON.parse(req.data);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
  });
});

// ── Ollama tags fixture (model discovery parsing) ──────────

describe('ollama tags fixture parsing', () => {
  const tagsData = loadFixture('ollama_tags.json');

  it('has models array', () => {
    expect(Array.isArray(tagsData.models)).toBe(true);
    expect(tagsData.models.length).toBeGreaterThan(0);
  });

  it('models can be parsed like fetchOllamaModels does', () => {
    // Replicate the parsing logic from helpers.js fetchOllamaModels
    const models = (tagsData.models || []).map(m => ({
      id: m.name || m.model,
      size: m.size || 0,
      paramSize: m.details?.parameter_size || '',
    }));
    models.sort((a, b) => a.size - b.size);

    expect(models.length).toBe(tagsData.models.length);
    // Sorted by size ascending
    for (let i = 1; i < models.length; i++) {
      expect(models[i].size).toBeGreaterThanOrEqual(models[i - 1].size);
    }
    // Each model has expected fields
    for (const m of models) {
      expect(typeof m.id).toBe('string');
      expect(m.id.length).toBeGreaterThan(0);
      expect(typeof m.size).toBe('number');
    }
  });

  it('contains recommended models from provider config', () => {
    const modelIds = tagsData.models.map(m => m.name);
    expect(modelIds).toContain('qwen2.5:3b');
    expect(modelIds).toContain('qwen2.5:7b');
  });

  it('models have parameter_size in details', () => {
    for (const m of tagsData.models) {
      expect(m.details.parameter_size).toBeTruthy();
    }
  });
});

// ── Gemini buildRequest ────────────────────────────────────

describe('gemini buildRequest', () => {
  it('builds request with API key in header and model in URL suffix', () => {
    const req = PROVIDERS.gemini.buildRequest('System', 'User msg', 'gemini-2.5-flash', 'test-key');
    expect(req.urlSuffix).toBe('gemini-2.5-flash:generateContent');
    expect(req.headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(req.data);
    expect(body.systemInstruction.parts[0].text).toBe('System');
    expect(body.contents[0].parts[0].text).toBe('User msg');
    expect(body.generationConfig.maxOutputTokens).toBe(8192);
  });

  it('omits systemInstruction when null', () => {
    const req = PROVIDERS.gemini.buildRequest(null, 'User msg', 'gemini-2.5-flash', 'k');
    const body = JSON.parse(req.data);
    expect(body.systemInstruction).toBeUndefined();
  });
});

// ── Gemini extractText against real fixtures ───────────────

describe('gemini extractText', () => {
  it('returns text from real success response', () => {
    const successResponse = loadFixture('gemini_success_response.json');
    const text = PROVIDERS.gemini.extractText(successResponse);
    expect(text).toContain('[0]');
    expect(text).toContain('[1]');
  });

  it('throws on real RPM throttle response', () => {
    const rpmError = loadFixture('gemini_error_rpm_throttle.json');
    expect(() => PROVIDERS.gemini.extractText(rpmError))
      .toThrow('Resource has been exhausted');
  });

  it('throws on real daily quota response', () => {
    const dailyError = loadFixture('gemini_error_daily_quota.json');
    expect(() => PROVIDERS.gemini.extractText(dailyError))
      .toThrow('exceeded your current quota');
  });
});

// ── Anthropic buildRequest / extractText ───────────────────

describe('anthropic buildRequest', () => {
  it('builds request with correct headers', () => {
    const req = PROVIDERS.anthropic.buildRequest('System', 'Hello', 'claude-haiku-4-5-20251001', 'sk-key');
    expect(req.headers['x-api-key']).toBe('sk-key');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(req.data);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.max_tokens).toBe(8192);
    expect(body.system).toBe('System');
    expect(body.messages[0].content).toBe('Hello');
  });

  it('extractText extracts from content array', () => {
    const text = PROVIDERS.anthropic.extractText({
      content: [{ type: 'text', text: 'Translated output' }],
    });
    expect(text).toBe('Translated output');
  });

  it('extractText throws on error', () => {
    expect(() => PROVIDERS.anthropic.extractText({ error: { message: 'invalid_api_key' } }))
      .toThrow('invalid_api_key');
  });
});

// ── OpenAI-compatible providers (Groq, Mistral, OpenRouter) ─

describe.each([
  ['groq', 'llama-3.3-70b-versatile'],
  ['mistral', 'mistral-small-latest'],
  ['openrouter', 'meta-llama/llama-3.3-70b-instruct:free'],
])('%s buildRequest / extractText', (providerKey, model) => {
  const provider = PROVIDERS[providerKey];

  it('builds OpenAI-compatible request', () => {
    const req = provider.buildRequest('System', 'Translate', model, 'bearer-key');
    expect(req.headers['Authorization']).toBe('Bearer bearer-key');
    const body = JSON.parse(req.data);
    expect(body.model).toBe(model);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.max_tokens).toBe(8192);
  });

  it('extractText extracts from choices array', () => {
    const text = provider.extractText({
      choices: [{ message: { content: 'Hola mundo' } }],
    });
    expect(text).toBe('Hola mundo');
  });

  it('extractText throws on error', () => {
    expect(() => provider.extractText({ error: { message: 'rate limited' } }))
      .toThrow('rate limited');
  });
});

// ── OpenRouter adds extra headers ──────────────────────────

describe('openrouter extra headers', () => {
  it('includes HTTP-Referer and X-Title headers', () => {
    const req = PROVIDERS.openrouter.buildRequest('Sys', 'Msg', 'model', 'key');
    expect(req.headers['HTTP-Referer']).toContain('github.com');
    expect(req.headers['X-Title']).toBe('Netflix Subtitle Translator');
  });
});
