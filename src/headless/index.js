#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { setupJsdom } from './jsdom-setup.js';
setupJsdom();

import { parseTTML, extractLanguageCode } from '../core/parser.js';
import { langToCode } from '../core/providers/definitions.js';
import { translateTtml } from '../pipeline/handler.js';
import { createHeadlessContext, nodePostJson } from './context.js';
import { runQualityPipeline, writeQualityArtifacts } from './quality-pipeline.js';
import { getGitInfo } from './run-history.js';
import { DEFAULT_CONFIG, RUNS_DIR, loadConfig, findEpisodeDir, discoverEpisodes, loadEpisodeMetadata } from './shared.js';

function usage() {
  console.log(`
Netflix Subtitle Translator — Headless CLI

Episode mode:
  node src/headless/index.js --config <name>                          Translate all episodes
  node src/headless/index.js --config <name> --episode <episode>      Translate one episode
  node src/headless/index.js --config <name> --episode <ep> --source-lang ko   Use specific source
  node src/headless/index.js --config <name> --evaluate-only          Re-evaluate only

Legacy mode:
  node src/headless/index.js <file.ttml> [config.json]

Folder structure:
  episodes/
    show-s01e05/
      en.ttml              Source language (ISO code filename)
      es.ttml              Reference target
      metadata.json        Optional show/episode metadata

  configs/
    <preset-name>.json     Translation settings for this preset

Output (written to runs/<preset>/<episode>/<commit>/):
  output.translated.json   Full translation results
  output.evaluation.json   Comparison against reference
  output.debug.json        LLM request/response pairs
  output.analysis.json     Quality analysis

How to download subtitles:
  1. Open Netflix in Chrome, play the episode
  2. Open DevTools (F12) > Network tab
  3. Filter by "?o=" to find subtitle requests
  4. Right-click response > "Copy response" > save as <iso-code>.ttml
     (en for English, es for Spanish, ja for Japanese, etc.)

How to get metadata (optional):
  1. In DevTools Network tab, filter by "metadata?movieid="
  2. Copy the JSON response > save as metadata.json in the episode folder
  3. Or create manually: { "title": "Show Name", "type": "series",
     "episode": { "season": 1, "episode": 5, "title": "Episode Title" } }
`);
}

// ─── Legacy mode (single file) ───

