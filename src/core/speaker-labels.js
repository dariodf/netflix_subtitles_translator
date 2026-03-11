/**
 * Speaker label extraction, replacement, and normalization.
 * Handles speaker labels in subtitle cues: [Korean], （Japanese）, (English).
 */

// ============================
// EXTRACTION
// ============================

/** Regex for speaker labels at the start of a line: [Name], (Name), or （Name） */
const SPEAKER_LABEL_PATTERN = /^(?:\[([^\]]+)\]|\(([^)]+)\)|（([^）]+)）)/;

/**
 * Check whether a speaker label is likely a sound effect rather than a character name.
 * @param {string} label - The extracted speaker label text
 * @returns {boolean}
 */
export function isSoundEffect(label) {
  // Ends with 音 (sound) — e.g., 急流音, 殴打音, 衝撃音
  if (/音$/.test(label)) return true;
  // Ends with 声 (voice/cry) as standalone — e.g., 笑い声, 叫び声
  if (/声$/.test(label)) return true;
  // Narration
  if (label === 'ナレーション') return true;
  // Patterns like ～する音, ～の音
  if (/[がのする]+音/.test(label)) return true;
  // Korean sound effect patterns: ends with 소리 (sound)
  if (/소리$/.test(label)) return true;

  return false;
}

/**
 * Extract unique speaker labels from subtitle cues, filtering out sound effects.
 * @param {Array<{text: string}>} cues - Source cues with .text property
 * @returns {string[]} Unique speaker labels
 */
export function extractUniqueSpeakerLabels(cues) {
  const labels = new Set();

  for (const cue of cues) {
    const text = cue.text || '';
    // Japanese full-width parentheses with dialogue after
    const jpMatch = text.match(/^（([^）]+)）./);
    if (jpMatch) {
      labels.add(jpMatch[1]);
      continue;
    }
    // Korean square brackets with dialogue after
    const krMatch = text.match(/^\[([^\]]+)\]./);
    if (krMatch) {
      labels.add(krMatch[1]);
    }
  }

  // Filter out sound effects
  return [...labels].filter(label => !isSoundEffect(label));
}

/**
 * Extract the speaker label text from the start of a line, if present.
 * @param {string} text
 * @returns {string|null} The label text (without brackets), or null
 */
export function extractLeadingSpeakerLabel(text) {
  if (!text) return null;
  const match = text.match(SPEAKER_LABEL_PATTERN);
  if (!match) return null;
  return match[1] || match[2] || match[3] || null;
}

// ============================
// REPLACEMENT
// ============================

/**
 * Replace speaker labels in cue text using the character name map.
 * Only replaces the speaker label at the start of the cue, not arbitrary text.
 * Returns new cue array (immutable — does not modify originals).
 * @param {Array<{text: string, begin: number, end: number}>} cues
 * @param {Map<string, string>} characterNameMap
 * @returns {Array<{text: string, begin: number, end: number}>}
 */
export function replaceSpeakerLabels(cues, characterNameMap) {
  if (!characterNameMap || characterNameMap.size === 0) return cues;

  return cues.map(cue => {
    const text = cue.text || '';

    // Japanese full-width parentheses
    const jpMatch = text.match(/^（([^）]+)）/);
    if (jpMatch) {
      const english = characterNameMap.get(jpMatch[1]);
      if (english) {
        return { ...cue, text: `(${english})${text.slice(jpMatch[0].length)}` };
      }
    }

    // Korean square brackets
    const krMatch = text.match(/^\[([^\]]+)\]/);
    if (krMatch) {
      const english = characterNameMap.get(krMatch[1]);
      if (english) {
        return { ...cue, text: `(${english})${text.slice(krMatch[0].length)}` };
      }
    }

    return cue;
  });
}

// ============================
// POST-TRANSLATION NORMALIZATION
// ============================

/**
 * Score how plausible a label is as a romanized character name.
 * Used to break ties when frequency alone picks the wrong variant
 * (e.g., "Oo" appearing 6× vs "Mo-eum" appearing 5×).
 * @param {string} label
 * @param {number} count - Frequency count
 * @returns {number}
 */
function namePlausibilityScore(label, count) {
  let score = count;
  // Bonus for hyphenated names (common Korean romanization pattern)
  if (label.includes('-') && label.length >= 4) score += 2;
  // Bonus for proper length (3+ chars, looks like a real name)
  if (label.length >= 3 && /^[A-Z]/.test(label)) score += 1;
  // Penalty for suspiciously short labels
  if (label.length <= 2) score -= 3;
  return score;
}

/**
 * Check if two names refer to the same character using word-level containment.
 * All words of the shorter name must appear in the longer name.
 * E.g., "Nakamura" matches "Ryota Nakamura", "Mi-sook" matches "Mi-sook".
 * @param {string} nameA
 * @param {string} nameB
 * @returns {boolean}
 */
function isPartialNameMatch(nameA, nameB) {
  const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  // Collapse elongated vowel romanizations: ou→o, uu→u, ee→e (Satou↔Sato, Yuuki↔Yuki)
  const collapseVowels = s => s.replace(/ou/g, 'o').replace(/uu/g, 'u').replace(/ee/g, 'e');
  const tokenize = s => collapseVowels(normalize(s)).split(/[-\s]+/).filter(Boolean);
  const aWords = tokenize(nameA);
  const bWords = tokenize(nameB);
  if (aWords.length === 0 || bWords.length === 0) return false;
  const [shorter, longer] = aWords.length <= bWords.length ? [aWords, bWords] : [bWords, aWords];
  return shorter.every(word => longer.includes(word));
}

