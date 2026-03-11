import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  matchScore,
  normalizeCast,
  buildContextFromNetflix,
  fetchCinemetaMetadata,
  fetchTvMazeMetadata,
  mergeCastLists,
} from '../src/core/metadata.js';
import { formatMetadataPrompt } from '../src/core/prompts.js';

const fixture = (name) =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8'));

// ── matchScore ────────────────────────────────────────────

describe('matchScore', () => {
  it('returns 100 for exact match', () => {
    expect(matchScore('Stranger Things', 'Stranger Things')).toBe(100);
  });

  it('is case-insensitive', () => {
    expect(matchScore('stranger things', 'STRANGER THINGS')).toBe(100);
  });

  it('trims whitespace', () => {
    expect(matchScore('  Stranger Things  ', 'Stranger Things')).toBe(100);
  });

  it('returns 80 for prefix match', () => {
    expect(matchScore('Stranger Things: Season 1', 'Stranger Things')).toBe(80);
  });

  it('returns 80 when search is prefix of result', () => {
    expect(matchScore('Stranger', 'Stranger Things')).toBe(80);
  });

  it('returns word-overlap score for partial match', () => {
    const score = matchScore('The Stranger', 'Stranger Things');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(80);
  });

  it('returns 0 for no match', () => {
    expect(matchScore('Breaking Bad', 'Stranger Things')).toBe(0);
  });

  it('returns 0 for null/empty name', () => {
    expect(matchScore(null, 'test')).toBe(0);
    expect(matchScore('', 'test')).toBe(0);
  });

  it('scores proportionally to shared words', () => {
    const s1 = matchScore('My Unique Skill', 'My Unique Skill Makes Me OP');
    const s2 = matchScore('Something Else', 'My Unique Skill Makes Me OP');
    expect(s1).toBeGreaterThan(s2);
  });
});

// ── normalizeCast ─────────────────────────────────────────

describe('normalizeCast', () => {
  it('normalizes credits_cast with character names', () => {
    const meta = {
      credits_cast: [
        { name: 'Winona Ryder', character: 'Joyce Byers' },
        { name: 'David Harbour', character: 'Jim Hopper' },
      ],
    };
    const { cast, hasCharacterNames } = normalizeCast(meta);
    expect(cast.length).toBe(2);
    expect(cast[0].character).toBe('Joyce Byers');
    expect(hasCharacterNames).toBe(true);
  });

  it('strips (voice) suffix from character names', () => {
    const meta = {
      credits_cast: [{ name: 'Tom Hanks', character: 'Woody (voice)' }],
    };
    const { cast } = normalizeCast(meta);
    expect(cast[0].character).toBe('Woody');
  });

  it('falls back to string cast array when no credits_cast', () => {
    const meta = { cast: ['Winona Ryder', 'David Harbour'] };
    const { cast, hasCharacterNames } = normalizeCast(meta);
    expect(cast.length).toBe(0);
    expect(hasCharacterNames).toBe(false);
  });

  it('falls back to object cast when credits_cast has no characters', () => {
    const meta = {
      credits_cast: [{ name: 'A', character: '' }],
      cast: [{ name: 'B', character: 'Character B' }],
    };
    const { cast, hasCharacterNames } = normalizeCast(meta);
    expect(cast[0].character).toBe('Character B');
    expect(hasCharacterNames).toBe(true);
  });

  it('limits to 25 cast members', () => {
    const meta = {
      credits_cast: Array.from({ length: 30 }, (_, i) => ({
        name: `Actor ${i}`, character: `Char ${i}`,
      })),
    };
    expect(normalizeCast(meta).cast.length).toBe(25);
  });

  it('handles empty meta', () => {
    const { cast, hasCharacterNames } = normalizeCast({});
    expect(cast).toEqual([]);
    expect(hasCharacterNames).toBe(false);
  });

  it('works with real Cinemeta series fixture', () => {
    const { cast, hasCharacterNames } = normalizeCast(fixture('cinemeta_meta_series.json').meta);
    expect(cast.length).toBeGreaterThan(0);
    expect(hasCharacterNames).toBe(true);
    expect(cast.find(c => c.character === 'Joyce Byers')).toBeDefined();
  });
});

// ── buildContextFromNetflix ───────────────────────────────

