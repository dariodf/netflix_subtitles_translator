#!/usr/bin/env node

/**
 * Image translation run history — reads image-runs.jsonl and displays a table.
 * Same pattern as run-history.js for subtitle runs.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { readRunHistory } from './run-history.js';
import { RUNS_DIR, padRight, padLeft, fmtPct } from './shared.js';

function formatImageHistoryTable(runs, configName) {
  if (runs.length === 0) return `No image runs found for config: ${configName}`;

  const header = `${padRight('RunId', 28)} ${padRight('Episode', 22)} ${padLeft('Images', 8)} ${padLeft('OK', 5)} ${padLeft('Fail', 5)} ${padLeft('Similarity', 12)} ${padLeft('Time', 8)}  Vision / Translation`;
  const separator = '-'.repeat(header.length);

  const lines = [`Image Run History: ${configName}`, '', header, separator];

  for (const run of runs) {
    const time = run.elapsedSeconds ? `${run.elapsedSeconds.toFixed(0)}s` : 'n/a';
    const models = `${run.visionModel || '?'} → ${run.translationModel || '?'}`;
    lines.push(
      `${padRight(run.runId, 28)} ${padRight(run.episode, 22)} ${padLeft(run.totalImages, 8)} ${padLeft(run.translated, 5)} ${padLeft(run.failed, 5)} ${padLeft(fmtPct(run.averageSimilarity), 12)} ${padLeft(time, 8)}  ${models}`
    );
  }

  return lines.join('\n');
}

// ─── CLI ───

const args = process.argv.slice(2);
const configIdx = args.indexOf('--config');
const configName = configIdx !== -1 ? args[configIdx + 1] : null;

if (!configName) {
  // List all configs that have image-runs.jsonl
  if (!existsSync(RUNS_DIR)) { console.log('No runs directory found.'); process.exit(0); }
  const configs = readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(RUNS_DIR, d.name, 'image-runs.jsonl')))
    .map(d => d.name);

  if (configs.length === 0) {
    console.log('No image run history found. Run image translations first.');
    process.exit(0);
  }

  for (const config of configs) {
    const runs = readRunHistory(join(RUNS_DIR, config, 'image-runs.jsonl'));
    console.log(formatImageHistoryTable(runs, config));
    console.log();
  }
  process.exit(0);
}

const historyPath = join(RUNS_DIR, configName, 'image-runs.jsonl');
const runs = readRunHistory(historyPath);

const episodeIdx = args.indexOf('--episode');
const episodeName = episodeIdx !== -1 ? args[episodeIdx + 1] : null;
const filtered = episodeName ? runs.filter(r => r.episode === episodeName) : runs;

console.log(formatImageHistoryTable(filtered, configName));
