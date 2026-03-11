import { describe, it, expect } from 'vitest';
import { buildCacheKey } from '../src/pipeline/handler.js';

const baseCues = [{ text: 'Hello' }, { text: 'World' }];
const baseConfig = {
  provider: 'ollama', model: 'qwen2.5:3b',
  targetLang: 'English', sourceLang: 'Japanese',
  glossaryPerChunk: false, glossaryUpfront: false,
  showSynopsis: true, episodeSynopsis: true,
  anilistNames: true, replaceCharacterNames: true,
};

describe('buildCacheKey', () => {
  it('same config + cues = same key', () => {
    const a = buildCacheKey(baseConfig, baseCues);
    const b = buildCacheKey({ ...baseConfig }, baseCues);
    expect(a).toBe(b);
  });

  it('different targetLang = different key', () => {
    const a = buildCacheKey(baseConfig, baseCues);
    const b = buildCacheKey({ ...baseConfig, targetLang: 'French' }, baseCues);
    expect(a).not.toBe(b);
  });

  it('different provider/model = same key', () => {
    const a = buildCacheKey(baseConfig, baseCues);
    const b = buildCacheKey({ ...baseConfig, provider: 'gemini', model: 'gemini-2.0-flash' }, baseCues);
    expect(a).toBe(b);
  });

  it('different config flags = same key', () => {
    const a = buildCacheKey(baseConfig, baseCues);
    const b = buildCacheKey({ ...baseConfig, glossaryPerChunk: true, sourceLang: 'Korean' }, baseCues);
    expect(a).toBe(b);
  });

  it('different cues = different key', () => {
    const a = buildCacheKey(baseConfig, baseCues);
    const b = buildCacheKey(baseConfig, [{ text: 'Different' }]);
    expect(a).not.toBe(b);
  });

  it('key format is targetLang:hash', () => {
    const key = buildCacheKey(baseConfig, baseCues);
    expect(key).toMatch(/^English:\w+$/);
  });
});
