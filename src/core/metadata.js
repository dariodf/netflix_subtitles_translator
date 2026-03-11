// ============================
// PURE HELPERS (exported for testing)
// ============================

/** Score how well two title strings match (0-100) */
export function matchScore(resultName, searchTitle) {
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

/** Normalize cast data from Cinemeta into { character } objects */
export function normalizeCast(meta) {
  let cast = [];
  let hasCharacterNames = false;

  if (meta.credits_cast && meta.credits_cast.length > 0) {
    cast = meta.credits_cast.slice(0, 25).map(c => ({
      character: (c.character || '').replace(/\s*\(voice\)\s*$/i, '').trim(),
    }));
    hasCharacterNames = cast.some(c => c.character);
  }
  if (!hasCharacterNames && meta.cast) {
    if (typeof meta.cast[0] === 'string') {
      cast = [];
    } else {
      cast = meta.cast.slice(0, 25).map(c => ({
        character: c.character || '',
      }));
      hasCharacterNames = cast.some(c => c.character);
    }
  }
  return { cast, hasCharacterNames };
}

/** Build a context object from Netflix metadata API response */
export function buildContextFromNetflix(video, netflixVideoId) {
  const context = {
    title: video.title,
    year: '',
    type: video.type === 'show' ? 'series' : video.type,
    genre: [],
    synopsis: video.synopsis || '',
    cast: [],
    hasCharacterNames: false,
    country: '',
    language: '',
    episode: null,
  };

  if (video.seasons?.[0]?.year) {
    context.year = String(video.seasons[0].year);
  }

  if (video.type === 'show' && video.seasons) {
    for (const season of video.seasons) {
      if (!season.episodes) continue;
      for (const ep of season.episodes) {
        if (String(ep.id) === String(netflixVideoId) || String(ep.episodeId) === String(netflixVideoId)) {
          context.episode = {
            season: season.seq,
            episode: ep.seq,
            title: ep.title || '',
            synopsis: ep.synopsis || '',
          };
          break;
        }
      }
      if (context.episode) break;
    }
  }

  if (context.synopsis.length > 300) {
    context.synopsis = context.synopsis.substring(0, 297) + '...';
  }
  if (context.episode?.synopsis?.length > 200) {
    context.episode.synopsis = context.episode.synopsis.substring(0, 197) + '...';
  }

  return context;
}

/** Fetch Cinemeta metadata (cast, genre) for a title.
 *  @param {string} title - Show/movie title to search for
 *  @param {string} contentType - 'series' or 'movie'
 *  @param {(url: string) => Promise<any>} fetchJson - HTTP GET returning parsed JSON
 *  @returns {Promise<{genre: string[], cast: Array, hasCharacterNames: boolean} | null>}
 */
export async function fetchCinemetaMetadata(title, contentType, fetchJson) {
  for (const type of [contentType, contentType === 'series' ? 'movie' : 'series']) {
    const searchUrl = `https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(title)}.json`;
    const searchData = await fetchJson(searchUrl);
    const metas = searchData?.metas;
    if (!metas || metas.length === 0) continue;

    // Score all candidates without fetching, pick the best, fetch only that one
    const best = metas.slice(0, 5)
      .filter(m => m.imdb_id)
      .map(m => ({ m, score: matchScore(m.name, title) }))
      .reduce((a, b) => b.score > a.score ? b : a, { m: null, score: 0 });

    if (!best.m) continue;

    const metaUrl = `https://cinemeta-live.strem.io/meta/${type}/${best.m.imdb_id}.json`;
    const fullData = await fetchJson(metaUrl);
    if (!fullData?.meta) continue;

    const meta = fullData.meta;
    const genre = meta.genre || meta.genres || [];
    const { cast, hasCharacterNames } = normalizeCast(meta);
    return { genre, cast, hasCharacterNames, year: meta.releaseInfo || '', country: meta.country || '', language: meta.language || '' };
  }

  return null;
}

// ============================
// TVMAZE
// ============================

/** Fetch TVMaze metadata (cast, genre) for a title.
 *  @param {string} title - Show/movie title to search for
 *  @param {string} contentType - 'series' or 'movie' (unused — TVMaze only has shows)
 *  @param {(url: string) => Promise<any>} fetchJson - HTTP GET returning parsed JSON
 *  @returns {Promise<{genre: string[], cast: Array, hasCharacterNames: boolean, year: string, country: string, language: string} | null>}
 */
export async function fetchTvMazeMetadata(title, _contentType, fetchJson) {
  const searchUrl = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(title)}`;
  const results = await fetchJson(searchUrl);
  if (!Array.isArray(results) || results.length === 0) return null;

  let bestShow = null;
  let bestScore = 0;
  for (const result of results.slice(0, 5)) {
    const score = matchScore(result.show?.name, title);
    if (score > bestScore) {
      bestScore = score;
      bestShow = result.show;
    }
    if (bestScore >= 100) break;
  }

  if (!bestShow || bestScore < 40) return null;

  // Fetch full show with cast embed
  const showUrl = `https://api.tvmaze.com/shows/${bestShow.id}?embed=cast`;
  const showData = await fetchJson(showUrl);
  if (!showData) return null;

  const genre = showData.genres || [];
  const country = showData.network?.country?.name || showData.webChannel?.country?.name || '';
  const language = showData.language || '';
  const year = showData.premiered ? showData.premiered.slice(0, 4) : '';

  const rawCast = showData._embedded?.cast || [];
  const cast = rawCast.slice(0, 25).map(entry => ({
    character: (entry.character?.name || '').replace(/\s*\(voice\)\s*$/i, '').trim(),
  }));
  const hasCharacterNames = cast.some(c => c.character);

  return { genre, cast, hasCharacterNames, year, country, language };
}

