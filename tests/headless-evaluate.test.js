import { describe, it, expect, vi } from 'vitest';
import {
  levenshteinDistance,
  similarityScore,
  evaluateTranslation,
  formatEvaluationSummary,
  cosineSimilarity,
  computeEmbeddings,
  evaluateSemanticSimilarity,
  alignAllOverlapping,
  evaluateTimeAlignedSimilarity,
} from '../src/headless/evaluate.js';
import { makeCues } from './helpers/fixtures.js';

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns length of other string when one is empty', () => {
    expect(levenshteinDistance('', 'hello')).toBe(5);
    expect(levenshteinDistance('hello', '')).toBe(5);
  });

  it('returns 0 for two empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('computes correct distance for single-char difference', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('computes correct distance for insertions', () => {
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
  });

  it('computes correct distance for deletions', () => {
    expect(levenshteinDistance('cats', 'cat')).toBe(1);
  });

  it('computes correct distance for complex edits', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  it('handles completely different strings', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(3);
  });
});

describe('similarityScore', () => {
  it('returns 100 for identical strings', () => {
    expect(similarityScore('Hello World', 'Hello World')).toBe(100);
  });

  it('returns 100 for strings differing only in case', () => {
    expect(similarityScore('Hello World', 'hello world')).toBe(100);
  });

  it('returns 100 for strings differing only in whitespace', () => {
    expect(similarityScore('Hello  World', 'Hello World')).toBe(100);
  });

  it('returns 0 for completely different strings of same length', () => {
    expect(similarityScore('aaa', 'zzz')).toBe(0);
  });

  it('returns a reasonable score for similar strings', () => {
    const score = similarityScore('Hola amigo', 'Hola amigos');
    expect(score).toBeGreaterThan(80);
    expect(score).toBeLessThan(100);
  });

  it('handles empty strings', () => {
    expect(similarityScore('', '')).toBe(100);
  });

  it('handles one empty string', () => {
    expect(similarityScore('hello', '')).toBe(0);
  });

  it('handles null/undefined', () => {
    expect(similarityScore(null, null)).toBe(100);
    expect(similarityScore(undefined, 'hello')).toBe(0);
  });
});

describe('evaluateTranslation', () => {

  it('reports correct metrics for identical translations', () => {
    const translated = makeCues('Hola', 'Mundo');
    const reference = makeCues('Hola', 'Mundo');
    const original = makeCues('Hello', 'World');
    const flagged = new Set();

    const result = evaluateTranslation(translated, reference, original, flagged);

    expect(result.metrics.comparedCues).toBe(2);
    expect(result.metrics.cueCountMismatch).toBe(false);
    expect(result.lines).toHaveLength(2);
  });

  it('handles cue count mismatch by comparing up to min', () => {
    const translated = makeCues('Hola', 'Mundo', 'Extra');
    const reference = makeCues('Hola', 'Mundo');
    const original = makeCues('Hello', 'World', 'Extra');
    const flagged = new Set();

    const result = evaluateTranslation(translated, reference, original, flagged);

    expect(result.metrics.comparedCues).toBe(2);
    expect(result.metrics.cueCountMismatch).toBe(true);
    expect(result.lines).toHaveLength(2);
  });

  it('tracks flagged lines', () => {
    const translated = makeCues('Hola', 'World');
    const reference = makeCues('Hola', 'Mundo');
    const original = makeCues('Hello', 'World');
    const flagged = new Set([1]);

    const result = evaluateTranslation(translated, reference, original, flagged);

    expect(result.metrics.flaggedCount).toBe(1);
    expect(result.lines[0].flagged).toBe(false);
    expect(result.lines[1].flagged).toBe(true);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });
});

