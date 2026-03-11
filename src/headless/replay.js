#!/usr/bin/env node

/**
 * Replay CLI — Re-evaluate existing translations with current validation/analysis rules.
 * No LLM needed. Reads output.translated.json and re-runs the quality pipeline.
 *
 * Usage:
 *   node src/headless/replay.js --config <name> --episode <episode>
 *   node src/headless/replay.js --config <name>  (all episodes)
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { setupJsdom, resolveConfigFile } from './jsdom-setup.js';
setupJsdom();

import { parseTTML } from '../core/parser.js';
import { langToCode } from '../core/providers/definitions.js';
import { runQualityPipeline, writeQualityArtifacts } from './quality-pipeline.js';
import { getGitInfo } from './run-history.js';
import { nodePostJson } from './context.js';

const CONFIGS_DIR = resolve('configs');
const EPISODES_DIRS = [resolve('episodes'), resolve('episodes-local')];
const RUNS_DIR = resolve('runs');

function loadReplayConfig(configName) {
  const configPath = join(CONFIGS_DIR, `${configName}.json`);
  if (!existsSync(configPath)) return {};
  try {
    return resolveConfigFile(configPath, CONFIGS_DIR);
  } catch { return {}; }
}

function usage() {
  console.log(`
Netflix Subtitle Translator — Replay (Re-evaluate with current rules)

Usage:
  node src/headless/replay.js --config <name> --episode <episode>   Re-evaluate one episode
  node src/headless/replay.js --config <name>                       Re-evaluate all episodes
  node src/headless/replay.js --config <name> --commit <sha>        Re-evaluate a specific commit

Re-runs quality analysis on existing output.translated.json files using current
validation and analysis rules. No LLM needed — purely offline re-evaluation.
If embeddingModel is set in the config, runs semantic similarity via Ollama embeddings.

Options:
  --config <name>      Config preset name (required)
  --episode <episode>  Episode name (optional, default: all)
  --commit <sha>       Git commit SHA (optional, default: current HEAD)

Output:
  Updated output.analysis.json and output.evaluation.json
  Quality report with delta vs previous run
`);
}

function findEpisodeDir(episodeName) {
  for (const dir of EPISODES_DIRS) {
    const candidate = join(dir, episodeName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function replayEpisode(configName, episodeName, gitCommit, embeddingOptions) {
  const outputDir = join(RUNS_DIR, configName, episodeName, gitCommit);

  // Find all translated output files (including lang-suffixed ones)
  if (!existsSync(outputDir)) return null;
  const outputFiles = readdirSync(outputDir)
    .filter(f => f.startsWith('output.translated') && f.endsWith('.json'));

  if (outputFiles.length === 0) {
    console.error(`  No translated output found in ${outputDir}`);
    return null;
  }

  const results = [];
  for (const outputFile of outputFiles) {
    const suffix = outputFile.replace('output.translated', '').replace('.json', '');
    const result = await replayTranslation(configName, episodeName, gitCommit, suffix, embeddingOptions);
    if (result) results.push(result);
  }
  return results;
}

async function replayTranslation(configName, episodeName, gitCommit, fileSuffix = '', embeddingOptions = null) {
  const outputDir = join(RUNS_DIR, configName, episodeName, gitCommit);
  const translatedPath = join(outputDir, `output.translated${fileSuffix}.json`);

  if (!existsSync(translatedPath)) {
    console.error(`  No translated output at ${translatedPath}`);
    return null;
  }

  const output = JSON.parse(readFileSync(translatedPath, 'utf-8'));
  console.log(`\n========== ${episodeName}${fileSuffix ? ` (${fileSuffix})` : ''} ==========`);
  console.log(`  Cues: ${output.cues.length}`);

  // Reconstruct cue arrays from saved output
  const translatedCues = output.cues.map(c => ({ begin: c.begin, end: c.end, text: c.translated }));
  const sourceCues = output.originalCues.map(c => ({ begin: c.begin, end: c.end, text: c.text }));
  const flaggedLines = new Set(output.stats?.flaggedLines || []);

  // Try to load reference TTML for time-aligned evaluation
  let referenceCues = null;
  const episodeDir = findEpisodeDir(episodeName);
  if (episodeDir) {
    const targetLang = output.config?.targetLang || 'English';
    const targetCode = langToCode(targetLang);
    const refFile = targetCode ? `${targetCode}.ttml` : null;
    if (refFile && existsSync(join(episodeDir, refFile))) {
      const xml = readFileSync(join(episodeDir, refFile), 'utf-8');
      referenceCues = parseTTML(xml).cues;
      console.log(`  Reference: ${refFile} (${referenceCues.length} cues)`);
    }
  }

  // Run quality pipeline
  const gitInfo = getGitInfo();
  const historyPath = join(RUNS_DIR, configName, 'runs.jsonl');
  const { evaluation, analysisResult, scores, previousScores, runSummary, similarities } = await runQualityPipeline({
    translationOutput: output,
    translatedCues,
    sourceCues,
    flaggedLines,
    referenceCues,
    episodeName,
    gitInfo,
    historyPath,
    embeddingOptions,
  });

  writeQualityArtifacts({
    outputDir, fileSuffix, evaluation, analysisResult, similarities, scores, previousScores, runSummary, episodeName,
    embeddingModel: embeddingOptions?.embeddingModel, crossLingualModel: embeddingOptions?.crossLingualModel,
  });

  return { episode: episodeName, scores };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(0);
  }

  const configIdx = args.indexOf('--config');
  if (configIdx === -1 || !args[configIdx + 1]) {
    console.error('Missing required --config <name> flag.');
    process.exit(1);
  }
  const configName = args[configIdx + 1];

  const episodeIdx = args.indexOf('--episode');
  const episodeName = episodeIdx !== -1 ? args[episodeIdx + 1] : null;

  const commitIdx = args.indexOf('--commit');
  const gitCommit = commitIdx !== -1 ? args[commitIdx + 1] : getGitInfo().commit;

  // Load config for embedding options
  const replayConfig = loadReplayConfig(configName);
  const hasEmbeddings = replayConfig.embeddingModel || replayConfig.crossLingualModel;
  const embeddingOptions = hasEmbeddings
    ? { ollamaUrl: replayConfig.ollamaUrl || 'http://localhost:11434', embeddingModel: replayConfig.embeddingModel, crossLingualModel: replayConfig.crossLingualModel, postJson: nodePostJson }
    : null;

  if (episodeName) {
    console.log(`Replaying: ${episodeName}`);
    await replayEpisode(configName, episodeName, gitCommit, embeddingOptions);
  } else {
    // Discover all episodes for this config
    const configDir = join(RUNS_DIR, configName);
    if (!existsSync(configDir)) {
      console.error(`Runs directory not found: ${configDir}`);
      process.exit(1);
    }
    const episodeDirs = readdirSync(configDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name !== 'runs.jsonl')
      .map(e => e.name)
      .sort();

    let found = false;
    for (const epName of episodeDirs) {
      const commitDir = join(configDir, epName, gitCommit);
      if (!existsSync(commitDir)) continue;
      await replayEpisode(configName, epName, gitCommit, embeddingOptions);
      found = true;
    }

    if (!found) {
      console.error(`No translated output found for commit ${gitCommit}. Run translation first.`);
      process.exit(1);
    }
  }
}

main();
