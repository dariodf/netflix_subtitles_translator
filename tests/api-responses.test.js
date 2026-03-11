import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseTranslationResponse } from '../src/core/request-parser.js';

const loadFixture = (name) => JSON.parse(readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8'));

// ── Google Translate response parsing ──────────────────────

describe('google translate fixture', () => {
  const response = loadFixture('google_translate_response.json');

  it('has expected nested array structure', () => {
    expect(Array.isArray(response)).toBe(true);
    expect(Array.isArray(response[0])).toBe(true);
  });

  it('contains translated segments (en→es)', () => {
    // Parse the same way the app does: data[0].map(seg => seg[0]).join('')
    const translated = response[0].map(seg => seg[0]).join('');
    expect(translated).toContain('¿Hola, cómo estás?');
    expect(translated).toContain('Estoy bien');
    expect(translated).toContain('¿Cómo te llamas?');
  });

  it('each segment has [translated, original] pair', () => {
    for (const seg of response[0]) {
      expect(typeof seg[0]).toBe('string'); // translated
      expect(typeof seg[1]).toBe('string'); // original
    }
  });

  it('detected source language is English', () => {
    expect(response[2]).toBe('en');
  });
});

describe('google translate autodetect fixture', () => {
  const response = loadFixture('google_translate_autodetect.json');

  it('auto-detected Spanish as source language', () => {
    expect(response[2]).toBe('es');
  });

  it('contains English translations (es→en)', () => {
    const translated = response[0].map(seg => seg[0]).join('');
    expect(translated.toLowerCase()).toContain('hello');
    expect(translated.toLowerCase()).toContain('fine');
  });

  it('has 4 translated segments', () => {
    expect(response[0].length).toBe(4);
  });
});

// ── Lingva Translate response parsing ──────────────────────

describe('lingva translate fixture', () => {
  const response = loadFixture('lingva_translate_response.json');

  it('has translation field', () => {
    expect(typeof response.translation).toBe('string');
  });

  it('translated en→es correctly', () => {
    expect(response.translation.toLowerCase()).toContain('hola');
  });
});

describe('lingva translate autodetect fixture', () => {
  const response = loadFixture('lingva_translate_autodetect.json');

  it('translated auto-detected es→en', () => {
    expect(response.translation.toLowerCase()).toContain('hello');
  });
});

// ── LibreTranslate error fixture ───────────────────────────

describe('libretranslate error fixture', () => {
  const response = loadFixture('libretranslate_response.json');

  it('returns error requiring API key', () => {
    expect(response.error).toBeTruthy();
    expect(response.error).toContain('API key');
  });

  it('does not contain translatedText', () => {
    expect(response.translatedText).toBeUndefined();
  });
});

// ── Cinemeta search fixtures ───────────────────────────────

describe('cinemeta search series fixture', () => {
  const data = loadFixture('cinemeta_search_series.json');

  it('has metas array', () => {
    expect(Array.isArray(data.metas)).toBe(true);
    expect(data.metas.length).toBeGreaterThan(0);
  });

  it('first result is Stranger Things with correct IMDB ID', () => {
    expect(data.metas[0].name).toBe('Stranger Things');
    expect(data.metas[0].imdb_id).toBe('tt4574334');
    expect(data.metas[0].type).toBe('series');
  });

  it('all results have required fields', () => {
    for (const meta of data.metas) {
      expect(meta.name).toBeTruthy();
      expect(meta.imdb_id).toMatch(/^tt\d+$/);
      expect(meta.type).toBe('series');
    }
  });

  it('matchScore logic would select Stranger Things as best match', () => {
    // Replicate the matchScore function from metadata.js
    function matchScore(resultName, searchTitle) {
      if (!resultName) return 0;
      const a = resultName.toLowerCase().trim();
      const b = searchTitle.toLowerCase().trim();
      if (a === b) return 100;
      if (a.startsWith(b) || b.startsWith(a)) return 80;
      const aWords = new Set(a.split(/\s+/));
      const bWords = new Set(b.split(/\s+/));
      const shared = [...aWords].filter(w => bWords.has(w)).length;
      const total = Math.max(aWords.size, bWords.size);
      return total > 0 ? Math.round((shared / total) * 60) : 0;
    }

    const scores = data.metas.map(m => ({ name: m.name, score: matchScore(m.name, 'Stranger Things') }));
    const best = scores.reduce((a, b) => a.score >= b.score ? a : b);
    expect(best.name).toBe('Stranger Things');
    expect(best.score).toBe(100);
  });
});

describe('cinemeta search movie fixture', () => {
  const data = loadFixture('cinemeta_search_movie.json');

  it('has metas array with movie results', () => {
    expect(Array.isArray(data.metas)).toBe(true);
    expect(data.metas.length).toBeGreaterThan(0);
  });

  it('contains The Matrix with correct IMDB ID', () => {
    const matrix = data.metas.find(m => m.name === 'The Matrix');
    expect(matrix).toBeTruthy();
    expect(matrix.imdb_id).toBe('tt0133093');
    expect(matrix.type).toBe('movie');
  });
});

// ── Cinemeta full metadata fixtures ────────────────────────

describe('cinemeta meta series fixture (Stranger Things)', () => {
  const data = loadFixture('cinemeta_meta_series.json');
  const meta = data.meta;

  it('has correct show info', () => {
    expect(meta.name).toBe('Stranger Things');
    expect(meta.type).toBe('series');
    expect(meta.releaseInfo).toContain('2016');
  });

  it('has genres array', () => {
    expect(Array.isArray(meta.genres)).toBe(true);
    expect(meta.genres.length).toBeGreaterThan(0);
  });

  it('has credits_cast with character names', () => {
    expect(Array.isArray(meta.credits_cast)).toBe(true);
    expect(meta.credits_cast.length).toBeGreaterThan(0);

    const joyce = meta.credits_cast.find(c => c.character === 'Joyce Byers');
    expect(joyce).toBeTruthy();
    expect(joyce.name).toBe('Winona Ryder');

    const eleven = meta.credits_cast.find(c => c.character.includes('Eleven'));
    expect(eleven).toBeTruthy();
    expect(eleven.name).toBe('Millie Bobby Brown');
  });

  it('cast processing produces hasCharacterNames=true', () => {
    // Replicate cast processing from metadata.js
    const context = { cast: [], hasCharacterNames: false };
    if (meta.credits_cast && meta.credits_cast.length > 0) {
      context.cast = meta.credits_cast.slice(0, 25).map(c => ({
        character: (c.character || '').replace(/\s*\(voice\)\s*$/i, '').trim(),
      }));
      context.hasCharacterNames = context.cast.some(c => c.character);
    }
    expect(context.hasCharacterNames).toBe(true);
    expect(context.cast.length).toBeGreaterThan(5);
    expect(context.cast.some(c => c.character === 'Jim Hopper')).toBe(true);
  });

  it('has episodes (videos array)', () => {
    expect(Array.isArray(meta.videos)).toBe(true);
    expect(meta.videos.length).toBeGreaterThan(0);
  });

  it('has string-based cast array as fallback', () => {
    expect(Array.isArray(meta.cast)).toBe(true);
    expect(meta.cast.length).toBeGreaterThan(0);
    expect(typeof meta.cast[0]).toBe('string');
  });
});

describe('cinemeta meta movie fixture (The Matrix)', () => {
  const data = loadFixture('cinemeta_meta_movie.json');
  const meta = data.meta;

  it('has correct movie info', () => {
    expect(meta.name).toBe('The Matrix');
    expect(meta.type).toBe('movie');
    expect(meta.releaseInfo).toBe('1999');
  });

  it('has genres', () => {
    expect(meta.genres).toContain('Action');
    expect(meta.genres).toContain('Science Fiction');
  });

  it('has credits_cast with iconic characters', () => {
    const neo = meta.credits_cast.find(c => c.character === 'Neo');
    expect(neo).toBeTruthy();
    expect(neo.name).toBe('Keanu Reeves');

    const morpheus = meta.credits_cast.find(c => c.character === 'Morpheus');
    expect(morpheus).toBeTruthy();
    expect(morpheus.name).toBe('Laurence Fishburne');

    const trinity = meta.credits_cast.find(c => c.character === 'Trinity');
    expect(trinity).toBeTruthy();
  });
});

// ── Ollama chat response → parseTranslationResponse ────────

describe('ollama response through parseTranslationResponse', () => {
  const ollamaResponse = loadFixture('ollama_chat_response.json');
  const translatedText = ollamaResponse.message.content;

  // The original cues that were sent for translation
  const originalCues = [
    { text: 'Something is coming.', begin: 0, end: 1000 },
    { text: 'Something hungry for blood.', begin: 1000, end: 2000 },
    { text: 'A shadow grows on the wall behind you—swallowing you in darkness.', begin: 2000, end: 3000 },
    { text: 'It is almost here.', begin: 3000, end: 4000 },
    { text: '[growling]', begin: 4000, end: 5000 },
    { text: 'Will, your turn.', begin: 5000, end: 6000 },
    { text: '♪ Should I stay or should I go ♪', begin: 6000, end: 7000 },
    { text: "I got a seven.—Mom, we're home!", begin: 7000, end: 8000 },
  ];

  it('parses all 8 lines from real Ollama output', () => {
    const results = parseTranslationResponse(translatedText, originalCues);
    expect(results.length).toBe(8);
    // No gaps — all should be translated (not fall back to originals)
    for (let i = 0; i < results.length; i++) {
      expect(results[i]).not.toBe(originalCues[i].text);
    }
  });

  it('produces Spanish translations', () => {
    const results = parseTranslationResponse(translatedText, originalCues);
    expect(results[0]).toContain('Algo');
    expect(results[5]).toContain('Will');
  });

  it('preserves music markers in translation', () => {
    const results = parseTranslationResponse(translatedText, originalCues);
    expect(results[6]).toContain('♪');
  });
});
