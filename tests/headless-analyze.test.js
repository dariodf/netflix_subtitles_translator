import { describe, it, expect } from 'vitest';
import {
  findUntranslatedCharacters,
  buildNameMap,
  alignCuesByTime,
  analyzeTranslation,
} from '../src/headless/analyze.js';
import { makeAnalysisOutput } from './helpers/fixtures.js';

describe('findUntranslatedCharacters', () => {
  it('finds CJK characters in otherwise English translation', () => {
    expect(findUntranslatedCharacters('（花子）苦いし', '(Hana子) It hurts')).toBe('子');
  });

  it('returns null when translation is clean', () => {
    expect(findUntranslatedCharacters('蜘蛛…', 'Spider...')).toBe(null);
  });

  it('returns null when original has no CJK', () => {
    expect(findUntranslatedCharacters('Hello', 'Hola')).toBe(null);
  });

  it('finds Korean hangul characters leaking into translation', () => {
    expect(findUntranslatedCharacters('[인숙]네가 그렇게', '[Insook] 네가 like that')).toBe('네가');
  });
});

describe('buildNameMap', () => {
  it('groups translations by source speaker name', () => {
    const cues = [
      { index: 0, original: '（花子）行くよ…', translated: '(Hanako) Let\'s go...' },
      { index: 1, original: '（花子）え？', translated: '(Hanako) Huh?' },
      { index: 2, original: '（花子）うむ', translated: '(Hana-ko) Hmm' },
    ];
    const map = buildNameMap(cues);
    expect(map['花子'].count).toBe(3);
    expect(map['花子'].majority).toBe('Hanako');
    expect(map['花子'].variants['Hanako']).toEqual([0, 1]);
    expect(map['花子'].variants['Hana-ko']).toEqual([2]);
  });

  it('ignores cues without speaker labels', () => {
    const cues = [
      { index: 0, original: '自由だー！', translated: 'Freedom!' },
    ];
    const map = buildNameMap(cues);
    expect(Object.keys(map)).toEqual([]);
  });

  it('ignores cues where translation drops speaker label', () => {
    const cues = [
      { index: 0, original: '（生徒）うわ', translated: 'The students Wow' },
    ];
    const map = buildNameMap(cues);
    expect(Object.keys(map)).toEqual([]);
  });

  it('groups Korean square bracket names', () => {
    const cues = [
      { index: 0, original: '[인숙]네가 그렇게', translated: '(Insook) If you act' },
      { index: 1, original: '[인숙]알겠어', translated: '(Insook) Got it' },
      { index: 2, original: '[인숙]뭐라고', translated: '(In-suk) What?' },
    ];
    const map = buildNameMap(cues);
    expect(map['인숙'].count).toBe(3);
    expect(map['인숙'].majority).toBe('Insook');
    expect(map['인숙'].variants['Insook']).toEqual([0, 1]);
    expect(map['인숙'].variants['In-suk']).toEqual([2]);
  });
});

describe('alignCuesByTime', () => {
  it('aligns cues with overlapping time ranges', () => {
    const source = [
      { begin: 0, end: 5000, text: 'Hello' },
      { begin: 5000, end: 10000, text: 'World' },
    ];
    const reference = [
      { begin: 0, end: 4500, text: 'Hola' },
      { begin: 5500, end: 9500, text: 'Mundo' },
    ];
    const pairs = alignCuesByTime(source, reference);
    expect(pairs.length).toBe(2);
    expect(pairs[0].sourceIndex).toBe(0);
    expect(pairs[0].referenceIndex).toBe(0);
    expect(pairs[1].sourceIndex).toBe(1);
    expect(pairs[1].referenceIndex).toBe(1);
  });

  it('skips cues with no overlap', () => {
    const source = [
      { begin: 0, end: 1000, text: 'A' },
      { begin: 50000, end: 55000, text: 'B' },
    ];
    const reference = [
      { begin: 20000, end: 25000, text: 'X' },
    ];
    const pairs = alignCuesByTime(source, reference);
    expect(pairs.length).toBe(0);
  });

  it('handles many-to-one alignment', () => {
    const source = [
      { begin: 0, end: 3000, text: 'Part 1' },
      { begin: 3000, end: 6000, text: 'Part 2' },
    ];
    const reference = [
      { begin: 0, end: 6000, text: 'Combined' },
    ];
    const pairs = alignCuesByTime(source, reference);
    expect(pairs.length).toBe(2);
    expect(pairs[0].referenceIndex).toBe(0);
    expect(pairs[1].referenceIndex).toBe(0);
  });

  it('requires at least 30% overlap ratio', () => {
    const source = [
      { begin: 0, end: 10000, text: 'Long cue' },
    ];
    const reference = [
      { begin: 9000, end: 15000, text: 'Barely overlapping' }, // 1000/10000 = 10% overlap
    ];
    const pairs = alignCuesByTime(source, reference);
    expect(pairs.length).toBe(0);
  });
});

