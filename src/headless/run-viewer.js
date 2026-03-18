/**
 * Run viewer — interactive HTML visualization of a single translation run.
 * Shows per-line scores as a chart with click-to-jump, and side-by-side original/translated text.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { escapeHtml } from '../core/utils.js';
import { openInBrowser } from './run-history.js';

// ============================
// DATA ASSEMBLY
// ============================

/**
 * Build per-line view data by merging translated output, analysis, and similarity data.
 * @param {object} translatedOutput - Parsed output.translated.json
 * @param {object|null} analysisOutput - Parsed output.analysis.json (nullable)
 * @param {object|null} similarityOutput - Parsed output.similarity.json (nullable)
 * @returns {Array<object>} Per-line data array
 */
export function buildLineData(translatedOutput, analysisOutput, similarityOutput) {
  const cues = translatedOutput.cues || [];

  // Pre-index issues by line number for O(1) lookup
  const issuesByLine = new Map();
  for (const issue of (analysisOutput?.issues || [])) {
    if (!issuesByLine.has(issue.index)) issuesByLine.set(issue.index, []);
    issuesByLine.get(issue.index).push({ category: issue.category, detail: issue.detail });
  }

  // Similarity pairs are ordered by index — access directly by position
  const semanticPairs = similarityOutput?.semantic?.pairs || [];
  const crossLingualPairs = similarityOutput?.crossLingual?.pairs || [];

  // Reference-aligned pairs are sparse (only lines with overlapping reference cues)
  const referenceAlignedPairs = similarityOutput?.referenceAligned?.pairs || [];
  const referenceAlignedByIndex = new Map();
  for (const pair of referenceAlignedPairs) {
    referenceAlignedByIndex.set(pair.index, pair);
  }

  return cues.map((cue, i) => {
    const scores = {};
    if (semanticPairs[i]) scores.semantic = Math.round(semanticPairs[i].similarity * 10000) / 100;
    if (crossLingualPairs[i]) scores.crossLingual = Math.round(crossLingualPairs[i].similarity * 10000) / 100;

    const refAligned = referenceAlignedByIndex.get(i);
    if (refAligned) scores.referenceAligned = Math.round(refAligned.similarity * 10000) / 100;

    return {
      index: i,
      original: cue.original,
      translated: cue.translated,
      flagged: cue.flagged || false,
      flagReason: cue.flagReason || null,
      issues: issuesByLine.get(i) || [],
      scores,
      referenceIndices: refAligned ? refAligned.referenceIndices : [],
    };
  });
}

// ============================
// HTML GENERATION
// ============================

const SCORE_COLORS = {
  semantic: 'rgb(148, 103, 189)',
  crossLingual: 'rgb(23, 190, 207)',
  referenceAligned: 'rgb(255, 152, 0)',
};

const SCORE_LABELS = {
  semantic: 'Semantic Similarity',
  crossLingual: 'Cross-Lingual',
  referenceAligned: 'vs Official',
};

/**
 * Generate a self-contained HTML file for viewing a single translation run.
 * @param {object} options
 * @param {Array} options.lines - Per-line data from buildLineData
 * @param {object} options.metadata - { episode, config, stats }
 * @param {string[]} options.scoreTypes - Available score types e.g. ['semantic', 'crossLingual', 'referenceAligned']
 * @param {object|null} [options.referenceData] - Optional reference data { cues: [{index, text}], alignmentBySourceLine: {sourceIdx: [refIdx, ...]} }
 * @returns {string} Complete HTML document
 */