/** Find a cast character that exactly matches any variant (normalized). */
function findCastExactMatch(variants, castCharacters) {
  for (const variant of variants.keys()) {
    const castMatch = castCharacters.find(name =>
      normalizeForComparison(name) === normalizeForComparison(variant)
    );
    if (castMatch) return castMatch;
  }
  return null;
}

/**
 * Find the best translated variant that partially matches a cast character.
 * Returns the most frequent matching variant (not the full cast name), since
 * the LLM's translation is a better subtitle label than the formal full name
 * (e.g., "Falma" is better than "Falma de Médicis" when source says ファルマ).
 * Requires variant count >= 2 to avoid single LLM misattributions.
 */
function findCastPartialMatch(variants, castCharacters) {
  let bestVariant = null;
  let bestScore = 0;
  for (const castName of castCharacters) {
    for (const [variant, count] of variants) {
      if (count < 2) continue;
      if (isPartialNameMatch(castName, variant) && count > bestScore) {
        bestScore = count;
        bestVariant = variant;
      }
    }
  }
  return bestVariant;
}

/** Pick the most plausible variant by weighted frequency. */
function findMostPlausibleVariant(variants) {
  let best = null;
  let maxScore = -Infinity;
  for (const [variant, count] of variants) {
    const score = namePlausibilityScore(variant, count);
    if (score > maxScore) {
      maxScore = score;
      best = variant;
    }
  }
  return best;
}

/**
 * Pick the best canonical name from a frequency map of translated variants.
 * Tries cast list first (exact then partial match), then plausibility-weighted frequency.
 * @param {Map<string, number>} variants - translatedLabel → count
 * @param {string[]} [castCharacters] - Cast character names for matching
 * @returns {string|null}
 */
export function pickCanonicalName(variants, castCharacters = []) {
  if (castCharacters.length > 0) {
    const exactMatch = findCastExactMatch(variants, castCharacters);
    if (exactMatch) return exactMatch;

    const partialMatch = findCastPartialMatch(variants, castCharacters);
    if (partialMatch) return partialMatch;
  }

  return findMostPlausibleVariant(variants);
}

/**
 * Normalize speaker names across translated output for consistency.
 * After translation, different chunks may romanize the same source speaker label
 * differently (e.g., "Seok-ryu" vs "Seokryu" vs "Soyou"). This function:
 * 1. Pairs source speaker labels with their translated counterparts
 * 2. For each source label, picks the best translation using cast data,
 *    then plausibility-weighted frequency
 * 3. Replaces all variant forms with the canonical one
 *
 * @param {Array<{text: string}>} sourceCues - Original source cues
 * @param {Array<{text: string, begin: number, end: number}>} translatedCues - Translated cue objects
 * @param {Array<{character: string}>} [cast] - Optional cast list for canonical names
 * @returns {{ normalizedCount: number, canonicalNames: Map<string, string> }}
 */
export function normalizeSpeakerNames(sourceCues, translatedCues, cast = []) {
  // Step 1: For each source label, collect translated label frequencies
  const labelFrequencies = new Map(); // sourceLabel → Map<translatedLabel, count>

  for (let i = 0; i < sourceCues.length; i++) {
    const sourceLabel = extractLeadingSpeakerLabel(sourceCues[i]?.text);
    if (!sourceLabel) continue;

    const translatedLabel = extractLeadingSpeakerLabel(translatedCues[i]?.text);
    if (!translatedLabel) continue;

    if (!labelFrequencies.has(sourceLabel)) labelFrequencies.set(sourceLabel, new Map());
    const counts = labelFrequencies.get(sourceLabel);
    counts.set(translatedLabel, (counts.get(translatedLabel) || 0) + 1);
  }

  if (labelFrequencies.size === 0) return { normalizedCount: 0, canonicalNames: new Map() };

  // Step 2: Pick canonical name for each source label
  const canonicalNames = new Map(); // sourceLabel → canonicalName
  const castCharacters = cast.filter(c => c.character).map(c => c.character);

  for (const [sourceLabel, variants] of labelFrequencies) {
    const best = pickCanonicalName(variants, castCharacters);
    if (best) canonicalNames.set(sourceLabel, best);
  }

  // Step 3: Replace non-canonical variants in translated cues
  let normalizedCount = 0;

  for (let i = 0; i < sourceCues.length; i++) {
    const sourceLabel = extractLeadingSpeakerLabel(sourceCues[i]?.text);
    if (!sourceLabel) continue;

    const canonical = canonicalNames.get(sourceLabel);
    if (!canonical) continue;

    const translatedLabel = extractLeadingSpeakerLabel(translatedCues[i]?.text);
    if (!translatedLabel || translatedLabel === canonical) continue;

    // Replace the label, preserving bracket style
    const text = translatedCues[i].text;
    const newText = text.replace(SPEAKER_LABEL_PATTERN, (match) => {
      if (match.startsWith('[')) return `[${canonical}]`;
      if (match.startsWith('(')) return `(${canonical})`;
      if (match.startsWith('（')) return `（${canonical}）`;
      return match;
    });

    translatedCues[i] = { ...translatedCues[i], text: newText };
    normalizedCount++;
  }

  return { normalizedCount, canonicalNames };
}

/**
 * Normalize for romanization comparison: strip diacritics, hyphens, spaces, lowercase.
 * Handles Korean romanization variants like "Mi-sook" ↔ "Misook", "Satō" ↔ "Sato".
 * @param {string} str
 * @returns {string}
 */
function normalizeForComparison(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-\s]/g, '').toLowerCase().trim();
}