async function runLegacy(ttmlPath, configPath) {
  let xml;
  try {
    xml = readFileSync(ttmlPath, 'utf-8');
  } catch (err) {
    console.error(`Error reading TTML file: ${err.message}`);
    process.exit(1);
  }

  let userConfig = {};
  if (configPath) {
    try {
      userConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (err) {
      console.error(`Error reading config file: ${err.message}`);
      process.exit(1);
    }
  }

  const config = { ...DEFAULT_CONFIG, ...userConfig };
  const cachePath = ttmlPath.replace(/\.[^.]+$/, '') + '.cache.json';
  const context = createHeadlessContext(config, { cachePath });

  console.log(`Translating via ${config.provider}/${config.model} → ${config.targetLang}`);
  const startTime = Date.now();

  try {
    const result = await translateTtml(xml, context);
    if (result.skipped) {
      console.log('Skipped — no cues or already in target language.');
      return;
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const sourceCues = result.originalCues;

    const outputPath = ttmlPath.replace(/\.[^.]+$/, '') + '.translated.json';
    const output = {
      source: ttmlPath,
      config: { provider: config.provider, model: config.model, targetLang: config.targetLang },
      systemPrompt: result.systemPrompt || null,
      stats: {
        totalCues: sourceCues.length,
        flaggedLines: [...result.flaggedLines],
        flaggedCount: result.flaggedLines.size,
        glossaryTerms: result.glossaryTerms.size,
        elapsedSeconds: parseFloat(elapsed),
        normalizedSpeakerNames: result.normalizedSpeakerNames || 0,
      },
      originalCues: sourceCues.map((cue, i) => ({
        index: i,
        begin: cue.begin,
        end: cue.end,
        text: cue.text,
      })),
      cues: result.translatedCues.map((cue, i) => ({
        index: i,
        begin: cue.begin,
        end: cue.end,
        original: sourceCues[i].text,
        translated: cue.text,
        flagged: result.flaggedLines.has(i),
        flagReason: result.flagReasons?.get(i) || null,
      })),
    };

    writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

    // Write debug log (LLM request/response pairs) if any were captured
    if (result.debugLog && result.debugLog.length > 0) {
      const debugPath = ttmlPath.replace(/\.[^.]+$/, '') + '.debug.json';
      writeFileSync(debugPath, JSON.stringify(result.debugLog, null, 2), 'utf-8');
      console.log(`Debug log: ${result.debugLog.length} LLM requests → ${debugPath}`);
    }

    console.log(`\nDone in ${elapsed}s`);
    console.log(`   ${sourceCues.length} cues translated`);
    console.log(`   ${result.flaggedLines.size} flagged lines`);
    console.log(`   ${result.glossaryTerms.size} glossary terms`);
    console.log(`   Output: ${outputPath}`);
  } catch (err) {
    console.error(`\nTranslation failed after ${((Date.now() - startTime) / 1000).toFixed(1)}s:`);
    console.error(err);
    process.exit(1);
  }
}

// ─── Episode mode ───

// discoverEpisodes with exit-on-empty (CLI behavior)
function discoverEpisodesOrExit() {
  const episodes = discoverEpisodes();
  if (episodes.length === 0) {
    console.error('No episode directories found in episodes/ or episodes-local/');
    console.error('Create an episodes/ folder with episode subfolders containing TTML files.');
    process.exit(1);
  }
  return episodes;
}

function listTtmlFiles(episodeDir) {
  return readdirSync(episodeDir)
    .filter(f => f.toLowerCase().endsWith('.ttml'));
}

async function runEpisode(episodeName, config, configName, evaluateOnly, sourceLangOverride = null) {
  const episodeDir = findEpisodeDir(episodeName);
  if (!episodeDir) {
    console.error(`Episode folder not found: ${episodeName} (searched episodes/ and episodes-local/)`);
    return null;
  }

  // Output goes to runs/<config>/<episode>/<commit>/
  const gitInfo = getGitInfo();
  const outputDir = join(RUNS_DIR, configName, episodeName, gitInfo.commit);
  mkdirSync(outputDir, { recursive: true });

  console.log(`\n========== ${episodeName} ==========`);

  const ttmlFiles = listTtmlFiles(episodeDir);
  if (ttmlFiles.length === 0) {
    console.error(`No TTML files in ${episodeDir}`);
    return null;
  }

  // Identify source and reference files by language
  const targetCode = langToCode(config.targetLang);
  let sourceFile = null;
  let referenceFile = null;
  let sourceTtmlLang = '';

  for (const file of ttmlFiles) {
    const xml = readFileSync(join(episodeDir, file), 'utf-8');
    const code = extractLanguageCode(xml) || file.replace(/\.ttml$/i, '').toLowerCase();

    if (code === targetCode) {
      referenceFile = file;
    } else if (!sourceFile) {
      if (sourceLangOverride) {
        const wantedCode = langToCode(sourceLangOverride);
        if (code === wantedCode) {
          sourceFile = file;
          sourceTtmlLang = code;
        }
      } else {
        sourceFile = file;
        sourceTtmlLang = code;
      }
    }
  }

  // When source language is explicitly set, suffix output files with ISO code (e.g., .ko)
  const fileSuffix = sourceLangOverride ? `.${sourceTtmlLang}` : '';

  if (!sourceFile) {
    console.error(`No source language file found in ${episodeDir}`);
    console.error(`  Available: ${ttmlFiles.join(', ')}`);
    console.error(`  Target language: ${config.targetLang}`);
    return null;
  }

  const episodeConfig = { ...config };
  if (sourceLangOverride) {
    episodeConfig.sourceLang = sourceLangOverride;
  }

  // Load episode metadata if available
  const showMetadata = loadEpisodeMetadata(episodeDir);
  if (showMetadata) {
    episodeConfig.showMetadata = true;
    console.log(`  Metadata: ${showMetadata.title || 'loaded'}${showMetadata.episode ? ` S${showMetadata.episode.season}E${showMetadata.episode.episode}` : ''}`);
  }

  console.log(`  Source: ${sourceFile} (${episodeConfig.sourceLang || sourceTtmlLang || 'auto'})`);
  console.log(`  Reference: ${referenceFile || 'none'}`);

  // Read source TTML (pipeline handles parsing)
  const sourceXml = readFileSync(join(episodeDir, sourceFile), 'utf-8');

  // Parse reference TTML (if present)
  let referenceCues = null;
  if (referenceFile) {
    const refXml = readFileSync(join(episodeDir, referenceFile), 'utf-8');
    const parsed = parseTTML(refXml);
    referenceCues = parsed.cues;
    console.log(`  Reference cues: ${referenceCues.length}`);
  }

  const translatedOutputPath = join(outputDir, `output.translated${fileSuffix}.json`);
  let result;
  let sourceCues;
  let elapsed;
  let existing;
  if (evaluateOnly) {
    // Load existing translation output
    if (!existsSync(translatedOutputPath)) {
      console.error(`  No existing translation output found. Run translation first.`);
      return null;
    }
    existing = JSON.parse(readFileSync(translatedOutputPath, 'utf-8'));
    result = {
      translatedCues: existing.cues.map(c => ({ begin: c.begin, end: c.end, text: c.translated })),
      flaggedLines: new Set(existing.stats.flaggedLines),
      glossaryTerms: new Map(),
    };
    sourceCues = existing.originalCues.map(c => ({ begin: c.begin, end: c.end, text: c.text }));
    elapsed = existing.stats.elapsedSeconds;
    console.log(`  Loaded existing translation (${existing.cues.length} cues, ${elapsed}s)`);
  } else {
    // Run translation with incremental caching for crash-resume
    const cachePath = join(outputDir, `cache${fileSuffix}.json`);
    const context = createHeadlessContext(episodeConfig, { cachePath, showMetadata });

    console.log(`  Translating via ${episodeConfig.provider}/${episodeConfig.model} → ${episodeConfig.targetLang}`);
    const startTime = Date.now();

    try {
      result = await translateTtml(sourceXml, context);
      elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    } catch (err) {
      elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`  Translation failed after ${elapsed}s:`, err.message);
      return null;
    }

    if (result.skipped) {
      console.log('  Skipped — no cues or already in target language.');
      return null;
    }

    sourceCues = result.originalCues;
    console.log(`  Source cues: ${sourceCues.length}`);

    // Write translation output
    const output = {
      source: sourceFile,
      episode: episodeName,
      config: {
        provider: episodeConfig.provider,
        model: episodeConfig.model,
        targetLang: episodeConfig.targetLang,
        sourceLang: episodeConfig.sourceLang,
      },
      systemPrompt: result.systemPrompt || null,
      stats: {
        totalCues: sourceCues.length,
        flaggedLines: [...result.flaggedLines],
        flaggedCount: result.flaggedLines.size,
        glossaryTerms: result.glossaryTerms.size,
        glossaryElapsedMs: result.glossaryElapsedMs || 0,
        elapsedSeconds: parseFloat(elapsed),
        firstChunkMetrics: result.firstChunkMetrics || null,
        normalizedSpeakerNames: result.normalizedSpeakerNames || 0,
      },
      originalCues: sourceCues.map((cue, i) => ({
        index: i,
        begin: cue.begin,
        end: cue.end,
        text: cue.text,
      })),
      cues: result.translatedCues.map((cue, i) => ({
        index: i,
        begin: cue.begin,
        end: cue.end,
        original: sourceCues[i].text,
        translated: cue.text,
        flagged: result.flaggedLines.has(i),
        flagReason: result.flagReasons?.get(i) || null,
      })),
    };

    writeFileSync(translatedOutputPath, JSON.stringify(output, null, 2), 'utf-8');

    // Write debug log (LLM request/response pairs) if any were captured
    if (result.debugLog && result.debugLog.length > 0) {
      const debugPath = join(outputDir, `output.debug${fileSuffix}.json`);
      writeFileSync(debugPath, JSON.stringify(result.debugLog, null, 2), 'utf-8');
      console.log(`  Debug log: ${result.debugLog.length} LLM requests → ${outputDir}`);
    }

    if (result.firstChunkMetrics) {
      const fc = result.firstChunkMetrics;
      const coveredSeconds = ((fc.endMs - fc.beginMs) / 1000).toFixed(1);
      const glossaryMs = result.glossaryElapsedMs || 0;
      const glossaryBreakdown = glossaryMs > 0
        ? ` (glossary: ${(glossaryMs / 1000).toFixed(1)}s + translate: ${((fc.elapsedMs - glossaryMs) / 1000).toFixed(1)}s)`
        : '';
      console.log(`  TTFC: ${(fc.elapsedMs / 1000).toFixed(1)}s → ${fc.cueCount} cues covering ${coveredSeconds}s${fc.fastStart ? ' (fast start)' : ''}${glossaryBreakdown}`);
    }
    console.log(`  Done in ${elapsed}s — ${result.flaggedLines.size} flagged, ${result.glossaryTerms.size} glossary terms`);
    console.log(`  Output: ${outputDir}`);
  }

  // Build translation output object for scoring (needed for both fresh and evaluate-only)
  const translationOutput = evaluateOnly
    ? existing
    : {
        source: sourceFile,
        episode: episodeName,
        config: {
          provider: episodeConfig.provider,
          model: episodeConfig.model,
          targetLang: episodeConfig.targetLang,
          sourceLang: episodeConfig.sourceLang,
          secondModel: episodeConfig.secondEnabled ? episodeConfig.secondModel : '',
        },
        stats: {
          totalCues: sourceCues.length,
          flaggedLines: [...result.flaggedLines],
          flaggedCount: result.flaggedLines.size,
          elapsedSeconds: parseFloat(elapsed),
        },
      };

  // Quality pipeline: evaluate, analyze, score, record history
  const historyPath = join(RUNS_DIR, configName, 'runs.jsonl');
  const hasEmbeddings = episodeConfig.embeddingModel || episodeConfig.crossLingualModel;
  const embeddingOptions = hasEmbeddings
    ? { ollamaUrl: episodeConfig.ollamaUrl, embeddingModel: episodeConfig.embeddingModel, crossLingualModel: episodeConfig.crossLingualModel, postJson: nodePostJson }
    : null;
  const { evaluation, analysisResult, scores, previousScores, runSummary, similarities } = await runQualityPipeline({
    translationOutput,
    translatedCues: result.translatedCues,
    sourceCues,
    flaggedLines: result.flaggedLines,
    referenceCues,
    episodeName,
    gitInfo,
    historyPath,
    embeddingOptions,
  });

  writeQualityArtifacts({
    outputDir, fileSuffix, evaluation, analysisResult, similarities, scores, previousScores, runSummary, episodeName,
    embeddingModel: episodeConfig.embeddingModel, crossLingualModel: episodeConfig.crossLingualModel,
  });

  return {
    episode: episodeName,
    elapsed: parseFloat(elapsed),
    totalCues: sourceCues.length,
    flaggedCount: result.flaggedLines.size,
    evaluation,
    scores,
  };
}

function printAggregateSummary(results) {
  const valid = results.filter(r => r !== null);
  if (valid.length <= 1) return;

  console.log('\n========== Aggregate Summary ==========');
  console.log(`  Episodes: ${valid.length}`);

  const totalTime = valid.reduce((sum, r) => sum + r.elapsed, 0);
  console.log(`  Total time: ${totalTime.toFixed(1)}s`);

  const totalCues = valid.reduce((sum, r) => sum + r.totalCues, 0);
  console.log(`  Total cues: ${totalCues}`);

  const totalFlagged = valid.reduce((sum, r) => sum + r.flaggedCount, 0);
  console.log(`  Total flagged: ${totalFlagged}`);

  const withScores = valid.filter(r => r.scores?.qualityScore !== null);
  if (withScores.length > 0) {
    const avgQuality = withScores.reduce((sum, r) => sum + r.scores.qualityScore, 0) / withScores.length;
    console.log(`  Average quality: ${avgQuality.toFixed(1)}%`);
  }
}

// ─── Main ───

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(0);
  }

  // Detect legacy mode: first arg is a .ttml file
  if (args.length > 0 && args[0].endsWith('.ttml')) {
    await runLegacy(args[0], args[1]);
    return;
  }

  // Episode mode — requires --config
  const configIdx = args.indexOf('--config');
  if (configIdx === -1 || !args[configIdx + 1]) {
    console.error('Missing required --config <name> flag.');
    console.error('Usage: node src/headless/index.js --config <preset-name> [--episode <name>] [--evaluate-only]');
    process.exit(1);
  }
  const configName = args[configIdx + 1];

  const evaluateOnly = args.includes('--evaluate-only');
  const episodeIdx = args.indexOf('--episode');
  const episodeName = episodeIdx !== -1 ? args[episodeIdx + 1] : null;
  const sourceLangIdx = args.indexOf('--source-lang');
  const sourceLangOverride = sourceLangIdx !== -1 ? args[sourceLangIdx + 1] : null;

  const config = loadConfig(configName);

  let episodeNames;
  if (episodeName) {
    episodeNames = [episodeName];
  } else {
    episodeNames = discoverEpisodesOrExit();
    if (episodeNames.length === 0) {
      console.error('No episode folders found in episodes/');
      process.exit(1);
    }
  }

  console.log(`Config: ${configName}`);
  console.log(`Provider: ${config.provider}/${config.model}`);
  console.log(`Target: ${config.targetLang}`);
  if (config.secondEnabled) {
    console.log(`Second model: ${config.secondProvider}/${config.secondModel}`);
  }
  console.log(`Episodes: ${episodeNames.join(', ')}`);
  if (evaluateOnly) {
    console.log('Mode: evaluate-only (no retranslation)');
  }

  const results = [];
  for (const name of episodeNames) {
    const result = await runEpisode(name, config, configName, evaluateOnly, sourceLangOverride);
    results.push(result);
  }

  printAggregateSummary(results);
}

main();
