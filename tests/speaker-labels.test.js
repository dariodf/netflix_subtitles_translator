import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  isSoundEffect,
  extractUniqueSpeakerLabels,
  extractLeadingSpeakerLabel,
  replaceSpeakerLabels,
  normalizeSpeakerNames,
  pickCanonicalName,
} from '../src/core/speaker-labels.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures', 'normalization');

describe('isSoundEffect', () => {
  it('detects labels ending with 音', () => {
    expect(isSoundEffect('急流音')).toBe(true);
    expect(isSoundEffect('殴打音')).toBe(true);
    expect(isSoundEffect('衝撃音')).toBe(true);
    expect(isSoundEffect('足音')).toBe(true);
  });

  it('detects labels ending with 声', () => {
    expect(isSoundEffect('笑い声')).toBe(true);
    expect(isSoundEffect('叫び声')).toBe(true);
  });

  it('detects narration', () => {
    expect(isSoundEffect('ナレーション')).toBe(true);
  });

  it('detects Korean sound effects ending with 소리', () => {
    expect(isSoundEffect('문 닫는 소리')).toBe(true);
  });

  it('does not flag character names', () => {
    expect(isSoundEffect('田中')).toBe(false);
    expect(isSoundEffect('花子')).toBe(false);
    expect(isSoundEffect('鈴木')).toBe(false);
    expect(isSoundEffect('인숙')).toBe(false);
    expect(isSoundEffect('佐藤')).toBe(false);
  });
});

describe('extractUniqueSpeakerLabels', () => {
  it('extracts Japanese full-width parentheses labels', () => {
    const cues = [
      { text: '（田中）おい！' },
      { text: '（鈴木）何だ？' },
      { text: '（田中）行くぞ！' },
    ];
    const labels = extractUniqueSpeakerLabels(cues);
    expect(labels).toContain('田中');
    expect(labels).toContain('鈴木');
    expect(labels.length).toBe(2); // deduplicated
  });

  it('extracts Korean square bracket labels', () => {
    const cues = [
      { text: '[인숙]네가 그렇게 나오면' },
      { text: '[석류]알겠어' },
    ];
    const labels = extractUniqueSpeakerLabels(cues);
    expect(labels).toContain('인숙');
    expect(labels).toContain('석류');
  });

  it('filters out sound effects', () => {
    const cues = [
      { text: '（田中）おい！' },
      { text: '（急流音）' }, // sound effect, no dialogue after — won't match /./ either
      { text: '（殴打音）ゴン' }, // sound effect WITH content after — should be filtered by isSoundEffect
      { text: '（衝撃音）' },
    ];
    const labels = extractUniqueSpeakerLabels(cues);
    expect(labels).toContain('田中');
    expect(labels).not.toContain('急流音');
    expect(labels).not.toContain('殴打音');
    expect(labels).not.toContain('衝撃音');
  });

  it('ignores cues without speaker labels', () => {
    const cues = [
      { text: '自由だー！' },
      { text: '蜘蛛…' },
    ];
    const labels = extractUniqueSpeakerLabels(cues);
    expect(labels.length).toBe(0);
  });

  it('requires dialogue after label (not sound-effect-only lines)', () => {
    const cues = [
      { text: '（笑い声）' }, // No dialogue after — the ）is the end
    ];
    const labels = extractUniqueSpeakerLabels(cues);
    expect(labels.length).toBe(0);
  });
});

describe('extractLeadingSpeakerLabel', () => {
  it('extracts from Japanese full-width parentheses', () => {
    expect(extractLeadingSpeakerLabel('（田中）おい！')).toBe('田中');
  });

  it('extracts from Korean square brackets', () => {
    expect(extractLeadingSpeakerLabel('[인숙]네가 그렇게')).toBe('인숙');
  });

  it('extracts from English parentheses', () => {
    expect(extractLeadingSpeakerLabel('(Seung-hyo) Hello')).toBe('Seung-hyo');
  });

  it('returns null for text without speaker label', () => {
    expect(extractLeadingSpeakerLabel('自由だー！')).toBe(null);
  });

  it('returns null for empty or null input', () => {
    expect(extractLeadingSpeakerLabel('')).toBe(null);
    expect(extractLeadingSpeakerLabel(null)).toBe(null);
  });

  it('does not extract labels from middle of text', () => {
    expect(extractLeadingSpeakerLabel('some text (Name) more')).toBe(null);
  });
});

