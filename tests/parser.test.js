import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isSubtitleUrl, parseTTML, extractLanguageCode, timeToMs, simpleHash } from '../src/core/parser.js';

const fixture = (name) => readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8');

// ── isSubtitleUrl ──────────────────────────────────────────

describe('isSubtitleUrl', () => {
  it('accepts nflxvideo.net subtitle URLs with ?o= param', () => {
    expect(isSubtitleUrl('https://ipv4-c123-lax001.ix.nflxvideo.net/sub/abc?o=AQE')).toBe(true);
  });

  it('accepts nflximg.net textstream URLs', () => {
    expect(isSubtitleUrl('https://assets.nflximg.net/textstream/en-us/ttml/12345.ttml')).toBe(true);
  });

  it('accepts oca.nflxvideo TTML URLs', () => {
    expect(isSubtitleUrl('https://oca.nflxvideo.net/content/ttml/12345.dfxp?o=1')).toBe(true);
  });

  it('rejects non-Netflix URLs', () => {
    expect(isSubtitleUrl('https://example.com/subtitles.ttml')).toBe(false);
  });

  it('rejects Netflix video/audio segment URLs', () => {
    expect(isSubtitleUrl('https://ipv4-c123.ix.nflxvideo.net/range/1234-5678')).toBe(false);
  });

  it('rejects empty and null inputs', () => {
    expect(isSubtitleUrl('')).toBe(false);
    expect(isSubtitleUrl(null)).toBe(false);
    expect(isSubtitleUrl(undefined)).toBe(false);
  });
});

// ── timeToMs ───────────────────────────────────────────────

describe('timeToMs', () => {
  it('converts tick format (e.g. "12345678t")', () => {
    // default ticksToMs = 0.0001
    expect(timeToMs('10000000t', 0.0001)).toBe(1000);
    expect(timeToMs('50000000t', 0.0001)).toBe(5000);
  });

  it('converts tick format with Netflix tickRate (10000000)', () => {
    const ticksToMs = 1000 / 10000000; // 0.0001
    expect(timeToMs('10000000t', ticksToMs)).toBe(1000);
    expect(timeToMs('0t', ticksToMs)).toBe(0);
  });

  it('converts decimal format "HH:MM:SS.mmm"', () => {
    expect(timeToMs('00:01:23.456')).toBe(83456);
    expect(timeToMs('01:00:00.000')).toBe(3600000);
    expect(timeToMs('00:00:00.000')).toBe(0);
  });

  it('converts plain "HH:MM:SS" format', () => {
    expect(timeToMs('00:01:30')).toBe(90000);
    expect(timeToMs('01:00:00')).toBe(3600000);
  });

  it('converts frame-based format "HH:MM:SS:FF"', () => {
    // at 30fps, frame 15 = 500ms
    expect(timeToMs('00:00:01:15', 0.0001, 30)).toBe(1500);
    expect(timeToMs('00:00:01:00', 0.0001, 30)).toBe(1000);
  });

  it('returns 0 for null/empty input', () => {
    expect(timeToMs(null)).toBe(0);
    expect(timeToMs('')).toBe(0);
    expect(timeToMs(undefined)).toBe(0);
  });
});

// ── simpleHash ─────────────────────────────────────────────

describe('simpleHash', () => {
  it('returns consistent hash for same input', () => {
    const h1 = simpleHash('hello world');
    const h2 = simpleHash('hello world');
    expect(h1).toBe(h2);
  });

  it('returns different hashes for different inputs', () => {
    expect(simpleHash('foo')).not.toBe(simpleHash('bar'));
  });

  it('returns a string (base36)', () => {
    const h = simpleHash('test');
    expect(typeof h).toBe('string');
    expect(h).toMatch(/^-?[0-9a-z]+$/);
  });

  it('handles empty string', () => {
    expect(simpleHash('')).toBe('0');
  });
});

// ── parseTTML ──────────────────────────────────────────────

