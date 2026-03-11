import { describe, it, expect } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  generateRunId,
  buildRunSummary,
  readRunHistory,
  appendRunToHistory,
  filterRunsByEpisode,
  getLastRunForEpisode,
  formatRunHistoryTable,
  discoverMetrics,
  generateRunHistoryHtml,
  getGitInfo,
} from '../src/headless/run-history.js';

describe('generateRunId', () => {
  it('formats timestamp and commit correctly', () => {
    const id = generateRunId('2026-03-05T14:30:22.000Z', 'abc1234');
    // UTC time, so depends on timezone — just check format
    expect(id).toMatch(/^\d{8}-\d{6}-abc1234$/);
  });

  it('handles no-git commit', () => {
    const id = generateRunId('2026-01-01T00:00:00.000Z', 'no-git');
    expect(id).toContain('no-git');
  });
});

describe('buildRunSummary', () => {
  const translationOutput = {
    episode: 'test-s01e01',
    config: { provider: 'ollama', model: 'qwen2.5:3b', targetLang: 'English', sourceLang: 'Japanese' },
    stats: { totalCues: 418, flaggedLines: [0, 1], flaggedCount: 2, elapsedSeconds: 186.3 },
  };
  const scores = {
    qualityScore: 78.2,
    flagRate: 7.1,
    analysisIssueRate: 18.9,
    nameConsistencyScore: 81.8,
    flaggedCount: 22,
    analysisIssueCount: 61,
    uniqueProblemLines: 68,
    totalCues: 418,
    categoryBreakdown: { nameInconsistency: 16 },
  };
  const gitInfo = { commit: 'abc1234', commitMessage: 'test commit' };

  it('creates a valid run summary', () => {
    const summary = buildRunSummary(translationOutput, null, scores, gitInfo);
    expect(summary.runId).toMatch(/^\d{8}-\d{6}-abc1234$/);
    expect(summary.episode).toBe('test-s01e01');
    expect(summary.commit).toBe('abc1234');
    expect(summary.commitMessage).toBe('test commit');
    expect(summary.scores.qualityScore).toBe(78.2);
    expect(summary.totalCues).toBe(418);
    expect(summary.categoryBreakdown).toEqual({ nameInconsistency: 16 });
  });

  it('includes config fields', () => {
    const summary = buildRunSummary(translationOutput, null, scores, gitInfo);
    expect(summary.config.provider).toBe('ollama');
    expect(summary.config.model).toBe('qwen2.5:3b');
    expect(summary.config.targetLang).toBe('English');
  });

  it('includes normalization data from analysis output', () => {
    const analysisOutput = {
      normalizationSimulation: {
        fixableLines: 3,
        nameInconsistencyBefore: 5,
        nameInconsistencyAfter: 2,
        canonicalNames: { '花子': 'Hanako', '鈴木': 'Suzuki' },
      },
    };
    const summary = buildRunSummary(translationOutput, analysisOutput, scores, gitInfo);
    expect(summary.normalization).toEqual({
      fixableLines: 3,
      nameInconsistencyBefore: 5,
      nameInconsistencyAfter: 2,
    });
    expect(summary.canonicalNames).toEqual({ '花子': 'Hanako', '鈴木': 'Suzuki' });
  });

  it('includes time-aligned evaluation from analysis output', () => {
    const analysisOutput = {
      timeAlignedEvaluation: {
        alignedPairs: 8,
        unmatchedSource: 2,
        unmatchedReference: 1,
      },
    };
    const summary = buildRunSummary(translationOutput, analysisOutput, scores, gitInfo);
    expect(summary.timeAlignedEvaluation).toEqual({
      alignedPairs: 8,
      unmatchedSource: 2,
      unmatchedReference: 1,
    });
  });

  it('omits normalization and timeAligned when analysis is null', () => {
    const summary = buildRunSummary(translationOutput, null, scores, gitInfo);
    expect(summary.normalization).toBeUndefined();
    expect(summary.canonicalNames).toBeUndefined();
    expect(summary.timeAlignedEvaluation).toBeUndefined();
  });
});