describe('replaceSpeakerLabels', () => {
  const nameMap = new Map([
    ['田中', 'Tanaka'],
    ['鈴木', 'Suzuki'],
    ['인숙', 'Insook'],
  ]);

  it('replaces Japanese full-width parentheses labels', () => {
    const cues = [{ text: '（田中）おい！', begin: 0, end: 5000 }];
    const result = replaceSpeakerLabels(cues, nameMap);
    expect(result[0].text).toBe('(Tanaka)おい！');
    expect(result[0].begin).toBe(0);
  });

  it('replaces Korean square bracket labels', () => {
    const cues = [{ text: '[인숙]네가 그렇게', begin: 0, end: 5000 }];
    const result = replaceSpeakerLabels(cues, nameMap);
    expect(result[0].text).toBe('(Insook)네가 그렇게');
  });

  it('leaves unmatched labels unchanged', () => {
    const cues = [{ text: '（謎の男）誰だ', begin: 0, end: 5000 }];
    const result = replaceSpeakerLabels(cues, nameMap);
    expect(result[0].text).toBe('（謎の男）誰だ');
  });

  it('leaves cues without labels unchanged', () => {
    const cues = [{ text: '自由だー！', begin: 0, end: 5000 }];
    const result = replaceSpeakerLabels(cues, nameMap);
    expect(result[0].text).toBe('自由だー！');
  });

  it('does not modify original cues (immutable)', () => {
    const cues = [{ text: '（田中）おい！', begin: 0, end: 5000 }];
    replaceSpeakerLabels(cues, nameMap);
    expect(cues[0].text).toBe('（田中）おい！');
  });

  it('returns original cues when map is empty', () => {
    const cues = [{ text: '（田中）おい！', begin: 0, end: 5000 }];
    const result = replaceSpeakerLabels(cues, new Map());
    expect(result).toBe(cues);
  });

  it('returns original cues when map is null', () => {
    const cues = [{ text: '（田中）おい！', begin: 0, end: 5000 }];
    const result = replaceSpeakerLabels(cues, null);
    expect(result).toBe(cues);
  });
});

// ── pickCanonicalName ───────────────────────────────────────────

