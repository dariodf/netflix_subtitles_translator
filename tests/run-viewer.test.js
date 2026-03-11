import { describe, it, expect } from 'vitest';
import { buildLineData, generateRunViewerHtml } from '../src/headless/run-viewer.js';

const makeTranslatedOutput = (cues) => ({
  config: { provider: 'ollama', model: 'qwen2.5:3b', targetLang: 'English', sourceLang: 'Japanese' },
  stats: { totalCues: cues.length, flaggedLines: cues.filter(c => c.flagged).map(c => c.index), flaggedCount: cues.filter(c => c.flagged).length, elapsedSeconds: 8.3 },
  cues,
});

const sampleCues = [
  { index: 0, original: '（生徒たちの話し声）', translated: '(Students chattering)', flagged: true, flagReason: 'untranslated' },
  { index: 1, original: 'だから言ってんだろ', translated: "That's what I said", flagged: false, flagReason: null },
  { index: 2, original: 'ボウリング行こうぜ', translated: "Let's go bowling", flagged: false, flagReason: null },
];

const sampleAnalysis = {
  issues: [
    { index: 0, category: 'untranslatedCharacters', detail: 'source script characters in translation' },
    { index: 0, category: 'speakerLabelLost', detail: 'speaker label format not preserved' },
    { index: 2, category: 'tooShort', detail: 'translation too short' },
  ],
  summary: { totalCues: 3, issueCount: 3, categories: { untranslatedCharacters: 1, speakerLabelLost: 1, tooShort: 1 } },
};

const sampleSimilarity = {
  semantic: {
    averageSimilarity: 0.85,
    model: 'nomic-embed-text',
    pairs: [
      { index: 0, similarity: 0.72 },
      { index: 1, similarity: 0.91 },
      { index: 2, similarity: 0.88 },
    ],
  },
  crossLingual: {
    averageSimilarity: 0.78,
    model: 'snowflake-arctic-embed2',
    pairs: [
      { index: 0, similarity: 0.65 },
      { index: 1, similarity: 0.82 },
      { index: 2, similarity: 0.80 },
    ],
  },
};

const sampleSimilarityWithReference = {
  ...sampleSimilarity,
  referenceAligned: {
    averageSimilarity: 0.75,
    model: 'nomic-embed-text',
    referenceCues: [
      { index: 0, begin: 0, end: 2000, text: '(students chattering)' },
      { index: 1, begin: 2000, end: 4000, text: "That's what I've been saying" },
      { index: 2, begin: 4000, end: 5500, text: "Let's go" },
      { index: 3, begin: 5500, end: 7000, text: 'bowling!' },
    ],
    pairs: [
      { index: 0, referenceIndices: [0], similarity: 0.90 },
      { index: 1, referenceIndices: [1], similarity: 0.85 },
      { index: 2, referenceIndices: [2, 3], similarity: 0.70 },
    ],
  },
};

describe('buildLineData', () => {
  it('merges translated cues with analysis and similarity', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, sampleAnalysis, sampleSimilarity);

    expect(lines.length).toBe(3);
    expect(lines[0].original).toBe('（生徒たちの話し声）');
    expect(lines[0].translated).toBe('(Students chattering)');
    expect(lines[0].flagged).toBe(true);
    expect(lines[0].flagReason).toBe('untranslated');
    expect(lines[0].issues.length).toBe(2);
    expect(lines[0].issues[0].category).toBe('untranslatedCharacters');
    expect(lines[0].scores.semantic).toBeCloseTo(72, 0);
    expect(lines[0].scores.crossLingual).toBeCloseTo(65, 0);
  });

  it('handles missing analysis data', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, null, sampleSimilarity);

    expect(lines.length).toBe(3);
    expect(lines[0].issues).toEqual([]);
    expect(lines[0].scores.semantic).toBeCloseTo(72, 0);
  });

  it('handles missing similarity data', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, sampleAnalysis, null);

    expect(lines.length).toBe(3);
    expect(lines[0].scores).toEqual({});
    expect(lines[0].issues.length).toBe(2);
  });

  it('handles all data missing (only translated)', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, null, null);

    expect(lines.length).toBe(3);
    expect(lines[1].flagged).toBe(false);
    expect(lines[1].issues).toEqual([]);
    expect(lines[1].scores).toEqual({});
  });

  it('groups multiple issues per line', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, sampleAnalysis, null);

    // Line 0 has two issues
    expect(lines[0].issues.length).toBe(2);
    expect(lines[0].issues.map(i => i.category)).toEqual(['untranslatedCharacters', 'speakerLabelLost']);
    // Line 2 has one issue
    expect(lines[2].issues.length).toBe(1);
    expect(lines[2].issues[0].category).toBe('tooShort');
    // Line 1 has no issues
    expect(lines[1].issues).toEqual([]);
  });

  it('handles empty cues array', () => {
    const translated = makeTranslatedOutput([]);
    const lines = buildLineData(translated, null, null);
    expect(lines).toEqual([]);
  });

  it('converts similarity from 0-1 to 0-100 percentage', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, null, sampleSimilarity);

    // 0.72 → 72.00, 0.91 → 91.00
    expect(lines[0].scores.semantic).toBe(72);
    expect(lines[1].scores.semantic).toBe(91);
    expect(lines[0].scores.crossLingual).toBe(65);
  });

  it('includes referenceAligned scores and referenceIndices', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, null, sampleSimilarityWithReference);

    expect(lines[0].scores.referenceAligned).toBe(90);
    expect(lines[0].referenceIndices).toEqual([0]);
    expect(lines[2].scores.referenceAligned).toBe(70);
    expect(lines[2].referenceIndices).toEqual([2, 3]);
  });

  it('sets empty referenceIndices when no referenceAligned data', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, null, sampleSimilarity);

    expect(lines[0].referenceIndices).toEqual([]);
    expect(lines[1].referenceIndices).toEqual([]);
  });
});