describe('analyzeTranslation', () => {

  it('detects speaker label lost issues', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '（生徒）うわ ホントだ', translated: 'The students Wow really' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'speakerLabelLost')).toBe(true);
  });

  it('detects Korean speaker label lost issues', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '[인숙]네가 그렇게 나오면', translated: 'If you act like that' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'speakerLabelLost')).toBe(true);
  });

  it('does not flag Korean speaker label when preserved', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '[인숙]네가 그렇게', translated: '(Insook) If you act like that' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'speakerLabelLost')).toBe(false);
  });

  it('does not flag Korean speaker label preserved as brackets', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '[인숙]네가 그렇게', translated: '[Insook] If you act like that' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'speakerLabelLost')).toBe(false);
  });

  it('does not flag sound-effect-only lines as speaker label lost', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '（笑い声）', translated: '[laughing]' },
      { index: 1, original: '（食べる音）', translated: '[eating sound]' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'speakerLabelLost')).toBe(false);
  });

  it('detects ruby artifacts', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '（夏目なつめ）text', translated: '(Na-tsu-me) text' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'rubyArtifact')).toBe(true);
  });

  it('detects name inconsistency', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '（花子）行くよ…', translated: '(Hanako) Let\'s go...' },
      { index: 1, original: '（花子）え？', translated: '(Hanako) Huh?' },
      { index: 2, original: '（花子）うむ', translated: '(Hana) Hmm' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'nameInconsistency')).toBe(true);
    expect(analysis.nameMap['花子'].majority).toBe('Hanako');
  });

  it('detects untranslated characters', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '（花子）苦い', translated: '(Hana子) Bitter' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'untranslatedCharacters')).toBe(true);
  });

  it('detects em dash count mismatch', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '（生徒）めっちゃかわいいじゃん', translated: 'The students—Cute—So cute' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'emDashCountMismatch')).toBe(true);
  });

  it('detects repetitions with different originals', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '鑑定！', translated: 'Appraisal!' },
      { index: 1, original: 'こんなの地球にはいないはず', translated: 'Appraisal!' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'repetition')).toBe(true);
  });

  it('reports clean output with no issues', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '自由だー！', translated: 'Freedom!' },
      { index: 1, original: '蜘蛛…', translated: 'Spider...' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.summary.issueCount).toBe(0);
  });

  it('includes normalization simulation showing fixable inconsistencies', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '[석류] 안녕', translated: '[Seok-ryu] Hello' },
      { index: 1, original: '[석류] 가자', translated: '[Seok-ryu] Let\'s go' },
      { index: 2, original: '[석류] 뭐해?', translated: '[Seokryu] What?' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.normalizationSimulation).toBeDefined();
    expect(analysis.normalizationSimulation.nameInconsistencyBefore).toBe(1);
    expect(analysis.normalizationSimulation.nameInconsistencyAfter).toBe(0);
    expect(analysis.normalizationSimulation.fixableLines).toBe(1);
    expect(analysis.normalizationSimulation.canonicalNames['석류']).toBe('Seok-ryu');
  });

  it('normalization simulation reports zero when already consistent', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '[석류] 안녕', translated: '[Seok-ryu] Hello' },
      { index: 1, original: '[석류] 가자', translated: '[Seok-ryu] Let\'s go' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.normalizationSimulation.fixableLines).toBe(0);
    expect(analysis.normalizationSimulation.nameInconsistencyBefore).toBe(0);
    expect(analysis.normalizationSimulation.nameInconsistencyAfter).toBe(0);
  });

  it('detects too-long translation', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '自由だー！行くぞ！！', translated: 'Freedom! Let\'s go! We are going to take on the whole world and nothing can stop us now because we are the best!' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'tooLong')).toBe(true);
  });

  it('does not flag tooLong for short originals', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: 'はい', translated: 'Yes, indeed!' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'tooLong')).toBe(false);
  });

  it('detects number mismatch', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '第3話 12月25日', translated: 'Episode 4, December 26th' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'numberMismatch')).toBe(true);
  });

  it('does not flag numberMismatch when numbers are preserved', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '第3話だよ！', translated: 'It\'s episode 3!' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'numberMismatch')).toBe(false);
  });

  it('detects line break mismatch', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '自由だー！\n行くぞ！', translated: 'Freedom! Let\'s go!' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'lineBreakMismatch')).toBe(true);
  });

  it('does not flag lineBreakMismatch for single-line cues', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '自由だー！', translated: 'Freedom!' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'lineBreakMismatch')).toBe(false);
  });

  it('detects truncated dual-speaker line with trailing em dash', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '行くぞ—待って！', translated: "Let's go—" },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'truncatedDualSpeaker')).toBe(true);
  });

  it('detects missing dual-speaker separator', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '行くぞ—待って！', translated: "Let's go!" },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'truncatedDualSpeaker')).toBe(true);
  });

  it('does not flag truncatedDualSpeaker when separator is preserved', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '行くぞ—待って！', translated: "Let's go!—Wait!" },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.issues.some(i => i.category === 'truncatedDualSpeaker')).toBe(false);
  });

  it('reports consecutive issue runs', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '（太郎）行くぞ！！', translated: 'Some wrong content' },
      { index: 1, original: '（太郎）待って！！！', translated: 'More wrong stuff here' },
      { index: 2, original: '（太郎）やめろ！！！', translated: 'Even more wrong text' },
      { index: 3, original: '自由だ', translated: 'Freedom' },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.summary.consecutiveIssueRuns).toBeGreaterThanOrEqual(1);
    expect(analysis.summary.longestConsecutiveRun).toBeGreaterThanOrEqual(3);
    expect(analysis.consecutiveRuns.length).toBeGreaterThanOrEqual(1);
  });

  it('does not report consecutive runs for scattered issues', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '（太郎）行くぞ', translated: 'Missing label' },
      { index: 1, original: '自由だ', translated: 'Freedom' },
      { index: 2, original: '（花子）待って', translated: 'No label again' },
      { index: 3, original: '元気だ', translated: "I'm fine" },
    ]);
    const analysis = analyzeTranslation(output, null, null);
    expect(analysis.summary.consecutiveIssueRuns).toBe(0);
    expect(analysis.summary.longestConsecutiveRun).toBe(0);
  });

  it('performs time-aligned evaluation when reference provided', () => {
    const output = makeAnalysisOutput([
      { index: 0, original: '蜘蛛…', translated: 'Spider...' },
      { index: 1, original: '自由！', translated: 'Freedom!' },
    ]);
    const referenceCues = [
      { begin: 0, end: 5000, text: 'Spider...' },
      { begin: 5000, end: 10000, text: 'Freedom!' },
    ];
    const analysis = analyzeTranslation(output, null, referenceCues);
    expect(analysis.timeAlignedEvaluation).not.toBe(null);
    expect(analysis.timeAlignedEvaluation.alignedPairs).toBe(2);
  });
});
