import { describe, it, expect, afterEach, vi } from 'vitest';
import { escapeHtml, makeCue, logInfo, logWarn, logError } from '../src/core/utils.js';
import { postJsonViaGM } from '../src/browser/http.js';
import { buildOllamaModelOptions } from '../src/providers/ollama.js';

// ── escapeHtml ─────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });
});

// ── makeCue ───────────────────────────────────────────────

describe('makeCue', () => {
  it('copies begin and end from original, uses provided text', () => {
    const original = { begin: 1000, end: 2000, text: 'original text' };
    const result = makeCue(original, 'translated text');
    expect(result).toEqual({ begin: 1000, end: 2000, text: 'translated text' });
  });

  it('does not copy extra properties from original', () => {
    const original = { begin: 0, end: 500, text: 'hi', extra: 'data' };
    const result = makeCue(original, 'hola');
    expect(result).toEqual({ begin: 0, end: 500, text: 'hola' });
    expect(result.extra).toBeUndefined();
  });

  it('handles empty text', () => {
    const result = makeCue({ begin: 100, end: 200, text: 'something' }, '');
    expect(result).toEqual({ begin: 100, end: 200, text: '' });
  });
});

// ── postJsonViaGM ─────────────────────────────────────────

describe('postJsonViaGM', () => {
  afterEach(() => { globalThis._gmXhrMock = undefined; });

  it('resolves with { status, data } on successful POST', async () => {
    globalThis._gmXhrMock = (opts) => {
      expect(opts.method).toBe('POST');
      opts.onload({ status: 200, responseText: '{"result":"ok"}' });
    };
    const result = await postJsonViaGM('https://api.example.com/v1', {}, {});
    expect(result).toEqual({ status: 200, data: { result: 'ok' } });
  });

  it('stringifies object data', async () => {
    globalThis._gmXhrMock = (opts) => {
      expect(opts.data).toBe('{"q":"test"}');
      opts.onload({ status: 200, responseText: '{}' });
    };
    await postJsonViaGM('https://x.com', {}, { q: 'test' });
  });

  it('passes string data unchanged', async () => {
    globalThis._gmXhrMock = (opts) => {
      expect(opts.data).toBe('already-stringified');
      opts.onload({ status: 200, responseText: '{}' });
    };
    await postJsonViaGM('https://x.com', {}, 'already-stringified');
  });

  it('rejects on network error', async () => {
    globalThis._gmXhrMock = (opts) => { opts.onerror(); };
    await expect(postJsonViaGM('https://x.com', {}, {})).rejects.toThrow('Network error');
  });

  it('rejects on timeout', async () => {
    globalThis._gmXhrMock = (opts) => { opts.ontimeout(); };
    await expect(postJsonViaGM('https://x.com', {}, {})).rejects.toThrow('Request timed out');
  });

  it('rejects on JSON parse error', async () => {
    globalThis._gmXhrMock = (opts) => {
      opts.onload({ status: 200, responseText: 'not-json' });
    };
    await expect(postJsonViaGM('https://x.com', {}, {})).rejects.toThrow('Parse error');
  });

  it('uses default timeout of 30000', async () => {
    globalThis._gmXhrMock = (opts) => {
      expect(opts.timeout).toBe(30000);
      opts.onload({ status: 200, responseText: '{}' });
    };
    await postJsonViaGM('https://x.com', {}, {});
  });

  it('uses custom timeout', async () => {
    globalThis._gmXhrMock = (opts) => {
      expect(opts.timeout).toBe(120000);
      opts.onload({ status: 200, responseText: '{}' });
    };
    await postJsonViaGM('https://x.com', {}, {}, 120000);
  });

  it('resolves with non-200 status (caller decides errors)', async () => {
    globalThis._gmXhrMock = (opts) => {
      opts.onload({ status: 429, responseText: '{"error":"rate limited"}' });
    };
    const result = await postJsonViaGM('https://x.com', {}, {});
    expect(result.status).toBe(429);
    expect(result.data.error).toBe('rate limited');
  });
});

// ── logInfo / logWarn / logError ──────────────────────────

describe('logInfo', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls console.log with [SubTranslator] prefix', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logInfo('hello');
    expect(spy).toHaveBeenCalledWith('[SubTranslator]', 'hello');
  });

  it('passes multiple arguments', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logInfo('count:', 42, { extra: true });
    expect(spy).toHaveBeenCalledWith('[SubTranslator]', 'count:', 42, { extra: true });
  });
});

describe('logWarn', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls console.warn with [SubTranslator] prefix', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logWarn('careful');
    expect(spy).toHaveBeenCalledWith('[SubTranslator]', 'careful');
  });

  it('passes extra arguments through', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = new Error('oops');
    logWarn('problem:', err);
    expect(spy).toHaveBeenCalledWith('[SubTranslator]', 'problem:', err);
  });
});

describe('logError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls console.error with [SubTranslator] prefix', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('failed');
    expect(spy).toHaveBeenCalledWith('[SubTranslator]', 'failed');
  });

  it('passes error objects through', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('crash');
    logError(err);
    expect(spy).toHaveBeenCalledWith('[SubTranslator]', err);
  });
});

// ── buildOllamaModelOptions ────────────────────────────────

describe('buildOllamaModelOptions', () => {
  const models = [
    { id: 'qwen2.5:3b', size: 1_000_000_000, paramSize: '3B' },
    { id: 'qwen2.5:7b', size: 4_000_000_000, paramSize: '7B' },
    { id: 'llama3.1:8b', size: 5_000_000_000, paramSize: '' },
  ];

  it('returns null for empty/null models', () => {
    expect(buildOllamaModelOptions(null, 'qwen2.5:3b')).toBe(null);
    expect(buildOllamaModelOptions([], 'qwen2.5:3b')).toBe(null);
  });

  it('generates <option> elements for each model', () => {
    const html = buildOllamaModelOptions(models, 'qwen2.5:3b');
    expect(html).toContain('<option value="qwen2.5:3b"');
    expect(html).toContain('<option value="qwen2.5:7b"');
    expect(html).toContain('<option value="llama3.1:8b"');
  });

  it('marks the selected model', () => {
    const html = buildOllamaModelOptions(models, 'qwen2.5:7b');
    expect(html).toContain('value="qwen2.5:7b" selected');
    expect(html).not.toContain('value="qwen2.5:3b" selected');
  });

  it('shows param size when available', () => {
    const html = buildOllamaModelOptions(models, 'qwen2.5:3b');
    expect(html).toContain('qwen2.5:3b (3B)');
    // No paramSize for llama — just the id
    expect(html).toContain('>llama3.1:8b</option>');
  });

  it('marks recommended model with star', () => {
    const html = buildOllamaModelOptions(models, 'qwen2.5:3b', 'qwen2.5:7b');
    expect(html).toContain('★ recommended');
    // Star is only on the recommended one
    expect(html.match(/★ recommended/g).length).toBe(1);
  });

  it('always appends a Custom... option', () => {
    const html = buildOllamaModelOptions(models, 'qwen2.5:3b');
    expect(html).toContain('<option value="_custom">Custom...</option>');
  });
});
