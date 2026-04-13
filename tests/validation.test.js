import { describe, it, expect } from 'vitest';
import { validateTranslation as _validateTranslation, LANG_SIGNATURES, hasRubyArtifact, VALIDATION_RULES } from '../src/core/validation.js';
import { makeCues } from './helpers/fixtures.js';

const TARGET_LANG = 'Spanish';
const validateTranslation = (cues, results) => _validateTranslation(cues, results, TARGET_LANG);

describe('validateTranslation', () => {
  it('returns no gaps for a clean translation', () => {
    const cues = makeCues('Hello', 'World');
    const results = ['Hola', 'Mundo'];
    const { gaps } = validateTranslation(cues, results);
    expect(gaps).toEqual([]);
  });

  it('detects missing translations', () => {
    const cues = makeCues('Hello', 'World');
    const results = ['Hola', undefined];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(1);
    expect(reasons[1]).toBe('missing');
  });

  it('detects untranslated lines (identical to original)', () => {
    const cues = makeCues('Hello there');
    const results = ['Hello there'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('untranslated');
  });

  it('detects malformed "—" at start or end', () => {
    const cues = makeCues('Hello');
    const results = ['—Hola'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('malformed —');
  });

  it('allows "—" in translation regardless of original', () => {
    const cues = makeCues('Hello there my friend');
    const results = ['Hola—amigo'];
    const { gaps } = validateTranslation(cues, results);
    expect(gaps).toEqual([]);
  });

  it('detects em dash dropped when original has "—" but translation does not', () => {
    const cues = makeCues('行くぞ—待って！');
    const results = ["Let's go!"];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('em dash dropped');
  });

  it('does not flag em dash dropped when neither has "—"', () => {
    const cues = makeCues('行くぞ');
    const results = ["Let's go!"];
    const { gaps } = validateTranslation(cues, results);
    expect(gaps).toEqual([]);
  });

  it('detects annotation mismatch (bracket in original, not in translation)', () => {
    const cues = makeCues('[laughing]');
    const results = ['riendo'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('annotation mismatch');
  });

  it('detects annotation mismatch (music marker)', () => {
    const cues = makeCues('♪ la la la ♪');
    const results = ['la la la'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('annotation mismatch');
  });

  it('detects question mark mismatch', () => {
    const cues = makeCues('How are you doing?');
    const results = ['Como estas haciendo.'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('? mismatch');
  });

  it('detects exclamation mark mismatch', () => {
    const cues = makeCues('Watch out for danger!');
    const results = ['Cuidado con el peligro.'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('! mismatch');
  });

  it('detects truncated translations', () => {
    const original = 'This is a fairly long subtitle line that should have a decent translation';
    const cues = makeCues(original);
    const results = ['Es'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('truncated');
  });

  it('detects truncated dual-speaker line with trailing em dash', () => {
    const original = '行くぞ—待って！';
    const cues = makeCues(original);
    const results = ["Let's go—"];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    // Caught by malformed em dash rule first (higher priority), which already triggers retry
    expect(reasons[0]).toBe('malformed —');
  });

  it('detects shifted translations (matches neighbor original)', () => {
    const cues = makeCues('Hello friend', 'World peace', 'Goodbye now');
    const results = ['Hola amigo', 'Hello friend', 'Adiós']; // results[1] == cues[0].text
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(1);
    expect(reasons[1]).toBe('shifted');
  });

  it('detects wrong language (English output when target is Spanish)', () => {
    const cues = makeCues('Algo completamente diferente');
    const results = ['This is something that would have been very interesting because the world has changed'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toMatch(/wrong lang/);
  });

  it('returns multiple gaps in one chunk', () => {
    const cues = makeCues('Hello', 'World', 'Goodbye');
    const results = [undefined, 'World', '/Adiós'];
    const { gaps } = validateTranslation(cues, results);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
  });

  it('detects source text leak (partial original text in translation)', () => {
    const original = 'The quick brown fox jumps over the lazy dog and runs away';
    const cues = makeCues(original);
    // Translation contains a 30+ char chunk of the original
    const results = ['La traducción The quick brown fox jumps over the lazy dog algo más'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('source leak');
  });

  it('detects source prepend/append', () => {
    const original = 'Something quite long enough to trigger';
    const cues = makeCues(original);
    // Translation starts with the first part of the original
    const results = ['Something qui traducción completa'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('source prepend/append');
  });

  it('detects mixed script (CJK chars leaked into Latin translation)', () => {
    // Original is primarily CJK, translation should be Latin but has CJK leaked in
    const cues = makeCues('这是一个很长的中文句子需要翻译');
    // Translation has significant CJK characters mixed with Latin
    const results = ['This 是一个 translation 很长 with 中文 characters 句子'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('mixed script');
  });

  it('detects mixed script (Cyrillic leaked into Latin translation)', () => {
    const cues = makeCues('Это длинное русское предложение для тестирования');
    const results = ['This длинное translation русское with Cyrillic предложение leak'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('mixed script');
  });

  it('detects wrong language via script (Japanese chars when target is Spanish)', () => {
    const cues = makeCues('Algo completamente diferente aquí');
    // Use text with spaces to pass the words.length >= 3 guard
    const results = ['これは テスト です 翻訳 された テキスト'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toMatch(/wrong lang.*Japanese/);
  });

  it('detects wrong language via script (Korean chars when target is Spanish)', () => {
    const cues = makeCues('Algo diferente y nuevo');
    const results = ['이것은 한국어 텍스트입니다 번역'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toMatch(/wrong lang.*Korean/);
  });

  it('detects wrong language via script (Chinese chars when target is Spanish)', () => {
    const cues = makeCues('Algo diferente y nuevo aquí');
    const results = ['这是 一个 中文 翻译 测试'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toMatch(/wrong lang.*Chinese/);
  });

  it('detects wrong language via markers (French when target is Spanish)', () => {
    const cues = makeCues('Algo completamente diferente aquí');
    const results = ['C\'est une traduction dans la mauvaise langue pour cette phrase très longue'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toMatch(/wrong lang.*French/);
  });

  it('allows annotation bracket types to match (CJK brackets)', () => {
    const cues = makeCues('（笑い声）');
    const results = ['（risas）'];
    const { gaps } = validateTranslation(cues, results);
    expect(gaps).toEqual([]);
  });

  it('detects annotation mismatch: non-annotation translated as annotation', () => {
    const cues = makeCues('Hello there my friend');
    const results = ['[risas y aplausos]'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('annotation mismatch');
  });

  it('detects speaker label lost when （name） format dropped', () => {
    const cues = makeCues('（生徒）うわ ホントだ');
    const results = ['The students Wow really'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('speaker label lost');
  });

  it('allows speaker label preserved with ASCII parentheses', () => {
    const cues = makeCues('（花子）行くよ…');
    const results = ['(Hanako) Let\'s go...'];
    const { gaps } = validateTranslation(cues, results);
    expect(gaps).toEqual([]);
  });

  it('detects ruby text artifact from furigana leak', () => {
    const cues = makeCues('（夏目なつめ）だから言ってんだろ');
    const results = ['(Na-tsu-me Na-tsue) So I told you'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('ruby artifact');
  });

  it('allows normal hyphenated words (non-ruby)', () => {
    const cues = makeCues('大切な再会');
    const results = ['A long-awaited reunion'];
    const { gaps } = validateTranslation(cues, results);
    expect(gaps).toEqual([]);
  });

  it('does not falsely flag English "I" as Italian when target is English', () => {
    const cues = makeCues('授業中だった気がするんだけど…');
    const results = ['I think I was in class at the time...'];
    const { gaps } = _validateTranslation(cues, results, 'English');
    expect(gaps).toEqual([]);
  });

  it('does not falsely flag "Ha ha" laughter as Italian when target is English', () => {
    const cues = makeCues('はぁ はぁ はぁ…');
    const results = ['Ha ha ha ha...'];
    const { gaps } = _validateTranslation(cues, results, 'English');
    expect(gaps).toEqual([]);
  });

  it('does not falsely flag "as" as Portuguese when target is English', () => {
    const cues = makeCues('油断さえしなければヤツはワナにかかった哀れな獲物');
    const results = ['As long as I do not get careless he will be a sorry victim caught in my trap'];
    const { gaps } = _validateTranslation(cues, results, 'English');
    expect(gaps).toEqual([]);
  });

  it('allows adding ? in translation when source is CJK (questions without ?)', () => {
    const cues = makeCues('なるほどな "赤鱗躍動"か');
    const results = ['I see, "Sekirin Yakudo"?'];
    const { gaps } = _validateTranslation(cues, results, 'English', 'Japanese');
    expect(gaps).toEqual([]);
  });

  it('still flags dropping ? for CJK source', () => {
    const cues = makeCues('本当に大丈夫ですか？');
    const results = ['Are you really okay.'];
    const { gaps, reasons } = _validateTranslation(cues, results, 'English', 'Japanese');
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('? mismatch');
  });

  it('still flags adding ? for non-CJK source', () => {
    const cues = makeCues('Esto es muy importante');
    const results = ['This is very important?'];
    const { gaps, reasons } = _validateTranslation(cues, results, 'English', 'Spanish');
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('? mismatch');
  });

  it('handles dash without space before fullwidth paren in annotation check', () => {
    const cues = makeCues('-（田中）用意がいいな—-（鈴木）内緒やで');
    const results = ['(Tanaka) Well prepared—(Suzuki) It\'s a secret'];
    const { gaps } = _validateTranslation(cues, results, 'English', 'Japanese');
    expect(gaps).toEqual([]);
  });

  it('does not flag Korean dash-bracket format as annotation mismatch', () => {
    const cues = makeCues('- [인숙] 그래? 오—- [여자2] 어');
    const results = ['[In-Suk] Really? Oh—- [Woman2] Yeah'];
    const { gaps } = validateTranslation(cues, results);
    expect(gaps).toEqual([]);
  });

  it('still flags genuine annotation mismatch after dash stripping', () => {
    const cues = makeCues('- Hello there friend');
    const results = ['[risas]'];
    const { gaps, reasons } = validateTranslation(cues, results);
    expect(gaps).toContain(0);
    expect(reasons[0]).toBe('annotation mismatch');
  });

  it('still detects genuine wrong language even with target scoring', () => {
    const cues = makeCues('Something completely different here now');
    // Portuguese text with many distinctive markers
    const results = ['Isso não está correto porque você também pode desde sempre aqui'];
    const { gaps, reasons } = _validateTranslation(cues, results, 'English');
    expect(gaps).toContain(0);
    expect(reasons[0]).toMatch(/wrong lang/);
  });
});

describe('LANG_SIGNATURES', () => {
  it('has signatures for major languages', () => {
    const names = LANG_SIGNATURES.map(s => s.name);
    expect(names).toContain('English');
    expect(names).toContain('Spanish');
    expect(names).toContain('Japanese');
    expect(names).toContain('Korean');
    expect(names).toContain('Chinese');
  });

  it('English markers match common English words', () => {
    const en = LANG_SIGNATURES.find(s => s.name === 'English');
    expect(en.markers.test('the')).toBe(true);
    expect(en.markers.test('would')).toBe(true);
  });
});

describe('VALIDATION_RULES', () => {
  it('has 15 rules in the expected order', () => {
    expect(VALIDATION_RULES).toHaveLength(15);
    const names = VALIDATION_RULES.map(r => r.name);
    expect(names).toEqual([
      'checkMissing',
      'checkUntranslated',
      'checkMalformedEmDash',
      'checkEmDashDropped',
      'checkSpeakerLabelLost',
      'checkAnnotationMismatch',
      'checkQuestionMarkMismatch',
      'checkExclamationMismatch',
      'checkSourceLeak',
      'checkSourcePrependAppend',
      'checkShifted',
      'checkTruncated',
      'checkRubyArtifact',
      'checkMixedScript',
      'checkWrongLanguage',
    ]);
  });

  it('every rule is a named function', () => {
    for (const rule of VALIDATION_RULES) {
      expect(typeof rule).toBe('function');
      expect(rule.name).toBeTruthy();
    }
  });
});

describe('hasRubyArtifact', () => {
  it('detects hyphenated romanization with 3+ segments', () => {
    expect(hasRubyArtifact('(Na-tsu-me) So I told you')).toBe(true);
  });

  it('detects 4-segment pattern', () => {
    expect(hasRubyArtifact('(shi-no-ha-ra) This dress')).toBe(true);
  });

  it('allows normal hyphenated words', () => {
    expect(hasRubyArtifact('A long-awaited reunion')).toBe(false);
  });

  it('allows single-hyphen names', () => {
    expect(hasRubyArtifact('(Spider-Man) Hello')).toBe(false);
  });

  it('does not flag common English compound adjectives', () => {
    // "year", "date", "face" etc. are 4 chars — above the 3-char segment cap
    expect(hasRubyArtifact('Every year at the end-of-year party')).toBe(false);
    expect(hasRubyArtifact('An out-of-date approach')).toBe(false);
    expect(hasRubyArtifact('A face-to-face meeting')).toBe(false);
  });

  it('allows empty string', () => {
    expect(hasRubyArtifact('')).toBe(false);
  });
});