describe('parseTTML', () => {
  it('parses sample1 (tick-based, DFXP-LS-SDH, 8 cues)', () => {
    const xml = fixture('netflix_ttml_sample1.xml');
    const { cues } = parseTTML(xml);
    expect(cues.length).toBe(8);
    expect(cues[0].text).toBe('Ricky! Ricky! Wake the f***');
    expect(cues[1].text).toBe('up! Ricky, get up!');
    expect(cues[7].text).toBe('of the Shed and Breakfast.');
    // Timing: tick-based at tickRate 10000000
    const ticksToMs = 1000 / 10000000;
    expect(cues[0].begin).toBeCloseTo(241910001 * ticksToMs, 0);
    expect(cues[0].end).toBeGreaterThan(cues[0].begin);
    // Pairs of cues share the same timing (two-line subtitles)
    expect(cues[0].begin).toBe(cues[1].begin);
    expect(cues[0].end).toBe(cues[1].end);
  });

  it('parses sample2 (single cue with <br/> and <span>)', () => {
    const xml = fixture('netflix_ttml_sample2_tickrate.xml');
    const { cues } = parseTTML(xml);
    expect(cues.length).toBe(1);
    // <br/> becomes "—" (em dash), span text is flattened
    expect(cues[0].text).toContain('So as of last week,');
    expect(cues[0].text).toContain('—');
    expect(cues[0].text).toContain('Terrace House');
    expect(cues[0].text).toContain('began its new season.');
  });

  it('parses sample3 (Spanish, TTAF1 namespace, <br/> + <span>)', () => {
    const xml = fixture('netflix_ttml_sample3_spanish.xml');
    const { cues } = parseTTML(xml);
    expect(cues.length).toBe(3);
    expect(cues[0].text).toBe('¡Dejad de moverle!');
    expect(cues[1].text).toBe('¡No mováis la valla!');
    // Third cue has <br/> between two <span> elements
    expect(cues[2].text).toContain('(EN INGLÉS) ¡Soy refugiado!');
    expect(cues[2].text).toContain('—');
    expect(cues[2].text).toContain('¡Soy refugiado!');
  });

  it('parses sample4 (6 cues, CC annotation, <br/> tags)', () => {
    const xml = fixture('netflix_ttml_sample4_framerate.xml');
    const { cues } = parseTTML(xml);
    expect(cues.length).toBe(6);
    // First cue is a closed caption annotation
    expect(cues[0].text).toBe('[upbeat music]');
    expect(cues[0].begin).toBe(0);
    // Regular dialogue
    expect(cues[1].text).toBe('All right, Jim,');
    // <br/> becomes "—" (em dash)
    expect(cues[2].text).toBe('your quarterlies—look very good.');
    expect(cues[3].text).toBe('How are things going—at the library?');
    expect(cues[5].text).toContain('the master for guidance?');
  });

  it('parses sample5 (Spanish, italic/normal styles, 4 cues)', () => {
    const xml = fixture('netflix_ttml_sample5.xml');
    const { cues } = parseTTML(xml);
    expect(cues.length).toBe(4);
    expect(cues[0].text).toBe('UNA SERIE ORIGINAL DE NETFLIX');
    expect(cues[1].text).toBe('ANDALUCÍA, ESPAÑA, ACTUALIDAD');
    expect(cues[2].text).toBe('Toda la vida he soñado con la muerte.');
    expect(cues[3].text).toBe('Abandono mi cuerpo y me veo desde arriba.');
  });

  it('sorts cues by begin time across all fixtures', () => {
    const files = [
      'netflix_ttml_sample1.xml',
      'netflix_ttml_sample2_tickrate.xml',
      'netflix_ttml_sample3_spanish.xml',
      'netflix_ttml_sample4_framerate.xml',
      'netflix_ttml_sample5.xml',
    ];
    for (const f of files) {
      const { cues } = parseTTML(fixture(f));
      for (let i = 1; i < cues.length; i++) {
        expect(cues[i].begin).toBeGreaterThanOrEqual(cues[i - 1].begin);
      }
    }
  });

  it('extracts ttmlMeta with xml:lang', () => {
    const xml = `<?xml version="1.0"?>
    <tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en">
    <body><div><p begin="00:00:01.000" end="00:00:02.000">Hello</p></div></body>
    </tt>`;
    const { meta } = parseTTML(xml);
    expect(meta).not.toBeNull();
    expect(meta.lang).toBe('en');
  });

  it('extracts ttmlMeta with movieId from metadata', () => {
    const xml = `<?xml version="1.0"?>
    <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
    <head><metadata ttm:movieId="81234567"><ttm:title>Stranger Things</ttm:title></metadata></head>
    <body><div><p begin="00:00:01.000" end="00:00:02.000">Hello</p></div></body>
    </tt>`;
    const { meta } = parseTTML(xml);
    expect(meta).not.toBeNull();
    expect(meta.movieId).toBe('81234567');
    expect(meta.title).toBe('Stranger Things');
  });

  it('returns null meta when no metadata is present', () => {
    const xml = `<?xml version="1.0"?>
    <tt xmlns="http://www.w3.org/ns/ttml">
    <body><div><p begin="00:00:01.000" end="00:00:02.000">Hello</p></div></body>
    </tt>`;
    const { meta } = parseTTML(xml);
    expect(meta).toBeNull();
  });

  it('handles dur attribute as fallback for end time', () => {
    const xml = `<?xml version="1.0"?>
    <tt xmlns="http://www.w3.org/ns/ttml">
    <body><div><p begin="00:00:01.000" dur="00:00:02.000">Hello</p></div></body>
    </tt>`;
    const { cues } = parseTTML(xml);
    expect(cues.length).toBe(1);
    expect(cues[0].begin).toBe(1000);
    expect(cues[0].end).toBe(3000); // begin + dur
  });

  it('defaults to begin + 5000ms when neither end nor dur', () => {
    const xml = `<?xml version="1.0"?>
    <tt xmlns="http://www.w3.org/ns/ttml">
    <body><div><p begin="00:00:01.000">Hello</p></div></body>
    </tt>`;
    const { cues } = parseTTML(xml);
    expect(cues.length).toBe(1);
    expect(cues[0].end).toBe(6000); // 1000 + 5000
  });

  it('deduplicates exact duplicate cues (same text and timing)', () => {
    const xml = `<?xml version="1.0"?>
    <tt xmlns="http://www.w3.org/ns/ttml">
    <body><div>
      <p begin="00:00:01.000" end="00:00:02.000">Hello</p>
      <p begin="00:00:01.000" end="00:00:02.000">Hello</p>
    </div></body>
    </tt>`;
    const { cues } = parseTTML(xml);
    expect(cues.length).toBe(1);
  });

  it('keeps cues with same timing but different text', () => {
    const xml = `<?xml version="1.0"?>
    <tt xmlns="http://www.w3.org/ns/ttml">
    <body><div>
      <p begin="00:00:01.000" end="00:00:02.000">Hello</p>
      <p begin="00:00:01.000" end="00:00:02.000">World</p>
    </div></body>
    </tt>`;
    const { cues } = parseTTML(xml);
    expect(cues.length).toBe(2);
  });

  it('returns empty cues for invalid XML', () => {
    const { cues } = parseTTML('<not-valid-xml>');
    expect(cues).toEqual([]);
  });
});