export function generateRunViewerHtml({ lines, metadata, scoreTypes, referenceData = null }) {
  const hasScores = scoreTypes.length > 0;
  const hasReference = referenceData && referenceData.cues && referenceData.cues.length > 0;
  let flaggedCount = 0, issueCount = 0, cleanCount = 0;
  for (const line of lines) {
    if (line.flagged) flaggedCount++;
    if (line.issues.length > 0) issueCount++;
    if (!line.flagged && line.issues.length === 0) cleanCount++;
  }

  const scoreLabelsJson = JSON.stringify(SCORE_LABELS);
  const scoreColorsJson = JSON.stringify(SCORE_COLORS);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Run Viewer: ${metadata.episode}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  * { box-sizing: border-box; }
  html { height: 100%; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: #fafafa; color: #333; min-height: 100%; }
  .header { background: #fff; padding: 12px 24px; border-bottom: 1px solid #e0e0e0; flex-shrink: 0; }
  .header h1 { margin: 0 0 4px; font-size: 1.3em; }
  .header .meta { color: #888; font-size: 0.85em; }
  .header .stats { margin-top: 6px; display: flex; gap: 16px; font-size: 0.85em; }
  .header .stats .stat { padding: 2px 8px; border-radius: 4px; }
  .stat-clean { background: #e8f5e9; color: #2e7d32; }
  .stat-flagged { background: #ffebee; color: #c62828; }
  .stat-issues { background: #fff3e0; color: #e65100; }
  .stat[data-filter] { cursor: pointer; user-select: none; transition: all 0.15s; }
  .stat[data-filter]:hover { opacity: 0.85; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
  .stat[data-filter].active { outline: 2px solid currentColor; outline-offset: -1px; font-weight: 600; }
  .chart-container { max-width: 1400px; width: 100%; margin: 8px auto; background: #fff; padding: 12px 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .panels-container { max-width: 1400px; width: 100%; margin: 0 auto; display: flex; gap: 12px; height: 80vh; padding: 0 0 12px; }
  .text-panel { flex: ${hasReference ? '2' : '1'}; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow-y: auto; min-height: 0; }
  .reference-panel { flex: 1; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow-y: auto; min-height: 0; }
  .line-row { display: flex; border-bottom: 1px solid #f0f0f0; cursor: pointer; transition: background 0.15s; border-left: 3px solid transparent; }
  .line-row:hover { background: #f5f5f5; }
  .line-row.flagged { background: #fff0f0; border-left-color: #dc143c; }
  .line-row.has-issues:not(.flagged) { background: #fff8e8; border-left-color: #ff8c00; }
  .line-row.highlighted { background: #e8f0ff !important; outline: 2px solid #4169e1; outline-offset: -2px; z-index: 1; position: relative; }
  .line-row.header-row { background: #f8f8f8; font-weight: 600; font-size: 0.8em; text-transform: uppercase; color: #888; cursor: default; border-left-color: transparent; position: sticky; top: 0; z-index: 2; }
  .line-row.header-row:hover { background: #f8f8f8; }
  .line-number { width: 40px; flex-shrink: 0; padding: 6px 4px; text-align: right; color: #aaa; font-size: 0.8em; font-variant-numeric: tabular-nums; }
  .line-original, .line-translated { flex: 1; padding: 6px 10px; font-size: 0.88em; line-height: 1.5; word-break: break-word; }
  .line-original { border-right: 1px solid #f0f0f0; }
  .line-badges { display: flex; gap: 4px; margin-top: 2px; flex-wrap: wrap; }
  .badge { font-size: 0.7em; padding: 1px 5px; border-radius: 3px; }
  .badge-flag { background: #ffcdd2; color: #b71c1c; }
  .badge-issue { background: #ffe0b2; color: #bf360c; }
  .badge-score { background: #e8eaf6; color: #283593; }
  .no-chart { text-align: center; color: #888; padding: 20px; font-style: italic; }
  .ref-row { display: flex; border-bottom: 1px solid #f0f0f0; cursor: pointer; transition: background 0.15s; border-left: 3px solid transparent; }
  .ref-row:hover { background: #f5f5f5; }
  .ref-row.highlighted { background: #fff3e0 !important; outline: 2px solid #ff9800; outline-offset: -2px; z-index: 1; position: relative; }
  .ref-row.header-row { background: #f8f8f8; font-weight: 600; font-size: 0.8em; text-transform: uppercase; color: #888; cursor: default; border-left-color: transparent; position: sticky; top: 0; z-index: 2; }
  .ref-row.header-row:hover { background: #f8f8f8; }
  .ref-number { width: 40px; flex-shrink: 0; padding: 6px 4px; text-align: right; color: #aaa; font-size: 0.8em; font-variant-numeric: tabular-nums; }
  .ref-text { flex: 1; padding: 6px 10px; font-size: 0.88em; line-height: 1.5; word-break: break-word; }
</style>
</head>
<body>
<div class="header">
  <h1>${metadata.episode}</h1>
  <div class="meta">${metadata.config?.model || 'unknown model'} | ${metadata.config?.sourceLang || '?'} &#8594; ${metadata.config?.targetLang || '?'}${metadata.stats?.elapsedSeconds ? ' | ' + metadata.stats.elapsedSeconds.toFixed(1) + 's' : ''}</div>
  <div class="stats">
    <span class="stat stat-clean" data-filter="clean">${cleanCount} clean</span>
    ${flaggedCount > 0 ? `<span class="stat stat-flagged" data-filter="flagged">${flaggedCount} flagged</span>` : ''}
    ${issueCount > 0 ? `<span class="stat stat-issues" data-filter="issues">${issueCount} with issues</span>` : ''}
    <span class="stat" data-filter="all" style="background:#f0f0f0">${lines.length} total lines</span>
  </div>
</div>

<div class="chart-container">
${hasScores ? `<canvas id="score-chart"></canvas>` : '<div class="no-chart">No per-line scores available. Run with embedding models to generate similarity scores.</div>'}
</div>

<div class="panels-container">
<div class="text-panel" id="text-panel">
  <div class="line-row header-row">
    <div class="line-number">#</div>
    <div class="line-original">Original</div>
    <div class="line-translated">Translation</div>
  </div>
${lines.map(line => {
  const classes = ['line-row'];
  if (line.flagged) classes.push('flagged');
  if (line.issues.length > 0) classes.push('has-issues');

  const badges = [];
  if (line.flagReason) badges.push(`<span class="badge badge-flag">${escapeHtml(line.flagReason)}</span>`);
  for (const issue of line.issues) badges.push(`<span class="badge badge-issue">${escapeHtml(issue.category)}</span>`);
  for (const [key, val] of Object.entries(line.scores)) badges.push(`<span class="badge badge-score">${escapeHtml(SCORE_LABELS[key] || key)}: ${val.toFixed(1)}%</span>`);

  const badgeHtml = badges.length > 0 ? `<div class="line-badges">${badges.join('')}</div>` : '';

  return `  <div class="${classes.join(' ')}" id="line-${line.index}" data-index="${line.index}">
    <div class="line-number">${line.index}</div>
    <div class="line-original">${escapeHtml(line.original)}${badgeHtml}</div>
    <div class="line-translated">${escapeHtml(line.translated)}</div>
  </div>`;
}).join('\n')}
</div>
${hasReference ? `
<div class="reference-panel" id="reference-panel">
  <div class="ref-row header-row">
    <div class="ref-number">#</div>
    <div class="ref-text">Official Translation</div>
  </div>
${referenceData.cues.map(cue => `  <div class="ref-row" id="ref-${cue.index}" data-ref-index="${cue.index}">
    <div class="ref-number">${cue.index}</div>
    <div class="ref-text">${escapeHtml(cue.text)}</div>
  </div>`).join('\n')}
</div>
` : ''}
</div>

<script>
const lineData = ${JSON.stringify(lines).replace(/<\//g, '<\\/')};
const scoreTypes = ${JSON.stringify(scoreTypes)};
const scoreLabels = ${scoreLabelsJson};
const scoreColors = ${scoreColorsJson};
const hasReference = ${hasReference};

// Build reverse lookup: refIndex -> [sourceIndex, ...]
const refToSourceMap = {};
if (hasReference) {
  lineData.forEach(line => {
    (line.referenceIndices || []).forEach(ri => {
      if (!refToSourceMap[ri]) refToSourceMap[ri] = [];
      refToSourceMap[ri].push(line.index);
    });
  });
}

function clearHighlights() {
  document.querySelectorAll('.line-row.highlighted').forEach(el => el.classList.remove('highlighted'));
  document.querySelectorAll('.ref-row.highlighted').forEach(el => el.classList.remove('highlighted'));
}

let selectedChartIndex = -1;
function highlightChartPoint(lineIndex) {
  selectedChartIndex = lineIndex;
  if (typeof chart !== 'undefined' && chart) chart.update();
}

function highlightSourceLine(lineIndex) {
  clearHighlights();
  highlightChartPoint(lineIndex);
  const row = document.getElementById('line-' + lineIndex);
  if (row) {
    row.classList.add('highlighted');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  // Scroll reference panel to overlapping cues
  if (hasReference) {
    const refIndices = lineData[lineIndex]?.referenceIndices || [];
    refIndices.forEach(ri => {
      const refRow = document.getElementById('ref-' + ri);
      if (refRow) refRow.classList.add('highlighted');
    });
    if (refIndices.length > 0) {
      const firstRef = document.getElementById('ref-' + refIndices[0]);
      if (firstRef) firstRef.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

// Click on text rows to highlight + sync reference
document.querySelectorAll('.line-row[data-index]').forEach(row => {
  row.addEventListener('click', () => {
    highlightSourceLine(parseInt(row.dataset.index, 10));
  });
});

// Click on reference rows to highlight + sync source
if (hasReference) {
  document.querySelectorAll('.ref-row[data-ref-index]').forEach(row => {
    row.addEventListener('click', () => {
      clearHighlights();
      row.classList.add('highlighted');
      const ri = parseInt(row.dataset.refIndex, 10);
      const sourceIndices = refToSourceMap[ri] || [];
      sourceIndices.forEach(si => {
        const sourceRow = document.getElementById('line-' + si);
        if (sourceRow) sourceRow.classList.add('highlighted');
      });
      if (sourceIndices.length > 0) {
        const firstSource = document.getElementById('line-' + sourceIndices[0]);
        if (firstSource) firstSource.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });
}

// Filter by status (clickable stat chips)
let activeFilter = null;
function applyFilter(filter) {
  activeFilter = (activeFilter === filter || filter === 'all') ? null : filter;
  document.querySelectorAll('.stat[data-filter]').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.filter === activeFilter);
  });
  document.querySelectorAll('.line-row[data-index]').forEach(row => {
    if (!activeFilter) { row.style.display = ''; return; }
    const line = lineData[parseInt(row.dataset.index, 10)];
    let visible = false;
    if (activeFilter === 'clean') visible = !line.flagged && line.issues.length === 0;
    if (activeFilter === 'flagged') visible = line.flagged;
    if (activeFilter === 'issues') visible = line.issues.length > 0;
    row.style.display = visible ? '' : 'none';
  });
}
document.querySelectorAll('.stat[data-filter]').forEach(chip => {
  chip.addEventListener('click', () => applyFilter(chip.dataset.filter));
});

${hasScores ? `
// Build chart
const ctx = document.getElementById('score-chart');
const datasets = scoreTypes.map(type => ({
  label: scoreLabels[type] || type,
  data: lineData.map(line => line.scores[type] != null ? line.scores[type] : null),
  borderColor: scoreColors[type] || 'rgb(100,100,100)',
  backgroundColor: scoreColors[type] || 'rgb(100,100,100)',
  tension: 0.2,
  spanGaps: false,
  pointRadius: (ctx) => ctx.dataIndex === selectedChartIndex ? 8 : 3,
  pointHoverRadius: 6,
  pointBorderWidth: (ctx) => ctx.dataIndex === selectedChartIndex ? 3 : 0,
  pointBorderColor: (ctx) => ctx.dataIndex === selectedChartIndex ? '#4169e1' : 'transparent',
  pointBackgroundColor: lineData.map(line => {
    if (line.flagged) return 'rgb(220, 20, 60)';
    if (line.issues.length > 0) return 'rgb(255, 140, 0)';
    return scoreColors[type] || 'rgb(100,100,100)';
  }),
}));

const chart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: lineData.map(l => '#' + l.index),
    datasets,
  },
  options: {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    scales: {
      y: { min: 0, max: 100, title: { display: true, text: '%' } },
      x: { ticks: { maxTicksLimit: 30, font: { size: 10 } } },
    },
    plugins: {
      tooltip: {
        callbacks: {
          title: function(items) {
            const line = lineData[items[0].dataIndex];
            return 'Line #' + line.index + (line.flagged ? ' [FLAGGED]' : '');
          },
          afterTitle: function(items) {
            const line = lineData[items[0].dataIndex];
            const parts = [];
            if (line.flagReason) parts.push('Flag: ' + line.flagReason);
            if (line.issues.length > 0) parts.push('Issues: ' + line.issues.map(i => i.category).join(', '));
            return parts.join('\\\\n');
          },
          label: function(ctx) {
            const v = ctx.parsed.y;
            return ctx.dataset.label + ': ' + (v != null ? v.toFixed(1) + '%' : 'n/a');
          },
          afterBody: function(items) {
            const line = lineData[items[0].dataIndex];
            const orig = line.original.length > 60 ? line.original.slice(0, 60) + '...' : line.original;
            return '\\\\n' + orig;
          },
        },
      },
      legend: { position: 'top' },
    },
    onClick: function(event, elements) {
      if (elements.length > 0) {
        highlightSourceLine(elements[0].index);
      }
    },
  },
});
` : ''}
</script>
</body>
</html>`;
}

// ============================
// CLI ENTRY POINT
// ============================

const RUNS_DIR = join(new URL('.', import.meta.url).pathname, '../../runs');

function findLatestCommitDir(configName, episodeName) {
  const episodeDir = join(RUNS_DIR, configName, episodeName);
  if (!existsSync(episodeDir)) return null;

  const entries = readdirSync(episodeDir, { withFileTypes: true })
    .filter(e => e.isDirectory());

  if (entries.length === 0) return null;

  // Find most recently modified directory
  let latest = null;
  let latestTime = 0;
  for (const entry of entries) {
    const dirPath = join(episodeDir, entry.name);
    const mtime = statSync(dirPath).mtimeMs;
    if (mtime > latestTime) {
      latestTime = mtime;
      latest = entry.name;
    }
  }
  return latest;
}

function loadJsonFile(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);

  const configIdx = args.indexOf('--config');
  const configName = configIdx !== -1 ? args[configIdx + 1] : null;
  const episodeIdx = args.indexOf('--episode');
  const episodeName = episodeIdx !== -1 ? args[episodeIdx + 1] : null;
  const commitIdx = args.indexOf('--commit');
  const commitArg = commitIdx !== -1 ? args[commitIdx + 1] : null;

  if (!configName || !episodeName) {
    console.error('Usage: node run-viewer.js --config <name> --episode <name> [--commit <sha>]');
    process.exit(1);
  }

  const commit = commitArg || findLatestCommitDir(configName, episodeName);
  if (!commit) {
    console.error(`No run output found for ${configName}/${episodeName}`);
    process.exit(1);
  }

  const outputDir = join(RUNS_DIR, configName, episodeName, commit);
  if (!existsSync(outputDir)) {
    console.error(`Run directory not found: ${outputDir}`);
    process.exit(1);
  }

  // Load output files
  const translatedOutput = loadJsonFile(join(outputDir, 'output.translated.json'));
  if (!translatedOutput) {
    console.error(`No output.translated.json found in ${outputDir}`);
    process.exit(1);
  }

  const analysisOutput = loadJsonFile(join(outputDir, 'output.analysis.json'));
  const similarityOutput = loadJsonFile(join(outputDir, 'output.similarity.json'));

  // Build line data
  const lines = buildLineData(translatedOutput, analysisOutput, similarityOutput);

  // Discover available score types
  const scoreTypes = [];
  if (similarityOutput?.semantic) scoreTypes.push('semantic');
  if (similarityOutput?.crossLingual) scoreTypes.push('crossLingual');
  if (similarityOutput?.referenceAligned) scoreTypes.push('referenceAligned');

  // Build reference data for the third column (when available)
  let referenceData = null;
  if (similarityOutput?.referenceAligned?.referenceCues) {
    referenceData = { cues: similarityOutput.referenceAligned.referenceCues };
  }

  // Generate HTML
  const metadata = {
    episode: episodeName,
    config: translatedOutput.config,
    stats: translatedOutput.stats,
  };

  const html = generateRunViewerHtml({ lines, metadata, scoreTypes, referenceData });
  const viewerPath = join(outputDir, 'viewer.html');
  writeFileSync(viewerPath, html, 'utf-8');
  console.log(viewerPath);

  if (args.includes('--open')) {
    openInBrowser(viewerPath);
  }
}

if (process.argv[1] && process.argv[1].endsWith('run-viewer.js')) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
