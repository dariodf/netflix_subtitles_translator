/**
 * AniList character name resolution.
 * Fetches character names from AniList GraphQL API and matches them
 * against speaker labels found in subtitle cues.
 */

import { extractUniqueSpeakerLabels } from './speaker-labels.js';

const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';

const MEDIA_QUERY = `
query ($search: String) {
  Media(search: $search, type: ANIME) {
    title { romaji native english }
    characters(sort: ROLE, page: 1, perPage: 25) {
      nodes {
        name { full native alternative }
      }
    }
  }
}`;

/**
 * Fetch character data from AniList for a given anime title.
 * @param {string} title - Show title to search for
 * @param {Function} postJson - DI'd HTTP POST function: (url, headers, body) => {status, data}
 * @returns {Promise<Array<{fullName: string, nativeName: string|null, alternatives: string[]}>>}
 */
export async function fetchAnilistCharacters(title, postJson) {
  try {
    const response = await postJson(
      ANILIST_GRAPHQL_URL,
      { 'Content-Type': 'application/json' },
      { query: MEDIA_QUERY, variables: { search: title } },
    );
    if (!response || !response.data) return [];
    const media = response.data.data?.Media;
    if (!media?.characters?.nodes) return [];

    return media.characters.nodes
      .filter(node => node.name?.full)
      .map(node => ({
        fullName: node.name.full,
        nativeName: node.name.native || null,
        alternatives: node.name.alternative || [],
      }));
  } catch {
    return [];
  }
}

/**
 * Strip furigana (hiragana) from text that mixes kanji and hiragana.
 * Japanese subtitles annotate kanji with hiragana readings inline:
 *   伏黒ふしぐろ 恵めぐみ → 伏黒恵
 * Preserves katakana (can be part of character names).
 * @param {string} text
 * @returns {string}
 */
export function stripFurigana(text) {
  // Only strip if the text contains kanji — pure hiragana/katakana names should stay
  const hasKanji = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
  if (!hasKanji) return text;

  // Remove hiragana characters and collapse whitespace
  return text.replace(/[\u3040-\u309f]/g, '').replace(/\s+/g, '').trim();
}

/**
 * Match a single speaker label against AniList character data.
 * Tries exact match, then furigana-stripped match, then prefix matching.
 * @param {string} label - Source speaker label (e.g., 虎杖, 伏黒ふしぐろ 恵めぐみ)
 * @param {Array<{fullName: string, nativeName: string|null}>} characters
 * @returns {string|null} English full name or null
 */
export function matchSpeakerToCharacter(label, characters) {
  if (!label || characters.length === 0) return null;

  const stripped = stripFurigana(label);

  for (const char of characters) {
    if (!char.nativeName) continue;

    // Exact match
    if (label === char.nativeName || stripped === char.nativeName) {
      return char.fullName;
    }

    // Label is prefix of native name (e.g., 虎杖 matches 虎杖悠仁)
    if (char.nativeName.startsWith(stripped) && stripped.length >= 2) {
      return char.fullName;
    }

    // Native name is prefix of stripped label (less common but possible)
    if (stripped.startsWith(char.nativeName) && char.nativeName.length >= 2) {
      return char.fullName;
    }
  }

  return null;
}

/**
 * Build a character name map by matching speaker labels against AniList characters.
 * @param {string[]} labels - Unique speaker labels from subtitles
 * @param {Array<{fullName: string, nativeName: string|null}>} characters - AniList data
 * @returns {{matched: Map<string, string>, unmatched: string[]}}
 */
export function buildCharacterNameMap(labels, characters) {
  const matched = new Map();
  const unmatched = [];

  for (const label of labels) {
    const englishName = matchSpeakerToCharacter(label, characters);
    if (englishName) {
      matched.set(label, englishName);
    } else {
      unmatched.push(label);
    }
  }

  return { matched, unmatched };
}

/**
 * Build prompt for LLM to resolve unmatched speaker labels to English names.
 * @param {string[]} unmatchedLabels - Source language speaker labels the LLM should resolve
 * @param {string} title - Show title for context
 * @param {string} sourceLang - Source language (e.g., "Japanese", "Korean")
 * @param {Array<{character: string}>} [cast] - Cast list for reference
 * @returns {{system: string, user: string}}
 */
export function buildNameResolutionPrompt(unmatchedLabels, title, sourceLang, cast = []) {
  const castWithCharacters = cast.filter(c => c.character);
  const castContext = castWithCharacters.length > 0
    ? ` Known characters from the cast: ${castWithCharacters.map(c => c.character).join(', ')}.`
    : '';

  const system = `You are a translator specializing in ${sourceLang || 'Asian language'} media. Given speaker labels from subtitles of "${title}", provide their standard English name translations.${castContext} Output ONLY lines in the format: source_name = English Name. One per line. No explanations.`;

  const user = `Translate these ${sourceLang || ''} speaker/character names to English:\n${unmatchedLabels.join('\n')}`;

  return { system, user };
}

/**
 * Parse LLM response for name resolution. Expects lines like "source = English Name".
 * @param {string} responseText - Raw LLM response
 * @returns {Map<string, string>} source → english mapping
 */
export function parseNameResolutionResponse(responseText) {
  const map = new Map();
  if (!responseText) return map;

  const lines = responseText.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Support both = and → as separators
    const separatorMatch = line.match(/^(.+?)\s*[=→]\s*(.+)$/);
    if (separatorMatch) {
      const source = separatorMatch[1].trim().replace(/^[\d.)\-\s]+/, ''); // strip numbering
      const english = separatorMatch[2].trim();
      if (source && english && source.length <= 50 && english.length <= 80) {
        map.set(source, english);
      }
    }
  }

  return map;
}

/**
 * Full pipeline: extract speaker labels, fetch AniList characters, match, return results.
 * Does NOT call the LLM — returns unmatched labels for the caller to resolve.
 * @param {Array<{text: string}>} cues - Source cues
 * @param {string} title - Show title
 * @param {Function} postJson - DI'd HTTP POST function
 * @returns {Promise<{characterNameMap: Map<string, string>, unmatchedLabels: string[]}>}
 */
export async function resolveCharacterNames(cues, title, postJson) {
  const labels = extractUniqueSpeakerLabels(cues);
  if (labels.length === 0) {
    return { characterNameMap: new Map(), unmatchedLabels: [] };
  }

  const characters = await fetchAnilistCharacters(title, postJson);
  if (characters.length === 0) {
    return { characterNameMap: new Map(), unmatchedLabels: labels };
  }

  const { matched, unmatched } = buildCharacterNameMap(labels, characters);
  return { characterNameMap: matched, unmatchedLabels: unmatched };
}
