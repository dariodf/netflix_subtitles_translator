import { describe, it, expect } from 'vitest';
import {
  collectProblemLines,
  computeNameConsistencyScore,
  computeQualityScores,
  formatQualityReport,
} from '../src/headless/scoring.js';

describe('collectProblemLines', () => {
  it('unions flagged lines and issue indices', () => {
    const flagged = [0, 3, 5];
    const issues = [{ index: 3 }, { index: 7 }, { index: 9 }];
    const result = collectProblemLines(flagged, issues);
    expect(result).toEqual(new Set([0, 3, 5, 7, 9]));
  });

  it('handles empty flagged lines', () => {
    const result = collectProblemLines([], [{ index: 1 }]);
    expect(result).toEqual(new Set([1]));
  });

  it('handles empty issues', () => {
    const result = collectProblemLines([2, 4], []);
    expect(result).toEqual(new Set([2, 4]));
  });

  it('handles both empty', () => {
    const result = collectProblemLines([], []);
    expect(result).toEqual(new Set());
  });

  it('deduplicates overlapping indices', () => {
    const flagged = [1, 2, 3];
    const issues = [{ index: 2 }, { index: 3 }, { index: 4 }];
    const result = collectProblemLines(flagged, issues);
    expect(result.size).toBe(4); // 1, 2, 3, 4
  });
});

describe('computeNameConsistencyScore', () => {
  it('returns null for empty nameMap', () => {
    expect(computeNameConsistencyScore({})).toBe(null);
    expect(computeNameConsistencyScore(null)).toBe(null);
  });

  it('returns null when all names have only 1 occurrence', () => {
    const nameMap = {
      '花子': { count: 1, majority: 'Hanako', variants: { 'Hanako': [0] } },
    };
    expect(computeNameConsistencyScore(nameMap)).toBe(null);
  });

  it('returns 100 when all uses match majority', () => {
    const nameMap = {
      '花子': { count: 5, majority: 'Hanako', variants: { 'Hanako': [0, 1, 2, 3, 4] } },
    };
    expect(computeNameConsistencyScore(nameMap)).toBe(100);
  });

  it('computes correct score with variants', () => {
    const nameMap = {
      '花子': {
        count: 10,
        majority: 'Hanako',
        variants: { 'Hanako': [0, 1, 2, 3, 4, 5, 6, 7], 'Hana-ko': [8, 9] },
      },
    };
    expect(computeNameConsistencyScore(nameMap)).toBe(80);
  });

  it('aggregates across multiple names', () => {
    const nameMap = {
      '花子': {
        count: 4,
        majority: 'Hanako',
        variants: { 'Hanako': [0, 1, 2], 'Hana': [3] },
      },
      '夏目': {
        count: 6,
        majority: 'Natsume',
        variants: { 'Natsume': [4, 5, 6, 7, 8, 9] },
      },
    };
    // 3 + 6 = 9 majority uses out of 4 + 6 = 10 total
    expect(computeNameConsistencyScore(nameMap)).toBe(90);
  });
});