// ============================
// CAST MERGING
// ============================

/** Strip diacritics/macrons for comparison: Satō → Sato, Katō → Kato */
function stripDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Check if two character names are similar enough to be the same person.
 *  Uses word-level matching to avoid false dedup of siblings (Maki/Mai Zen'in)
 *  and substring traps (Rem/Remus, Ace/Grace). */
function isSameCharacter(nameA, nameB) {
  const a = nameA.toLowerCase().trim();
  const b = nameB.toLowerCase().trim();
  if (!a || !b) return false;
  if (a === b) return true;
  // Diacritics-normalized exact match: "Satō" matches "Sato"
  const aNorm = stripDiacritics(a);
  const bNorm = stripDiacritics(b);
  if (aNorm === bNorm) return true;
  // Word-level containment: all words of the shorter name appear in the longer.
  // "Kenji" matches "Kenji Tanaka", "Mei" matches "Mei Mei", but "Ren" ≠ "Renji"
  const aWords = aNorm.split(/\s+/);
  const bWords = bNorm.split(/\s+/);
  const [shorter, longer] = aWords.length <= bWords.length ? [aWords, bWords] : [bWords, aWords];
  if (shorter.every(word => longer.includes(word))) return true;
  return false;
}

/** Merge two cast lists, deduplicating by character name.
 *  Primary entries are always kept. Secondary entries are added only if
 *  no similar character name exists in primary.
 *  When a partial match is found (e.g. "Kenji" vs "Kenji Tanaka"),
 *  the longer/more complete name is kept. */
export function mergeCastLists(primary, secondary) {
  if (!secondary || secondary.length === 0) {
    const hasCharacterNames = (primary || []).some(c => c.character);
    return { cast: primary || [], hasCharacterNames };
  }
  if (!primary || primary.length === 0) {
    const hasCharacterNames = secondary.some(c => c.character);
    return { cast: secondary, hasCharacterNames };
  }

  const merged = [...primary];

  for (const entry of secondary) {
    if (!entry.character) continue;
    let isDuplicate = false;
    for (let i = 0; i < merged.length; i++) {
      if (!merged[i].character) continue;
      if (isSameCharacter(merged[i].character, entry.character)) {
        // Keep the longer/more complete character name
        if (entry.character.length > merged[i].character.length) {
          merged[i] = { character: entry.character };
        }
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      merged.push(entry);
    }
  }

  const hasCharacterNames = merged.some(c => c.character);
  return { cast: merged, hasCharacterNames };
}

// ============================
// COMBINED FETCH
// ============================

/**
 * Fetch metadata from all providers in parallel and merge results.
 * First successful provider's genre/year/country/language wins; casts are merged.
 *
 * @param {string} title - Show/movie title
 * @param {string} contentType - 'series' or 'movie'
 * @param {(url: string) => Promise<any>} fetchJson - HTTP GET function
 * @returns {Promise<{cast: Array, hasCharacterNames: boolean, genre: string[], year: string, country: string, language: string, sources: string[]}>}
 */
export async function fetchAllMetadata(title, contentType, fetchJson) {
  const providers = [
    { name: 'Cinemeta', fetch: () => fetchCinemetaMetadata(title, contentType, fetchJson) },
    { name: 'TVMaze', fetch: () => fetchTvMazeMetadata(title, contentType, fetchJson) },
  ];

  const results = await Promise.allSettled(providers.map(p => p.fetch()));

  const merged = { cast: [], hasCharacterNames: false, genre: [], year: '', country: '', language: '', sources: [] };

  for (let i = 0; i < results.length; i++) {
    if (results[i].status !== 'fulfilled' || !results[i].value) continue;
    const source = results[i].value;
    merged.sources.push(providers[i].name);

    if (source.genre.length > 0 && !merged.genre.length) merged.genre = source.genre;
    if (source.year && !merged.year) merged.year = source.year;
    if (!merged.country && source.country) merged.country = source.country;
    if (!merged.language && source.language) merged.language = source.language;

    if (merged.cast.length > 0) {
      const result = mergeCastLists(merged.cast, source.cast);
      merged.cast = result.cast;
      merged.hasCharacterNames = result.hasCharacterNames;
    } else {
      merged.cast = source.cast || [];
      merged.hasCharacterNames = source.hasCharacterNames || false;
    }
  }

  return merged;
}