describe('readRunHistory and appendRunToHistory', () => {
  const tmpPath = join(tmpdir(), `test-runs-${Date.now()}.jsonl`);

  it('returns empty array for non-existent file', () => {
    expect(readRunHistory('/nonexistent/path/runs.jsonl')).toEqual([]);
  });

  it('round-trips run summaries through JSONL', () => {
    const run1 = { runId: 'run1', episode: 'ep1', scores: { qualityScore: 80 } };
    const run2 = { runId: 'run2', episode: 'ep2', scores: { qualityScore: 90 } };

    appendRunToHistory(tmpPath, run1);
    appendRunToHistory(tmpPath, run2);

    const runs = readRunHistory(tmpPath);
    expect(runs.length).toBe(2);
    expect(runs[0].runId).toBe('run1');
    expect(runs[1].runId).toBe('run2');

    // Cleanup
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  });

  it('skips malformed lines', () => {
    const badPath = join(tmpdir(), `test-bad-${Date.now()}.jsonl`);
    writeFileSync(badPath, '{"runId":"good"}\nthis is not json\n{"runId":"also-good"}\n');
    const runs = readRunHistory(badPath);
    expect(runs.length).toBe(2);
    expect(runs[0].runId).toBe('good');
    expect(runs[1].runId).toBe('also-good');
    try { unlinkSync(badPath); } catch { /* ignore */ }
  });
});

describe('filterRunsByEpisode', () => {
  const runs = [
    { runId: 'r1', episode: 'ep1' },
    { runId: 'r2', episode: 'ep2' },
    { runId: 'r3', episode: 'ep1' },
  ];

  it('filters by episode name', () => {
    const filtered = filterRunsByEpisode(runs, 'ep1');
    expect(filtered.length).toBe(2);
    expect(filtered.every(r => r.episode === 'ep1')).toBe(true);
  });

  it('returns all runs when episode is null', () => {
    expect(filterRunsByEpisode(runs, null)).toEqual(runs);
  });

  it('returns empty array when no matches', () => {
    expect(filterRunsByEpisode(runs, 'nonexistent')).toEqual([]);
  });
});

describe('getLastRunForEpisode', () => {
  const runs = [
    { runId: 'r1', episode: 'ep1', scores: { qualityScore: 70 } },
    { runId: 'r2', episode: 'ep1', scores: { qualityScore: 80 } },
    { runId: 'r3', episode: 'ep2', scores: { qualityScore: 90 } },
  ];

  it('returns last run for given episode', () => {
    const last = getLastRunForEpisode(runs, 'ep1');
    expect(last.runId).toBe('r2');
    expect(last.scores.qualityScore).toBe(80);
  });

  it('returns null when no runs for episode', () => {
    expect(getLastRunForEpisode(runs, 'nonexistent')).toBe(null);
  });

  it('returns null for empty history', () => {
    expect(getLastRunForEpisode([], 'ep1')).toBe(null);
  });
});

describe('formatRunHistoryTable', () => {
  it('shows message for empty runs', () => {
    const table = formatRunHistoryTable([], 'test-config');
    expect(table).toContain('No runs found');
  });

  it('formats runs as table', () => {
    const runs = [
      {
        runId: '20260305-143022-abc1234',
        episode: 'test-s01e01',
        commit: 'abc1234',
        commitMessage: 'Test commit',
        elapsedSeconds: 186.3,
        scores: { qualityScore: 78.2, flagRate: 7.1, analysisIssueRate: 18.9, nameConsistencyScore: 81.8 },
      },
    ];
    const table = formatRunHistoryTable(runs, 'baseline');
    expect(table).toContain('Run History: baseline');
    expect(table).toContain('Quality');
    expect(table).toContain('78.2%');
    expect(table).toContain('test-s01e01');
    expect(table).toContain('abc1234');
  });

  it('includes multiple runs', () => {
    const runs = [
      { runId: 'r1', episode: 'ep1', commit: 'aaa', commitMessage: '', elapsedSeconds: 100, scores: { qualityScore: 70 } },
      { runId: 'r2', episode: 'ep2', commit: 'bbb', commitMessage: '', elapsedSeconds: 200, scores: { qualityScore: 80 } },
    ];
    const table = formatRunHistoryTable(runs, 'cfg');
    expect(table).toContain('ep1');
    expect(table).toContain('ep2');
  });
});