describe('buildContextFromNetflix', () => {
  const video = fixture('netflix_metadata.json').video;

  it('extracts title and type', () => {
    const ctx = buildContextFromNetflix(video, 81727839);
    expect(ctx.title).toBe('My Unique Skill Makes Me OP Even at Level 1');
    expect(ctx.type).toBe('series');
  });

  it('extracts year from first season', () => {
    expect(buildContextFromNetflix(video, 81727839).year).toBe('2023');
  });

  it('finds episode by id', () => {
    const ctx = buildContextFromNetflix(video, 81727839);
    expect(ctx.episode).toEqual({
      season: 1, episode: 1, title: 'Episode 1',
      synopsis: expect.stringContaining('Ryota'),
    });
  });

  it('finds episode by episodeId', () => {
    expect(buildContextFromNetflix(video, 81727842).episode.episode).toBe(4);
  });

  it('returns null episode for unknown id', () => {
    expect(buildContextFromNetflix(video, 99999999).episode).toBeNull();
  });

  it('truncates synopsis > 300 chars', () => {
    const ctx = buildContextFromNetflix({ ...video, synopsis: 'x'.repeat(400) }, 99999);
    expect(ctx.synopsis.length).toBe(300);
    expect(ctx.synopsis.endsWith('...')).toBe(true);
  });

  it('truncates episode synopsis > 200 chars', () => {
    const v = JSON.parse(JSON.stringify(video));
    v.seasons[0].episodes[0].synopsis = 'y'.repeat(250);
    const ctx = buildContextFromNetflix(v, 81727839);
    expect(ctx.episode.synopsis.length).toBe(200);
  });

  it('handles video with no seasons', () => {
    const ctx = buildContextFromNetflix({ title: 'Movie', type: 'movie', synopsis: '' }, 1);
    expect(ctx.episode).toBeNull();
    expect(ctx.year).toBe('');
  });

  it('initializes country and language as empty strings', () => {
    const ctx = buildContextFromNetflix(video, 81727839);
    expect(ctx.country).toBe('');
    expect(ctx.language).toBe('');
  });
});

// ── formatMetadataPrompt ─────────────────────────────────

describe('formatMetadataPrompt', () => {
  it('returns empty string for null', () => {
    expect(formatMetadataPrompt(null)).toBe('');
  });

  it('includes title and year', () => {
    const p = formatMetadataPrompt({ title: 'Test', year: '2023', cast: [] });
    expect(p).toContain('Show: "Test"');
    expect(p).toContain('(2023)');
  });

  it('includes genres as comma-separated list', () => {
    const p = formatMetadataPrompt({ title: 'T', genre: ['Drama', 'Sci-Fi'], cast: [] });
    expect(p).toContain('Drama, Sci-Fi');
  });

  it('includes country when available', () => {
    const p = formatMetadataPrompt({ title: 'T', country: 'Japan', cast: [] });
    expect(p).toContain('Country of origin: Japan');
  });

  it('excludes country when empty', () => {
    const p = formatMetadataPrompt({ title: 'T', country: '', cast: [] });
    expect(p).not.toContain('Country');
  });

  it('includes synopsis when enabled', () => {
    const p = formatMetadataPrompt({ title: 'T', synopsis: 'Great.', cast: [] }, { showSynopsis: true });
    expect(p).toContain('Synopsis: Great.');
  });

  it('excludes synopsis when disabled', () => {
    const p = formatMetadataPrompt({ title: 'T', synopsis: 'Great.', cast: [] }, { showSynopsis: false });
    expect(p).not.toContain('Synopsis');
  });

  it('includes episode info', () => {
    const p = formatMetadataPrompt({
      title: 'T', episode: { season: 2, episode: 5, title: 'Gate', synopsis: 'Bad.' }, cast: [],
    });
    expect(p).toContain('S2E5');
    expect(p).toContain('"Gate"');
    expect(p).toContain('Bad.');
  });

  it('excludes episode synopsis when disabled', () => {
    const p = formatMetadataPrompt(
      { title: 'T', episode: { season: 1, episode: 1, title: 'E', synopsis: 'Secret.' }, cast: [] },
      { episodeSynopsis: false },
    );
    expect(p).not.toContain('Secret.');
  });

  it('includes deduplicated character names', () => {
    const p = formatMetadataPrompt({
      title: 'T', hasCharacterNames: true,
      cast: [
        { character: 'Joyce' },
        { character: 'Joyce' },
        { character: 'Hopper' },
      ],
    });
    expect(p).toContain('Character names (use these exact spellings): Joyce, Hopper');
    expect(p).toContain('Always use only the spellings listed above');
  });

  it('end-to-end with fixture data', () => {
    const ctx = buildContextFromNetflix(fixture('netflix_metadata.json').video, 81727842);
    const { cast, hasCharacterNames } = normalizeCast(fixture('cinemeta_meta_series.json').meta);
    ctx.cast = cast;
    ctx.hasCharacterNames = hasCharacterNames;
    const p = formatMetadataPrompt(ctx);
    expect(p).toContain('My Unique Skill');
    expect(p).toContain('S1E4');
  });
});

// ── fetchCinemetaMetadata ─────────────────────────────────