describe('computeEmbeddings', () => {
  it('calls Ollama /api/embed with correct payload', async () => {
    const mockPostJson = vi.fn().mockResolvedValue({
      status: 200,
      data: { embeddings: [[0.1, 0.2], [0.3, 0.4]] },
    });
    const result = await computeEmbeddings(['hello', 'world'], 'http://localhost:11434', 'nomic-embed-text', mockPostJson);
    expect(mockPostJson).toHaveBeenCalledWith(
      'http://localhost:11434/api/embed', {},
      { model: 'nomic-embed-text', input: ['hello', 'world'] }, 120000,
    );
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it('throws on non-200 response', async () => {
    const mockPostJson = vi.fn().mockResolvedValue({ status: 500, data: {} });
    await expect(computeEmbeddings(['hi'], 'http://localhost:11434', 'model', mockPostJson))
      .rejects.toThrow('Embedding request failed with status 500');
  });

  it('strips trailing slash from URL', async () => {
    const mockPostJson = vi.fn().mockResolvedValue({ status: 200, data: { embeddings: [[0.1]] } });
    await computeEmbeddings(['hi'], 'http://localhost:11434/', 'model', mockPostJson);
    expect(mockPostJson.mock.calls[0][0]).toBe('http://localhost:11434/api/embed');
  });
});

describe('evaluateSemanticSimilarity', () => {
  it('computes average similarity across cue pairs', async () => {
    // Two pairs: identical embeddings (similarity 1.0) and orthogonal (similarity 0.0)
    const mockPostJson = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        embeddings: [
          [1, 0], // translated[0]
          [0, 1], // translated[1]
          [1, 0], // reference[0] — same as translated[0]
          [1, 0], // reference[1] — orthogonal to translated[1]
        ],
      },
    });
    const translated = [{ text: 'Hola' }, { text: 'Mundo' }];
    const reference = [{ text: 'Hello' }, { text: 'World' }];
    const result = await evaluateSemanticSimilarity(translated, reference, 'http://localhost:11434', 'model', mockPostJson);
    expect(result.pairs).toHaveLength(2);
    expect(result.pairs[0].similarity).toBeCloseTo(1.0);
    expect(result.pairs[1].similarity).toBeCloseTo(0.0);
    expect(result.averageSimilarity).toBeCloseTo(0.5);
  });

  it('handles mismatched cue counts by comparing up to min', async () => {
    const mockPostJson = vi.fn().mockResolvedValue({
      status: 200,
      data: { embeddings: [[1, 0], [1, 0]] }, // 1 translated + 1 reference
    });
    const translated = [{ text: 'A' }];
    const reference = [{ text: 'B' }, { text: 'C' }];
    const result = await evaluateSemanticSimilarity(translated, reference, 'http://localhost:11434', 'model', mockPostJson);
    expect(result.pairs).toHaveLength(1);
  });
});

describe('formatEvaluationSummary', () => {
  it('includes episode name and key metrics', () => {
    const evaluation = {
      metrics: {
        totalCues: 10,
        referenceCues: 10,
        comparedCues: 10,
        cueCountMismatch: false,
        flaggedCount: 2,
      },
      lines: [],
    };

    const summary = formatEvaluationSummary(evaluation, 'test-episode');

    expect(summary).toContain('test-episode');
    expect(summary).toContain('2');
  });

  it('shows mismatch note when cue counts differ', () => {
    const evaluation = {
      metrics: {
        totalCues: 10,
        referenceCues: 12,
        comparedCues: 10,
        cueCountMismatch: true,
        flaggedCount: 0,
      },
      lines: [],
    };

    const summary = formatEvaluationSummary(evaluation, 'ep');
    expect(summary).toContain('mismatch');
    expect(summary).toContain('10 translated vs 12 reference');
  });
});

