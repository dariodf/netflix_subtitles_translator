/**
 * Run history management — JSONL-based append-only history.
 * Tracks translation runs with git commit association and quality scores.
 */

import { readFileSync, appendFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { escapeHtml } from '../core/utils.js';

// ============================
// GIT INFO
// ============================

/**
 * Get current git commit hash and message.
 * Returns { commit: 'no-git', commitMessage: '' } if not a git repo.
 */
export function getGitInfo() {
  try {
    const commit = execSync('git rev-parse --short=7 HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const commitMessage = execSync('git log -1 --pretty=%s', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { commit, commitMessage };
  } catch {
    return { commit: 'no-git', commitMessage: '' };
  }
}

// ============================
// RUN ID
// ============================

/**
 * Generate a run ID from timestamp and commit hash.
 * Format: YYYYMMDD-HHMMSS-<commit>
 */
export function generateRunId(timestamp, commitHash) {
  const date = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${datePart}-${timePart}-${commitHash}`;
}

// ============================
// RUN SUMMARY
// ============================

/**
 * Build a run summary object from translation output, analysis output, and git info.
 */
export function buildRunSummary(translationOutput, analysisOutput, scores, gitInfo) {
  const timestamp = new Date().toISOString();
  const runId = generateRunId(timestamp, gitInfo.commit);

  const config = translationOutput.config || {};
  const stats = translationOutput.stats || {};

  const summary = {
    runId,
    timestamp,
    commit: gitInfo.commit,
    commitMessage: gitInfo.commitMessage,
    episode: translationOutput.episode,
    config: {
      provider: config.provider || '',
      model: config.model || '',
      targetLang: config.targetLang || '',
      sourceLang: config.sourceLang || '',
    },
    secondModel: config.secondModel || '',
    totalCues: scores.totalCues,
    elapsedSeconds: stats.elapsedSeconds || 0,
    scores: { ...scores },
    flaggedCount: scores.flaggedCount,
    analysisIssueCount: scores.analysisIssueCount,
    uniqueProblemLines: scores.uniqueProblemLines,
    categoryBreakdown: scores.categoryBreakdown,
  };

  if (analysisOutput?.normalizationSimulation) {
    const norm = analysisOutput.normalizationSimulation;
    summary.normalization = {
      fixableLines: norm.fixableLines,
      nameInconsistencyBefore: norm.nameInconsistencyBefore,
      nameInconsistencyAfter: norm.nameInconsistencyAfter,
    };
    const names = norm.canonicalNames;
    if (names && typeof names === 'object') {
      const entries = Object.entries(names).slice(0, 5);
      if (entries.length > 0) {
        summary.canonicalNames = Object.fromEntries(entries);
      }
    }
  }

  if (analysisOutput?.timeAlignedEvaluation) {
    summary.timeAlignedEvaluation = analysisOutput.timeAlignedEvaluation;
  }

  return summary;
}

// ============================
// JSONL READ/WRITE
// ============================

/**
 * Read all run summaries from a JSONL history file.
 * Skips malformed lines gracefully.
 */
export function readRunHistory(historyPath) {
  if (!existsSync(historyPath)) return [];
  const content = readFileSync(historyPath, 'utf-8');
  const runs = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      runs.push(JSON.parse(line));
    } catch {
      console.warn(`Warning: skipping malformed line in ${historyPath}`);
    }
  }
  return runs;
}

/**
 * Append a run summary to the JSONL history file.
 */
export function appendRunToHistory(historyPath, runSummary) {
  const line = JSON.stringify(runSummary) + '\n';
  appendFileSync(historyPath, line, 'utf-8');
}

// ============================
// FILTERING & LOOKUP
// ============================

/**
 * Filter run history by episode name. Pass null for all episodes.
 */
export function filterRunsByEpisode(runs, episodeName) {
  if (!episodeName) return runs;
  return runs.filter(r => r.episode === episodeName);
}

/**
 * Get the most recent run for a given episode from the history.
 */
export function getLastRunForEpisode(runs, episodeName) {
  const filtered = filterRunsByEpisode(runs, episodeName);
  return filtered.length > 0 ? filtered[filtered.length - 1] : null;
}

// ============================
// TABLE FORMATTING
// ============================

function padRight(str, len) {
  return String(str).padEnd(len);
}

function padLeft(str, len) {
  return String(str).padStart(len);
}

function fmtPct(val) {
  if (val === null || val === undefined) return 'n/a';
  return `${val.toFixed(1)}%`;
}

/**
 * Format run history as a table for console output.
 */
export function formatRunHistoryTable(runs, configName) {
  if (runs.length === 0) return `No runs found for config: ${configName}`;

  const hasNormalization = runs.some(r => r.normalization);
  const hasSemantic = runs.some(r => r.scores?.semanticSimilarityScore != null);
  const hasCrossLingual = runs.some(r => r.scores?.crossLingualScore != null);
  let header = `${padRight('RunId', 28)} ${padRight('Episode', 22)} ${padLeft('Quality', 8)} ${padLeft('Flags', 8)} ${padLeft('Issues', 8)} ${padLeft('Names', 8)}`;
  if (hasSemantic) header += ` ${padLeft('Semantic', 10)}`;
  if (hasCrossLingual) header += ` ${padLeft('CrossLing', 10)}`;
  if (hasNormalization) header += ` ${padLeft('Norm', 6)}`;
  header += ` ${padLeft('Time', 8)}  Commit`;
  const separator = '-'.repeat(header.length);

  const lines = [
    `Run History: ${configName}`,
    '',
    header,
    separator,
  ];

  for (const run of runs) {
    const s = run.scores || {};
    const time = run.elapsedSeconds ? `${run.elapsedSeconds.toFixed(0)}s` : 'n/a';
    const commitInfo = `${run.commit} ${run.commitMessage || ''}`.trim();
    let line = `${padRight(run.runId, 28)} ${padRight(run.episode, 22)} ${padLeft(fmtPct(s.qualityScore), 8)} ${padLeft(fmtPct(s.flagRate), 8)} ${padLeft(fmtPct(s.analysisIssueRate), 8)} ${padLeft(fmtPct(s.nameConsistencyScore), 8)}`;
    if (hasSemantic) line += ` ${padLeft(fmtPct(s.semanticSimilarityScore), 10)}`;
    if (hasCrossLingual) line += ` ${padLeft(fmtPct(s.crossLingualScore), 10)}`;
    if (hasNormalization) {
      const norm = run.normalization;
      const normStr = norm ? `${norm.fixableLines}` : 'n/a';
      line += ` ${padLeft(normStr, 6)}`;
    }
    line += ` ${padLeft(time, 8)}  ${commitInfo}`;
    lines.push(line);
  }

  return lines.join('\n');
}

// ============================
// HTML CHART GENERATION
// ============================

const KNOWN_METRICS = [
  { key: 'qualityScore', label: 'Quality', lowerIsBetter: false },
  { key: 'flagRate', label: 'Flag Rate', lowerIsBetter: true },
  { key: 'analysisIssueRate', label: 'Issue Rate', lowerIsBetter: true },
  { key: 'nameConsistencyScore', label: 'Name Consistency', lowerIsBetter: false },
  { key: 'semanticSimilarityScore', label: 'Semantic Similarity', lowerIsBetter: false },
  { key: 'crossLingualScore', label: 'Cross-Lingual', lowerIsBetter: false },
];

const EXCLUDED_SCORE_FIELDS = new Set([
  'flaggedCount', 'analysisIssueCount', 'uniqueProblemLines', 'totalCues', 'categoryBreakdown',
]);

/**
 * Discover metrics present in runs with at least one non-null value.
 * Known metrics in fixed order, unknown appended alphabetically.
 */
export function discoverMetrics(runs) {
  const found = new Set();
  for (const run of runs) {
    if (!run.scores) continue;
    for (const [key, val] of Object.entries(run.scores)) {
      if (!EXCLUDED_SCORE_FIELDS.has(key) && val != null && typeof val === 'number') {
        found.add(key);
      }
    }
  }

  const result = [];
  for (const metric of KNOWN_METRICS) {
    if (found.has(metric.key)) { result.push(metric); found.delete(metric.key); }
  }
  for (const key of [...found].sort()) {
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
    result.push({ key, label, lowerIsBetter: false });
  }
  return result;
}

const METRIC_COLORS = {
  qualityScore: 'rgb(34, 139, 34)',
  flagRate: 'rgb(220, 20, 60)',
  analysisIssueRate: 'rgb(255, 140, 0)',
  nameConsistencyScore: 'rgb(65, 105, 225)',
  semanticSimilarityScore: 'rgb(148, 103, 189)',
  crossLingualScore: 'rgb(23, 190, 207)',
};

const FALLBACK_COLORS = [
  'rgb(188, 143, 143)', 'rgb(107, 142, 35)', 'rgb(199, 21, 133)', 'rgb(70, 130, 180)',
];

/**
 * Generate a self-contained HTML file with Chart.js line charts for run history.
 */
export function generateRunHistoryHtml(runs, configName) {
  const metrics = discoverMetrics(runs);

  // Group by episode preserving order
  const episodeGroups = {};
  for (const run of runs) {
    const ep = run.episode || 'unknown';
    if (!episodeGroups[ep]) episodeGroups[ep] = [];
    episodeGroups[ep].push({
      runId: run.runId,
      timestamp: run.timestamp,
      commit: run.commit,
      commitMessage: run.commitMessage,
      totalCues: run.totalCues,
      elapsedSeconds: run.elapsedSeconds,
      scores: run.scores || {},
    });
  }

  const episodes = Object.keys(episodeGroups);

  // Assign colors
  let fallbackIndex = 0;
  const colorMap = {};
  for (const m of metrics) {
    colorMap[m.key] = METRIC_COLORS[m.key] || FALLBACK_COLORS[fallbackIndex++ % FALLBACK_COLORS.length];
  }

  const higherMetrics = metrics.filter(m => !m.lowerIsBetter);
  const lowerMetrics = metrics.filter(m => m.lowerIsBetter);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Run History: ${escapeHtml(configName)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 20px; background: #fafafa; color: #333; }
  h1 { text-align: center; margin-bottom: 4px; }
  .subtitle { text-align: center; color: #888; margin-bottom: 30px; }
  .chart-container { max-width: 1200px; margin: 0 auto 50px; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .chart-container h2 { margin: 0 0 10px; font-size: 1.1em; }
  .chart-row { display: flex; gap: 20px; }
  .chart-half { flex: 1; min-width: 0; }
  .no-runs { text-align: center; color: #888; margin-top: 60px; }
</style>
</head>
<body>
<h1>Run History: ${escapeHtml(configName)}</h1>
<p class="subtitle">${runs.length} runs across ${episodes.length} episode${episodes.length !== 1 ? 's' : ''}</p>
${episodes.length === 0 ? '<p class="no-runs">No runs found.</p>' : episodes.map(ep => {
  const id = ep.replace(/[^a-zA-Z0-9-]/g, '_');
  return `
<div class="chart-container">
  <h2>${escapeHtml(ep)} (${episodeGroups[ep].length} runs)</h2>
  <div class="chart-row">
    <div class="chart-half"><canvas id="chart-${id}-higher"></canvas></div>
    <div class="chart-half"><canvas id="chart-${id}-lower"></canvas></div>
  </div>
</div>`;
}).join('\n')}
<script>
const runData = ${JSON.stringify(episodeGroups)};
const higherMetrics = ${JSON.stringify(higherMetrics)};
const lowerMetrics = ${JSON.stringify(lowerMetrics)};
const colors = ${JSON.stringify(colorMap)};

function buildTooltipCallbacks(runs) {
  return {
    title: function(items) {
      const run = runs[items[0].dataIndex];
      return run.commit + ' \\u2014 ' + (run.commitMessage || '').slice(0, 60);
    },
    afterTitle: function(items) {
      const run = runs[items[0].dataIndex];
      return new Date(run.timestamp).toLocaleString() + '  (' + run.totalCues + ' cues, ' + (run.elapsedSeconds || 0).toFixed(0) + 's)';
    },
    label: function(ctx) {
      const v = ctx.parsed.y;
      return ctx.dataset.label + ': ' + (v != null ? v.toFixed(1) + '%' : 'n/a');
    },
  };
}

function buildDatasets(metricList, runs) {
  return metricList
    .filter(m => runs.some(r => r.scores[m.key] != null))
    .map(m => ({
      label: m.label,
      data: runs.map(r => { const v = r.scores[m.key]; return v != null ? v : null; }),
      borderColor: colors[m.key],
      backgroundColor: colors[m.key],
      tension: 0.2,
      spanGaps: true,
      pointRadius: 4,
      pointHoverRadius: 7,
    }));
}

for (const [episode, runs] of Object.entries(runData)) {
  const id = episode.replace(/[^a-zA-Z0-9-]/g, '_');
  const labels = runs.map((r, i) => '#' + (i + 1) + ' (' + r.commit + ')');

  const higherCtx = document.getElementById('chart-' + id + '-higher');
  if (higherCtx) {
    new Chart(higherCtx, {
      type: 'line',
      data: { labels, datasets: buildDatasets(higherMetrics, runs) },
      options: {
        responsive: true,
        scales: { y: { min: 0, max: 100, title: { display: true, text: '%' } } },
        plugins: { tooltip: { callbacks: buildTooltipCallbacks(runs) }, legend: { position: 'top' } },
      },
    });
  }

  const lowerCtx = document.getElementById('chart-' + id + '-lower');
  if (lowerCtx) {
    new Chart(lowerCtx, {
      type: 'line',
      data: { labels, datasets: buildDatasets(lowerMetrics, runs) },
      options: {
        responsive: true,
        scales: { y: { min: 0, max: 100, title: { display: true, text: '%' } } },
        plugins: { tooltip: { callbacks: buildTooltipCallbacks(runs) }, legend: { position: 'top' } },
      },
    });
  }
}
</script>
</body>
</html>`;
}

// ============================
// CLI ENTRY POINT
// ============================

const RUNS_DIR = join(new URL('.', import.meta.url).pathname, '../../runs');

export function openInBrowser(filePath) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    execSync(`${cmd} "${filePath}"`, { stdio: 'ignore' });
  } catch { /* ignore — browser open is best-effort */ }
}