describe('pickCanonicalName', () => {
  it('returns exact cast match over frequency', () => {
    const variants = new Map([['Misook', 3], ['Mi-suk', 1]]);
    expect(pickCanonicalName(variants, ['Mi-sook'])).toBe('Mi-sook');
  });

  it('returns best matching variant (not full cast name) for partial match', () => {
    const variants = new Map([['Yamada', 5]]);
    expect(pickCanonicalName(variants, ['Takeshi Yamada'])).toBe('Yamada');
  });

  it('returns highest-frequency variant when multiple match cast entry', () => {
    const variants = new Map([['Tanaka', 3], ['Kenji', 2]]);
    expect(pickCanonicalName(variants, ['Kenji Tanaka'])).toBe('Tanaka');
  });

  it('prefers exact match over partial match', () => {
    const variants = new Map([['Yamada', 2], ['Takeshi Yamada', 1]]);
    expect(pickCanonicalName(variants, ['Takeshi Yamada'])).toBe('Takeshi Yamada');
  });

  it('matches reversed name order (occidental vs oriental)', () => {
    const variants = new Map([['Takeshi Sato', 3]]);
    expect(pickCanonicalName(variants, ['Sato Takeshi'])).toBe('Takeshi Sato');
  });

  it('matches elongated vowel romanizations (Satou matches Satō)', () => {
    const variants = new Map([['Satou', 5]]);
    expect(pickCanonicalName(variants, ['Satō Kenji'])).toBe('Satou');
  });

  it('matches elongated u romanization (Yuuki matches Yūki)', () => {
    const variants = new Map([['Yuuki', 4]]);
    expect(pickCanonicalName(variants, ['Yūki Tanaka'])).toBe('Yuuki');
  });

  it('ignores single-occurrence variants for partial cast matching', () => {
    const variants = new Map([['Kenji', 10], ['Suzuki', 1]]);
    expect(pickCanonicalName(variants, ['Haruto Suzuki'])).not.toBe('Haruto Suzuki');
  });

  it('allows partial cast matching for variants with count >= 2', () => {
    const variants = new Map([['Kenji', 10], ['Suzuki', 2]]);
    expect(pickCanonicalName(variants, ['Haruto Suzuki'])).toBe('Suzuki');
  });

  it('picks highest-frequency variant when multiple cast entries match', () => {
    const variants = new Map([['Yamada', 3], ['Kenji', 2]]);
    expect(pickCanonicalName(variants, ['Yamada Yuto', 'Yamada Kenji'])).toBe('Yamada');
  });

  it('disambiguates similar names by variant evidence (Ren vs Ran)', () => {
    const variants = new Map([['Ren', 5], ['Ran', 2]]);
    expect(pickCanonicalName(variants, ['Ren', 'Ran'])).toBe('Ren');
  });

  it('falls back to plausibility when no cast match', () => {
    const variants = new Map([['Mo-eum', 1], ['Oo', 3]]);
    expect(pickCanonicalName(variants, [])).toBe('Mo-eum');
  });

  it('uses cast to validate variant even for single word match', () => {
    const variants = new Map([['Kim', 2]]);
    expect(pickCanonicalName(variants, ['Park Kim-soo'])).toBe('Kim');
  });
});

// ── normalizeSpeakerNames ───────────────────────────────────────