describe('alignAllOverlapping', () => {
  it('matches overlapping reference cues by timing', () => {
    const source = [
      { begin: 0, end: 3000, text: 'Hello' },
      { begin: 3000, end: 6000, text: 'World' },
    ];
    const reference = [
      { begin: 0, end: 2000, text: 'Hi' },
      { begin: 2000, end: 5000, text: 'there' },
      { begin: 5000, end: 7000, text: 'friend' },
    ];

    const result = alignAllOverlapping(source, reference);

    // Source[0] (0-3000) overlaps ref[0] (0-2000, overlap=2000/3000=67%) and ref[1] (2000-3000, overlap=1000/3000=33%)
    expect(result[0].sourceIndex).toBe(0);
    expect(result[0].referenceIndices).toContain(0);
    expect(result[0].referenceIndices).toContain(1);
    expect(result[0].mergedReference).toBe('Hi there');

    // Source[1] (3000-6000) overlaps ref[1] (3000-5000, overlap=2000/3000=67%) and ref[2] (5000-6000, overlap=1000/3000=33%)
    expect(result[1].sourceIndex).toBe(1);
    expect(result[1].referenceIndices).toContain(1);
    expect(result[1].referenceIndices).toContain(2);
  });

  it('returns empty array when no overlaps', () => {
    const source = [{ begin: 0, end: 1000, text: 'A' }];
    const reference = [{ begin: 5000, end: 6000, text: 'B' }];
    expect(alignAllOverlapping(source, reference)).toEqual([]);
  });

  it('skips source cues with insufficient overlap', () => {
    // 10% overlap is below the 30% threshold
    const source = [{ begin: 0, end: 10000, text: 'Long' }];
    const reference = [{ begin: 9000, end: 11000, text: 'Short' }]; // overlap = 1000/10000 = 10%
    expect(alignAllOverlapping(source, reference)).toEqual([]);
  });

  it('handles one-to-many mapping', () => {
    // Each ref cue overlaps > 30% of source duration (10000ms)
    const source = [{ begin: 0, end: 10000, text: 'Long source cue' }];
    const reference = [
      { begin: 0, end: 4000, text: 'Part 1' },     // overlap=4000/10000=40%
      { begin: 3000, end: 7000, text: 'Part 2' },   // overlap=4000/10000=40%
      { begin: 6000, end: 10000, text: 'Part 3' },  // overlap=4000/10000=40%
    ];

    const result = alignAllOverlapping(source, reference);
    expect(result).toHaveLength(1);
    expect(result[0].referenceIndices).toEqual([0, 1, 2]);
    expect(result[0].mergedReference).toBe('Part 1 Part 2 Part 3');
  });

  it('handles empty inputs', () => {
    expect(alignAllOverlapping([], [])).toEqual([]);
    expect(alignAllOverlapping([{ begin: 0, end: 1000, text: 'A' }], [])).toEqual([]);
    expect(alignAllOverlapping([], [{ begin: 0, end: 1000, text: 'B' }])).toEqual([]);
  });
});

describe('evaluateTimeAlignedSimilarity', () => {
  it('computes similarity for time-aligned pairs', async () => {
    const translated = [
      { begin: 0, end: 3000, text: 'Hello' },
      { begin: 3000, end: 6000, text: 'World' },
    ];
    const reference = [
      { begin: 0, end: 3000, text: 'Hi' },
      { begin: 3000, end: 6000, text: 'Earth' },
    ];

    const mockPostJson = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        embeddings: [
          [1, 0], // translated "Hello"
          [0, 1], // translated "World"
          [1, 0], // reference "Hi" — same direction as "Hello"
          [0, 1], // reference "Earth" — same direction as "World"
        ],
      },
    });

    const result = await evaluateTimeAlignedSimilarity(translated, reference, 'http://localhost:11434', 'model', mockPostJson);

    expect(result.pairs).toHaveLength(2);
    expect(result.pairs[0].similarity).toBeCloseTo(1.0);
    expect(result.pairs[1].similarity).toBeCloseTo(1.0);
    expect(result.averageSimilarity).toBeCloseTo(1.0);
    expect(result.referenceCues).toHaveLength(2);
  });

  it('returns empty pairs when no overlaps exist', async () => {
    const translated = [{ begin: 0, end: 1000, text: 'A' }];
    const reference = [{ begin: 50000, end: 51000, text: 'B' }];

    const mockPostJson = vi.fn();
    const result = await evaluateTimeAlignedSimilarity(translated, reference, 'http://localhost:11434', 'model', mockPostJson);

    expect(result.pairs).toEqual([]);
    expect(result.averageSimilarity).toBe(0);
    expect(mockPostJson).not.toHaveBeenCalled();
  });

  it('includes referenceIndices in each pair', async () => {
    const translated = [{ begin: 0, end: 10000, text: 'Long line' }];
    const reference = [
      { begin: 0, end: 5000, text: 'Part A' },
      { begin: 5000, end: 10000, text: 'Part B' },
    ];

    const mockPostJson = vi.fn().mockResolvedValue({
      status: 200,
      data: { embeddings: [[1, 0], [0.9, 0.1]] },
    });

    const result = await evaluateTimeAlignedSimilarity(translated, reference, 'http://localhost:11434', 'model', mockPostJson);

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].referenceIndices).toEqual([0, 1]);
    expect(result.pairs[0].mergedReference).toBe('Part A Part B');
  });
});