describe('computeQualityScores', () => {
  it('returns null scores for zero cues', () => {
    const output = { stats: { totalCues: 0, flaggedLines: [] } };
    const scores = computeQualityScores(output, null);
    expect(scores.qualityScore).toBe(null);
    expect(scores.totalCues).toBe(0);
  });

  it('returns 100 for perfect translation', () => {
    const output = { stats: { totalCues: 100, flaggedLines: [] } };
    const analysis = { issues: [], nameMap: {}, summary: { categories: {} } };
    const scores = computeQualityScores(output, analysis);
    expect(scores.qualityScore).toBe(100);
    expect(scores.flagRate).toBe(0);
    expect(scores.analysisIssueRate).toBe(0);
  });

  it('computes correctly with only flags (no analysis)', () => {
    const output = { stats: { totalCues: 100, flaggedLines: [0, 5, 10, 15, 20] } };
    const scores = computeQualityScores(output, null);
    expect(scores.qualityScore).toBe(95);
    expect(scores.flagRate).toBe(5);
    expect(scores.analysisIssueRate).toBe(null);
    expect(scores.nameConsistencyScore).toBe(null);
  });

  it('deduplicates overlapping flag and issue lines', () => {
    const output = { stats: { totalCues: 100, flaggedLines: [0, 1, 2, 3, 4] } };
    const analysis = {
      issues: [{ index: 3 }, { index: 4 }, { index: 5 }, { index: 6 }],
      nameMap: {},
      summary: { categories: { untranslatedCharacters: 4 } },
    };
    const scores = computeQualityScores(output, analysis);
    // Unique problem lines: 0,1,2,3,4,5,6 = 7
    expect(scores.uniqueProblemLines).toBe(7);
    expect(scores.qualityScore).toBe(93);
    expect(scores.flaggedCount).toBe(5);
    expect(scores.analysisIssueCount).toBe(4);
  });

  it('includes semanticSimilarityScore when provided', () => {
    const output = { stats: { totalCues: 10, flaggedLines: [] } };
    const analysis = { issues: [], nameMap: {}, summary: { categories: {} } };
    const semantic = { averageSimilarity: 0.85, pairs: [] };
    const scores = computeQualityScores(output, analysis, semantic);
    expect(scores.semanticSimilarityScore).toBe(85);
  });

  it('omits semanticSimilarityScore when not provided', () => {
    const output = { stats: { totalCues: 10, flaggedLines: [] } };
    const scores = computeQualityScores(output, null);
    expect(scores.semanticSimilarityScore).toBeUndefined();
  });

  it('includes category breakdown from analysis', () => {
    const output = { stats: { totalCues: 50, flaggedLines: [] } };
    const analysis = {
      issues: [{ index: 0 }, { index: 1 }],
      nameMap: {},
      summary: { categories: { speakerLabelLost: 1, rubyArtifact: 1 } },
    };
    const scores = computeQualityScores(output, analysis);
    expect(scores.categoryBreakdown).toEqual({ speakerLabelLost: 1, rubyArtifact: 1 });
  });
});

describe('formatQualityReport', () => {
  it('formats basic report without delta', () => {
    const scores = {
      qualityScore: 75,
      flagRate: 10,
      analysisIssueRate: 20,
      nameConsistencyScore: 85,
      flaggedCount: 50,
      uniqueProblemLines: 125,
      totalCues: 500,
      categoryBreakdown: { nameInconsistency: 10, speakerLabelLost: 5 },
    };
    const report = formatQualityReport(scores, null);
    expect(report).toContain('Quality:');
    expect(report).toContain('75.0%');
    expect(report).toContain('375/500 clean lines');
    expect(report).toContain('Flags:');
    expect(report).toContain('10.0%');
    expect(report).toContain('Issues:');
    expect(report).toContain('Names:');
    expect(report).toContain('85.0%');
    expect(report).toContain('nameInconsistency=10');
  });

  it('shows delta when previous scores provided', () => {
    const scores = {
      qualityScore: 80,
      flagRate: 5,
      analysisIssueRate: 15,
      nameConsistencyScore: 90,
      flaggedCount: 25,
      uniqueProblemLines: 100,
      totalCues: 500,
      categoryBreakdown: {},
    };
    const previous = {
      qualityScore: 75,
      flagRate: 10,
      analysisIssueRate: 20,
      nameConsistencyScore: 85,
    };
    const report = formatQualityReport(scores, previous);
    expect(report).toContain('+5.0');
    expect(report).toContain('-5.0');
  });

  it('handles null quality score', () => {
    const scores = { qualityScore: null };
    const report = formatQualityReport(scores, null);
    expect(report).toContain('n/a');
  });

  it('shows semantic similarity score when present', () => {
    const scores = {
      qualityScore: 90,
      flagRate: 5,
      analysisIssueRate: 5,
      nameConsistencyScore: null,
      semanticSimilarityScore: 85,
      flaggedCount: 10,
      uniqueProblemLines: 20,
      totalCues: 200,
      categoryBreakdown: {},
    };
    const report = formatQualityReport(scores, null);
    expect(report).toContain('Semantic:');
    expect(report).toContain('85.0%');
  });

  it('omits names line when nameConsistencyScore is null', () => {
    const scores = {
      qualityScore: 90,
      flagRate: 5,
      analysisIssueRate: 5,
      nameConsistencyScore: null,
      flaggedCount: 10,
      uniqueProblemLines: 20,
      totalCues: 200,
      categoryBreakdown: {},
    };
    const report = formatQualityReport(scores, null);
    expect(report).not.toContain('Names:');
  });
});