// ── extractLanguageCode ──────────────────────────────────────

describe('extractLanguageCode', () => {
  it('extracts xml:lang from TTML content', () => {
    const xml = '<?xml version="1.0"?><tt xml:lang="ja" xmlns="http://www.w3.org/ns/ttml"><body/></tt>';
    expect(extractLanguageCode(xml)).toBe('ja');
  });

  it('returns lowercase code', () => {
    const xml = '<tt xml:lang="EN">';
    expect(extractLanguageCode(xml)).toBe('en');
  });

  it('handles single-quoted attributes', () => {
    const xml = "<tt xml:lang='ko'>";
    expect(extractLanguageCode(xml)).toBe('ko');
  });

  it('returns empty string when no xml:lang', () => {
    expect(extractLanguageCode('<tt><body/></tt>')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(extractLanguageCode('')).toBe('');
  });
});

describe('parseTTML (continued)', () => {
  it('all fixtures produce valid cue objects', () => {
    const files = [
      'netflix_ttml_sample1.xml',
      'netflix_ttml_sample2_tickrate.xml',
      'netflix_ttml_sample3_spanish.xml',
      'netflix_ttml_sample4_framerate.xml',
      'netflix_ttml_sample5.xml',
    ];
    for (const f of files) {
      const { cues } = parseTTML(fixture(f));
      expect(cues.length).toBeGreaterThan(0);
      for (const cue of cues) {
        expect(typeof cue.text).toBe('string');
        expect(cue.text.length).toBeGreaterThan(0);
        expect(typeof cue.begin).toBe('number');
        expect(typeof cue.end).toBe('number');
        expect(cue.end).toBeGreaterThan(cue.begin);
      }
    }
  });
});