describe('generateRunViewerHtml', () => {
  const metadata = {
    episode: 'smoke-test',
    config: { provider: 'ollama', model: 'qwen2.5:3b', targetLang: 'English', sourceLang: 'Japanese' },
    stats: { totalCues: 3, elapsedSeconds: 8.3 },
  };

  it('returns a valid HTML document', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, sampleAnalysis, sampleSimilarity);
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: ['semantic', 'crossLingual'] });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('chart.js');
  });

  it('includes episode name in title', () => {
    const lines = buildLineData(makeTranslatedOutput(sampleCues), null, null);
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: [] });
    expect(html).toContain('Run Viewer: smoke-test');
  });

  it('includes model and language info', () => {
    const lines = buildLineData(makeTranslatedOutput(sampleCues), null, null);
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: [] });
    expect(html).toContain('qwen2.5:3b');
    expect(html).toContain('Japanese');
    expect(html).toContain('English');
  });

  it('embeds line data as JSON', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, null, sampleSimilarity);
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: ['semantic'] });

    expect(html).toContain('"original":"（生徒たちの話し声）"');
    expect(html).toContain('"flagged":true');
  });

  it('includes chart canvas when scores exist', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, null, sampleSimilarity);
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: ['semantic'] });

    expect(html).toContain('id="score-chart"');
    expect(html).toContain('new Chart');
  });

  it('shows no-chart message when no scores', () => {
    const lines = buildLineData(makeTranslatedOutput(sampleCues), null, null);
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: [] });

    expect(html).not.toContain('id="score-chart"');
    expect(html).toContain('No per-line scores available');
  });

  it('renders flagged and issue badges', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, sampleAnalysis, null);
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: [] });

    expect(html).toContain('badge-flag');
    expect(html).toContain('untranslated');
    expect(html).toContain('badge-issue');
    expect(html).toContain('untranslatedCharacters');
  });

  it('renders line rows with IDs for scroll targeting', () => {
    const lines = buildLineData(makeTranslatedOutput(sampleCues), null, null);
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: [] });

    expect(html).toContain('id="line-0"');
    expect(html).toContain('id="line-1"');
    expect(html).toContain('id="line-2"');
  });

  it('includes click-to-scroll handler when scores exist', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, null, sampleSimilarity);
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: ['semantic'] });

    expect(html).toContain('scrollIntoView');
    expect(html).toContain('onClick');
  });

  it('includes stats summary with clickable filter attributes', () => {
    const lines = buildLineData(makeTranslatedOutput(sampleCues), null, null);
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: [] });

    expect(html).toContain('3 total lines');
    expect(html).toContain('1 flagged');
    expect(html).toContain('2 clean');
    expect(html).toContain('data-filter="clean"');
    expect(html).toContain('data-filter="flagged"');
    expect(html).toContain('data-filter="all"');
  });

  it('escapes HTML in text content', () => {
    const cues = [{ index: 0, original: '<script>alert("xss")</script>', translated: 'safe & clean', flagged: false, flagReason: null }];
    const translated = makeTranslatedOutput(cues);
    const lines = buildLineData(translated, null, null);
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: [] });

    // HTML-escaped in DOM elements
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('safe &amp; clean');
    // JSON data inside <script> must not contain </script> (would close the block)
    expect(html).not.toContain('</script>","translated"');
  });

  it('handles empty lines', () => {
    const lines = buildLineData(makeTranslatedOutput([]), null, null);
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: [] });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('0 total lines');
  });

  it('renders reference panel when referenceData is provided', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, null, sampleSimilarityWithReference);
    const referenceData = {
      cues: sampleSimilarityWithReference.referenceAligned.referenceCues,

    };
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: ['referenceAligned'], referenceData });

    expect(html).toContain('id="reference-panel"');
    expect(html).toContain('Official Translation');
    expect(html).toContain('id="ref-0"');
    expect(html).toContain('id="ref-3"');
    expect(html).toContain('(students chattering)');
    expect(html).toContain('bowling!');
  });

  it('does not render reference panel when referenceData is null', () => {
    const lines = buildLineData(makeTranslatedOutput(sampleCues), null, null);
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: [] });

    expect(html).not.toContain('id="reference-panel"');
    expect(html).not.toContain('Official Translation');
  });

  it('includes reference scroll sync JavaScript', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, null, sampleSimilarityWithReference);
    const referenceData = {
      cues: sampleSimilarityWithReference.referenceAligned.referenceCues,

    };
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: ['referenceAligned'], referenceData });

    expect(html).toContain('refToSourceMap');
    expect(html).toContain('highlightSourceLine');
    expect(html).toContain('data-ref-index');
  });

  it('includes referenceAligned score badge', () => {
    const translated = makeTranslatedOutput(sampleCues);
    const lines = buildLineData(translated, null, sampleSimilarityWithReference);
    const html = generateRunViewerHtml({ lines, metadata, scoreTypes: ['referenceAligned'] });

    expect(html).toContain('vs Official');
  });
});