describe('discoverMetrics', () => {
  it('discovers metrics present in runs', () => {
    const runs = [
      { scores: { qualityScore: 80, flagRate: 10 } },
      { scores: { qualityScore: 90, semanticSimilarityScore: 50 } },
    ];
    const keys = discoverMetrics(runs).map(m => m.key);
    expect(keys).toEqual(['qualityScore', 'flagRate', 'semanticSimilarityScore']);
  });

  it('returns known metrics in fixed order', () => {
    const runs = [
      { scores: { crossLingualScore: 50, qualityScore: 80, analysisIssueRate: 10 } },
    ];
    const keys = discoverMetrics(runs).map(m => m.key);
    expect(keys).toEqual(['qualityScore', 'analysisIssueRate', 'crossLingualScore']);
  });

  it('excludes metrics that are always null', () => {
    const runs = [
      { scores: { qualityScore: 80, nameConsistencyScore: null } },
    ];
    const keys = discoverMetrics(runs).map(m => m.key);
    expect(keys).toContain('qualityScore');
    expect(keys).not.toContain('nameConsistencyScore');
  });

  it('excludes count and breakdown fields', () => {
    const runs = [
      { scores: { qualityScore: 90, flaggedCount: 5, totalCues: 100, categoryBreakdown: {} } },
    ];
    const keys = discoverMetrics(runs).map(m => m.key);
    expect(keys).toEqual(['qualityScore']);
  });

  it('returns empty array for no runs', () => {
    expect(discoverMetrics([])).toEqual([]);
  });

  it('includes lowerIsBetter field for all metrics', () => {
    const runs = [
      { scores: { qualityScore: 80, flagRate: 10, analysisIssueRate: 5, nameConsistencyScore: 90 } },
    ];
    const metrics = discoverMetrics(runs);
    for (const metric of metrics) {
      expect(metric).toHaveProperty('lowerIsBetter');
      expect(typeof metric.lowerIsBetter).toBe('boolean');
    }
    expect(metrics.find(m => m.key === 'qualityScore').lowerIsBetter).toBe(false);
    expect(metrics.find(m => m.key === 'flagRate').lowerIsBetter).toBe(true);
    expect(metrics.find(m => m.key === 'analysisIssueRate').lowerIsBetter).toBe(true);
    expect(metrics.find(m => m.key === 'nameConsistencyScore').lowerIsBetter).toBe(false);
  });
});

describe('generateRunHistoryHtml', () => {
  const sampleRuns = [
    {
      runId: '20260305-193002-abc1234', timestamp: '2026-03-05T10:30:02.293Z',
      commit: 'abc1234', commitMessage: 'Test commit', episode: 'smoke-test',
      totalCues: 10, elapsedSeconds: 8.3,
      scores: { qualityScore: 80, flagRate: 10, analysisIssueRate: 20, nameConsistencyScore: null },
    },
    {
      runId: '20260305-194043-def5678', timestamp: '2026-03-05T10:40:43.324Z',
      commit: 'def5678', commitMessage: 'Second run', episode: 'smoke-test',
      totalCues: 10, elapsedSeconds: 9.1,
      scores: { qualityScore: 100, flagRate: 0, analysisIssueRate: 0, nameConsistencyScore: 100 },
    },
    {
      runId: '20260305-200000-ghi9012', timestamp: '2026-03-05T11:00:00.000Z',
      commit: 'ghi9012', commitMessage: 'Other episode', episode: 'smoke-ja-action',
      totalCues: 10, elapsedSeconds: 5.3,
      scores: { qualityScore: 100, flagRate: 0, analysisIssueRate: 0, nameConsistencyScore: null },
    },
  ];

  it('returns a valid HTML document', () => {
    const html = generateRunHistoryHtml(sampleRuns, 'only-3b');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('chart.js');
  });

  it('includes config name in title', () => {
    const html = generateRunHistoryHtml(sampleRuns, 'only-3b');
    expect(html).toContain('Run History: only-3b');
  });

  it('creates one chart section per episode with higher and lower canvases', () => {
    const html = generateRunHistoryHtml(sampleRuns, 'only-3b');
    expect(html).toContain('chart-smoke-test-higher');
    expect(html).toContain('chart-smoke-test-lower');
    expect(html).toContain('chart-smoke-ja-action-higher');
    expect(html).toContain('chart-smoke-ja-action-lower');
  });

  it('embeds run data as JSON', () => {
    const html = generateRunHistoryHtml(sampleRuns, 'only-3b');
    expect(html).toContain('"qualityScore":80');
    expect(html).toContain('"abc1234"');
  });

  it('includes metrics that have data', () => {
    const html = generateRunHistoryHtml(sampleRuns, 'only-3b');
    expect(html).toContain('Quality');
    expect(html).toContain('Name Consistency');
    expect(html).not.toContain('Semantic Similarity');
  });

  it('handles empty runs', () => {
    const html = generateRunHistoryHtml([], 'empty-config');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('No runs');
  });
});

describe('getGitInfo', () => {
  it('returns commit hash and message from current repo', () => {
    const info = getGitInfo();
    // We are in a git repo (just initialized), so should have a real commit
    expect(info.commit).not.toBe('no-git');
    expect(info.commit.length).toBe(7);
    expect(info.commitMessage.length).toBeGreaterThan(0);
  });
});