describe('normalizeSpeakerNames', () => {
  it('normalizes Korean speaker labels to most frequent romanization', () => {
    const source = [
      { text: '[석류] 안녕' },
      { text: '[석류] 뭐해?' },
      { text: '[석류] 가자' },
      { text: '[석류] 잠깐' },
    ];
    const translated = [
      { text: '[Seok-ryu] Hello', begin: 0, end: 1000 },
      { text: '[Seok-ryu] What are you doing?', begin: 1000, end: 2000 },
      { text: '[Seokryu] Let\'s go', begin: 2000, end: 3000 },
      { text: '[Soyou] Wait', begin: 3000, end: 4000 },
    ];

    const { normalizedCount, canonicalNames } = normalizeSpeakerNames(source, translated);
    expect(canonicalNames.get('석류')).toBe('Seok-ryu');
    expect(normalizedCount).toBe(2);
    expect(translated[0].text).toBe('[Seok-ryu] Hello');
    expect(translated[2].text).toBe('[Seok-ryu] Let\'s go');
    expect(translated[3].text).toBe('[Seok-ryu] Wait');
  });

  it('prefers cast character name over frequency', () => {
    const source = [
      { text: '[미숙] 뭐해?' },
      { text: '[미숙] 가자' },
      { text: '[미숙] 잠깐' },
    ];
    const translated = [
      { text: '[Mi-suk] What?', begin: 0, end: 1000 },
      { text: '[Mi-suk] Let\'s go', begin: 1000, end: 2000 },
      { text: '[Misook] Wait', begin: 2000, end: 3000 },
    ];
    const cast = [{ character: 'Mi-sook' }];

    const { normalizedCount, canonicalNames } = normalizeSpeakerNames(source, translated, cast);
    expect(canonicalNames.get('미숙')).toBe('Mi-sook');
    expect(normalizedCount).toBe(3);
    expect(translated[0].text).toBe('[Mi-sook] What?');
    expect(translated[1].text).toBe('[Mi-sook] Let\'s go');
    expect(translated[2].text).toBe('[Mi-sook] Wait');
  });

  it('handles Japanese full-width parentheses', () => {
    const source = [
      { text: '（田中）おい！' },
      { text: '（田中）やめろ！' },
    ];
    const translated = [
      { text: '(Tanaka) Hey!', begin: 0, end: 1000 },
      { text: '(Kenji) Stop!', begin: 1000, end: 2000 },
    ];

    const { normalizedCount } = normalizeSpeakerNames(source, translated);
    expect(normalizedCount).toBe(1);
    expect(translated[0].text).toBe('(Tanaka) Hey!');
    expect(translated[1].text).toBe('(Tanaka) Stop!');
  });

  it('returns zero when all labels are already consistent', () => {
    const source = [
      { text: '[승효] 안녕' },
      { text: '[승효] 뭐해?' },
    ];
    const translated = [
      { text: '[Seung-hyo] Hi', begin: 0, end: 1000 },
      { text: '[Seung-hyo] What?', begin: 1000, end: 2000 },
    ];

    const { normalizedCount } = normalizeSpeakerNames(source, translated);
    expect(normalizedCount).toBe(0);
  });

  it('returns zero when no speaker labels present', () => {
    const source = [{ text: 'Just dialogue' }];
    const translated = [{ text: 'Just dialogue', begin: 0, end: 1000 }];

    const { normalizedCount } = normalizeSpeakerNames(source, translated);
    expect(normalizedCount).toBe(0);
  });

  it('skips lines where translated text has no speaker label', () => {
    const source = [
      { text: '[석류] 안녕' },
      { text: '[석류] 뭐해?' },
    ];
    const translated = [
      { text: '[Seok-ryu] Hello', begin: 0, end: 1000 },
      { text: 'What are you doing?', begin: 1000, end: 2000 },
    ];

    const { normalizedCount } = normalizeSpeakerNames(source, translated);
    expect(normalizedCount).toBe(0);
  });

  it('handles multiple different source labels independently', () => {
    const source = [
      { text: '[석류] 안녕' },
      { text: '[승효] 네' },
      { text: '[석류] 뭐해?' },
      { text: '[승효] 가자' },
      { text: '[석류] 잠깐' },
      { text: '[승효] 어디?' },
    ];
    const translated = [
      { text: '[Seok-ryu] Hello', begin: 0, end: 1000 },
      { text: '[Seung-hyo] Yes', begin: 1000, end: 2000 },
      { text: '[Seokryu] What?', begin: 2000, end: 3000 },
      { text: '[Seung-hyo] Let\'s go', begin: 3000, end: 4000 },
      { text: '[Seok-ryu] Wait', begin: 4000, end: 5000 },
      { text: '[Seonghyo] Where?', begin: 5000, end: 6000 },
    ];

    const { normalizedCount, canonicalNames } = normalizeSpeakerNames(source, translated);
    expect(canonicalNames.get('석류')).toBe('Seok-ryu');
    expect(canonicalNames.get('승효')).toBe('Seung-hyo');
    expect(normalizedCount).toBe(2);
    expect(translated[2].text).toBe('[Seok-ryu] What?');
    expect(translated[5].text).toBe('[Seung-hyo] Where?');
  });

  it('uses cast to validate variant, keeps LLM name (Sato matches Satō Takeshi)', () => {
    const source = [
      { text: '（佐藤）やめろ' },
      { text: '（佐藤）おい' },
    ];
    const translated = [
      { text: '(Sato) Stop', begin: 0, end: 1000 },
      { text: '(Sato) Hey', begin: 1000, end: 2000 },
    ];
    const cast = [{ character: 'Satō Takeshi' }];

    // "Sato" matches "Satō Takeshi" — cast validates variant, canonical stays "Sato"
    const { canonicalNames } = normalizeSpeakerNames(source, translated, cast);
    expect(canonicalNames.get('佐藤')).toBe('Sato');
  });

  it('uses cast to validate variant, keeps highest-frequency name', () => {
    const source = [
      { text: '（田中）行くぞ' },
      { text: '（田中）おい' },
      { text: '（田中）やれ' },
    ];
    const translated = [
      { text: '(Tanaka) Let\'s go', begin: 0, end: 1000 },
      { text: '(Kenji) Hey', begin: 1000, end: 2000 },
      { text: '(Tanaka) Do it', begin: 2000, end: 3000 },
    ];
    const cast = [{ character: 'Kenji Tanaka' }];

    // "Tanaka" (2×) matches "Kenji Tanaka" — canonical is "Tanaka" (the variant), not the full cast name
    const { canonicalNames } = normalizeSpeakerNames(source, translated, cast);
    expect(canonicalNames.get('田中')).toBe('Tanaka');
    expect(translated[0].text).toBe('(Tanaka) Let\'s go');
    expect(translated[1].text).toBe('(Tanaka) Hey');
  });

  it('uses plausibility scoring to prefer real names over short/wrong labels', () => {
    // 모음 tie: "Vowels" (2×) vs "Oo" (2×) vs "Mo-eum" (1×)
    // Without scoring: "Vowels" or "Oo" would win by count
    // With scoring: "Mo-eum" wins (hyphenated +2, proper length +1 = 4 total vs Vowels=3, Oo=-1)
    const source = [
      { text: '[모음] line1' },
      { text: '[모음] line2' },
      { text: '[모음] line3' },
      { text: '[모음] line4' },
      { text: '[모음] line5' },
    ];
    const translated = [
      { text: '[Vowels] line1', begin: 0, end: 1000 },
      { text: '[Vowels] line2', begin: 1000, end: 2000 },
      { text: '[Oo] line3', begin: 2000, end: 3000 },
      { text: '[Oo] line4', begin: 3000, end: 4000 },
      { text: '[Mo-eum] line5', begin: 4000, end: 5000 },
    ];

    const { canonicalNames } = normalizeSpeakerNames(source, translated);
    expect(canonicalNames.get('모음')).toBe('Mo-eum');
  });

  // ── Fixture-based tests: auto-discover from tests/fixtures/normalization/ ──
  const fixtureFiles = readdirSync(fixturesDir).filter(f => f.endsWith('.json'));
  for (const file of fixtureFiles) {
    it(`fixture: ${file}`, () => {
      const fixture = JSON.parse(readFileSync(join(fixturesDir, file), 'utf-8'));
      const source = fixture.source;
      const translated = fixture.translated.map(c => ({ ...c })); // copy to avoid cross-test mutation
      const cast = (fixture.cast || []).map(c =>
        typeof c === 'string' ? { character: c } : c
      );

      const { normalizedCount, canonicalNames } = normalizeSpeakerNames(source, translated, cast);

      // Check canonical names
      if (fixture.expected.canonicalNames) {
        for (const [sourceLabel, expectedName] of Object.entries(fixture.expected.canonicalNames)) {
          expect(canonicalNames.get(sourceLabel), `canonical name for ${sourceLabel}`).toBe(expectedName);
        }
      }

      // Check normalized count
      if (fixture.expected.normalizedCount !== undefined) {
        expect(normalizedCount).toBe(fixture.expected.normalizedCount);
      }

      // Spot-check specific indices against regex patterns
      if (fixture.expected.spotChecks) {
        for (const { index, pattern } of fixture.expected.spotChecks) {
          expect(translated[index].text, `spot-check index ${index}`).toMatch(new RegExp(pattern));
        }
      }

      // Verify unchanged indices
      if (fixture.expected.unchangedIndices) {
        for (const index of fixture.expected.unchangedIndices) {
          expect(translated[index].text, `unchanged index ${index}`).toBe(fixture.translated[index].text);
        }
      }
    });
  }
});