describe('fetchCinemetaMetadata', () => {
  const searchFixture = fixture('cinemeta_search_series.json');
  const metaFixture = fixture('cinemeta_meta_series.json');

  function makeFetchJson(responses) {
    return async (url) => {
      for (const [pattern, data] of Object.entries(responses)) {
        if (url.includes(pattern)) return data;
      }
      return null;
    };
  }

  it('searches and fetches cast with character names', async () => {
    const fetchJson = makeFetchJson({
      'v3-cinemeta.strem.io/catalog/series': searchFixture,
      'cinemeta-live.strem.io/meta/series/tt4574334': metaFixture,
    });

    const result = await fetchCinemetaMetadata('Stranger Things', 'series', fetchJson);
    expect(result).not.toBeNull();
    expect(result.cast.length).toBeGreaterThan(0);
    expect(result.hasCharacterNames).toBe(true);
    expect(result.cast.find(c => c.character === 'Joyce Byers')).toBeDefined();
  });

  it('returns genre and year from cinemeta', async () => {
    const fetchJson = makeFetchJson({
      'v3-cinemeta.strem.io/catalog/series': searchFixture,
      'cinemeta-live.strem.io/meta/series/tt4574334': metaFixture,
    });

    const result = await fetchCinemetaMetadata('Stranger Things', 'series', fetchJson);
    expect(result.genre).toContain('Mystery');
    expect(result.year).toBeTruthy();
  });

  it('returns country and language from cinemeta', async () => {
    const fetchJson = makeFetchJson({
      'v3-cinemeta.strem.io/catalog/series': searchFixture,
      'cinemeta-live.strem.io/meta/series/tt4574334': metaFixture,
    });

    const result = await fetchCinemetaMetadata('Stranger Things', 'series', fetchJson);
    expect(result.country).toBe('United States');
    expect(result.language).toBe('English');
  });

  it('returns null when search returns no results', async () => {
    const fetchJson = makeFetchJson({
      'v3-cinemeta.strem.io': { metas: [] },
    });

    const result = await fetchCinemetaMetadata('Nonexistent Show', 'series', fetchJson);
    expect(result).toBeNull();
  });

  it('returns null when fetchJson returns null', async () => {
    const fetchJson = async () => null;
    const result = await fetchCinemetaMetadata('Test', 'movie', fetchJson);
    expect(result).toBeNull();
  });

  it('tries alternate content type when primary returns no results', async () => {
    const calls = [];
    const fetchJson = async (url) => {
      calls.push(url);
      if (url.includes('catalog/movie')) return { metas: [] };
      if (url.includes('catalog/series')) return searchFixture;
      if (url.includes('cinemeta-live')) return metaFixture;
      return null;
    };

    const result = await fetchCinemetaMetadata('Stranger Things', 'movie', fetchJson);
    expect(result).not.toBeNull();
    expect(calls.some(u => u.includes('catalog/movie'))).toBe(true);
    expect(calls.some(u => u.includes('catalog/series'))).toBe(true);
  });

  it('picks best match by score', async () => {
    const searchWithMultiple = {
      metas: [
        { imdb_id: 'tt0000001', name: 'Wrong Show' },
        { imdb_id: 'tt4574334', name: 'Stranger Things' },
      ],
    };
    const fetchJson = async (url) => {
      if (url.includes('catalog/series')) return searchWithMultiple;
      if (url.includes('tt4574334')) return metaFixture;
      if (url.includes('tt0000001')) return { meta: { cast: ['Nobody'] } };
      return null;
    };

    const result = await fetchCinemetaMetadata('Stranger Things', 'series', fetchJson);
    expect(result.cast.find(c => c.character === 'Joyce Byers')).toBeDefined();
  });
});

// ── fetchTvMazeMetadata ──────────────────────────────────

