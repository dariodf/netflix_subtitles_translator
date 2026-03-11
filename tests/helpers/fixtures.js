/**
 * Shared test data factories and constants.
 * Reduces duplication across test files.
 */

/** Create cues from text strings (spread args). begin: 0, end: 1000 for all. */
export const makeCues = (...texts) =>
  texts.map(text => ({ text, begin: 0, end: 1000 }));

/** Create cues with sequential timing (5s intervals, matching analyzeTranslation's makeOutput). */
export const makeCuesWithTiming = (...texts) =>
  texts.map((text, i) => ({ text, begin: i * 5000, end: (i + 1) * 5000 }));

/** Wrap cue pairs into the shape expected by analyzeTranslation. */
export const makeAnalysisOutput = (cues, episode = 'test') => ({
  episode,
  cues,
  originalCues: cues.map((c, i) => ({
    index: i,
    begin: i * 5000,
    end: (i + 1) * 5000,
    text: c.original,
  })),
});

/** Common test character data (generic names from copyright cleanup). */
export const CHARACTERS = {
  hanako: { source: '花子', translated: 'Hanako' },
  tanaka: { source: '田中', translated: 'Tanaka' },
  suzuki: { source: '鈴木', translated: 'Suzuki' },
  sato: { source: '佐藤', translated: 'Satō' },
  natsume: { source: '夏目', translated: 'Natsume' },
  insook: { source: '인숙', translated: 'Insook' },
};