async function main() {
  const args = process.argv.slice(2);
  const configIdx = args.indexOf('--config');
  const configName = configIdx !== -1 ? args[configIdx + 1] : null;
  const htmlMode = args.includes('--html');
  const shouldOpen = args.includes('--open');

  if (!configName) {
    // List all configs that have runs.jsonl
    const configs = readdirSync(RUNS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(join(RUNS_DIR, d.name, 'runs.jsonl')))
      .map(d => d.name);

    if (configs.length === 0) {
      console.log('No run history found. Run translations first.');
      return;
    }

    for (const config of configs) {
      const historyPath = join(RUNS_DIR, config, 'runs.jsonl');
      const runs = readRunHistory(historyPath);
      if (htmlMode) {
        const htmlPath = join(RUNS_DIR, config, 'history.html');
        writeFileSync(htmlPath, generateRunHistoryHtml(runs, config), 'utf-8');
        console.log(htmlPath);
        if (shouldOpen) openInBrowser(htmlPath);
      } else {
        console.log(formatRunHistoryTable(runs, config));
        console.log();
      }
    }
    return;
  }

  const historyPath = join(RUNS_DIR, configName, 'runs.jsonl');
  const runs = readRunHistory(historyPath);

  const episodeIdx = args.indexOf('--episode');
  const episodeName = episodeIdx !== -1 ? args[episodeIdx + 1] : null;

  const filtered = filterRunsByEpisode(runs, episodeName);

  if (htmlMode) {
    const htmlPath = join(RUNS_DIR, configName, 'history.html');
    writeFileSync(htmlPath, generateRunHistoryHtml(filtered, configName), 'utf-8');
    console.log(htmlPath);
    if (shouldOpen) openInBrowser(htmlPath);
  } else {
    console.log(formatRunHistoryTable(filtered, configName));
  }
}

// Only run CLI when executed directly
if (process.argv[1] && process.argv[1].endsWith('run-history.js')) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