describe('fetchTvMazeMetadata', () => {
  const searchFixture = fixture('tvmaze_search.json');
  const showFixture = fixture('tvmaze_show_cast.json');

  function makeFetchJson(responses) {
    return async (url) => {
      for (const [pattern, data] of Object.entries(responses)) {
        if (url.includes(pattern)) return data;
      }
      return null;
    };
  }

  it('searches and fetches cast with character names', async () => {
    const fetchJson = makeFetchJson({
      'api.tvmaze.com/search': searchFixture,
      'api.tvmaze.com/shows/99999': showFixture,
    });

    const result = await fetchTvMazeMetadata('Shadow Academy', 'series', fetchJson);
    expect(result).not.toBeNull();
    expect(result.cast.length).toBe(25);
    expect(result.cast[0]).toEqual({ character: 'Kenji Tanaka' });
    expect(result.hasCharacterNames).toBe(true);
  });

  it('returns genre, year, country, language from fixture', async () => {
    const fetchJson = makeFetchJson({
      'api.tvmaze.com/search': searchFixture,
      'api.tvmaze.com/shows/99999': showFixture,
    });

    const result = await fetchTvMazeMetadata('Shadow Academy', 'series', fetchJson);
    expect(result.genre).toEqual(['Action', 'Drama', 'Fantasy']);
    expect(result.year).toBe('2023');
    expect(result.country).toBe('Japan');
    expect(result.language).toBe('Japanese');
  });

  it('includes known characters from fixture', async () => {
    const fetchJson = makeFetchJson({
      'api.tvmaze.com/search': searchFixture,
      'api.tvmaze.com/shows/99999': showFixture,
    });

    const result = await fetchTvMazeMetadata('Shadow Academy', 'series', fetchJson);
    const chars = result.cast.map(c => c.character);
    expect(chars).toContain('Kenji Tanaka');
    expect(chars).toContain('Haruto Suzuki');
    expect(chars).toContain('Sakura Kimura');
  });

  it('returns null when search returns no results', async () => {
    const result = await fetchTvMazeMetadata('Nonexistent', 'series', async () => []);
    expect(result).toBeNull();
  });

  it('returns null when search returns null', async () => {
    const result = await fetchTvMazeMetadata('Test', 'series', async () => null);
    expect(result).toBeNull();
  });

  it('returns null when best match score is too low', async () => {
    const fetchJson = makeFetchJson({
      'api.tvmaze.com/search': [{ score: 0.1, show: { id: 1, name: 'Completely Different' } }],
    });
    const result = await fetchTvMazeMetadata('Shadow Academy', 'series', fetchJson);
    expect(result).toBeNull();
  });
});

// ── mergeCastLists ───────────────────────────────────────

describe('mergeCastLists', () => {
  it('returns primary when secondary is empty', () => {
    const primary = [{ character: 'Char A' }];
    const { cast, hasCharacterNames } = mergeCastLists(primary, []);
    expect(cast).toEqual(primary);
    expect(hasCharacterNames).toBe(true);
  });

  it('returns secondary when primary is empty', () => {
    const secondary = [{ character: 'Char B' }];
    const { cast } = mergeCastLists([], secondary);
    expect(cast).toEqual(secondary);
  });

  it('deduplicates exact character name matches (case-insensitive)', () => {
    const primary = [{ character: 'Kenji Tanaka' }];
    const secondary = [{ character: 'kenji tanaka' }];
    const { cast } = mergeCastLists(primary, secondary);
    expect(cast.length).toBe(1);
  });

  it('deduplicates partial name matches and keeps longer name', () => {
    const primary = [{ character: 'Kenji' }];
    const secondary = [{ character: 'Kenji Tanaka' }];
    const { cast } = mergeCastLists(primary, secondary);
    expect(cast.length).toBe(1);
    expect(cast[0].character).toBe('Kenji Tanaka');
  });

  it('deduplicates diacritics-normalized matches (Satō vs Sato)', () => {
    const primary = [{ character: 'Takeshi Sato' }];
    const secondary = [{ character: 'Takeshi Satō' }];
    const { cast } = mergeCastLists(primary, secondary);
    expect(cast.length).toBe(1);
  });

  it('keeps siblings with similar names separate (Maki vs Mai)', () => {
    const primary = [{ character: "Maki Yamada" }];
    const secondary = [{ character: "Mai Yamada" }];
    const { cast } = mergeCastLists(primary, secondary);
    expect(cast.length).toBe(2);
  });

  it('keeps non-overlapping entries from both lists', () => {
    const primary = [{ character: 'Kenji Tanaka' }];
    const secondary = [{ character: 'Haruto Suzuki' }];
    const { cast } = mergeCastLists(primary, secondary);
    expect(cast.length).toBe(2);
    expect(cast[0].character).toBe('Kenji Tanaka');
    expect(cast[1].character).toBe('Haruto Suzuki');
  });

  it('skips secondary entries without character names', () => {
    const primary = [{ character: 'Char A' }];
    const secondary = [{ character: '' }];
    const { cast } = mergeCastLists(primary, secondary);
    expect(cast.length).toBe(1);
  });

  it('handles null inputs', () => {
    expect(mergeCastLists(null, null).cast).toEqual([]);
    expect(mergeCastLists(null, [{ character: 'C' }]).cast.length).toBe(1);
  });
});

// ── Netflix metadata fixture structure ────────────────────

describe('Netflix metadata fixture', () => {
  const data = fixture('netflix_metadata.json');

  it('has expected shape', () => {
    expect(data.version).toBe('2.1');
    expect(data.video.id).toBe(81727837);
    expect(data.video.seasons[0].episodes.length).toBe(12);
  });

  it('currentEpisode points to episode 4', () => {
    const ep = data.video.seasons[0].episodes.find(e => e.id === data.video.currentEpisode);
    expect(ep.seq).toBe(4);
  });
});
