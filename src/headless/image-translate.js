#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { setupJsdom } from './jsdom-setup.js';
setupJsdom();

import { PROVIDERS } from '../core/providers/definitions.js';
import { buildOcrPrompt, NO_TEXT } from '../core/vision-prompts.js';
import { translateChunkLLM } from '../pipeline/translate.js';
import { createHeadlessContext, nodePostJson } from './context.js';
import { getGitInfo, generateRunId, appendRunToHistory } from './run-history.js';
import { computeEmbeddings, cosineSimilarity } from './evaluate.js';
import { generateImageViewerHtml } from './image-viewer.js';
import { EPISODES_DIRS, RUNS_DIR, loadConfig, findEpisodeDir, loadEpisodeMetadata } from './shared.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function usage() {
  console.log(`
Netflix Subtitle Translator — Headless Image Translation CLI

Usage:
  node src/headless/image-translate.js --config <name>                       Translate all episodes' images
  node src/headless/image-translate.js --config <name> --episode <episode>   Translate one episode's images

Folder structure:
  episodes/<episode>/images/     Image files (jpg/png/webp)
  episodes/<episode>/metadata.json   Optional show metadata (shared with subtitles)

Output (written to runs/<preset>/<episode>/images/<commit>/):
  output.image-translations.json   [{ file, ocrText, translatedText }]
`);
}

function discoverEpisodesWithImages() {
  const episodes = [];
  for (const dir of EPISODES_DIRS) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const imagesDir = join(dir, entry.name, 'images');
      if (existsSync(imagesDir)) {
        const imageFiles = readdirSync(imagesDir).filter(f => IMAGE_EXTENSIONS.has(extname(f).toLowerCase()));
        if (imageFiles.length > 0) episodes.push(entry.name);
      }
    }
  }
  return [...new Set(episodes)].sort();
}

function listImageFiles(episodeDir) {
  const imagesDir = join(episodeDir, 'images');
  if (!existsSync(imagesDir)) return [];
  return readdirSync(imagesDir)
    .filter(f => IMAGE_EXTENSIONS.has(extname(f).toLowerCase()))
    .sort();
}

function resolveVisionProvider(config) {
  const providerKey = config.imageVisionProvider || config.provider;
  const provider = PROVIDERS[providerKey];
  if (!provider) {
    throw new Error(`Unknown vision provider: ${providerKey}`);
  }
  if (!provider.supportsVision) {
    throw new Error(`Provider "${providerKey}" does not support vision. Use a vision-capable provider (ollama, gemini, anthropic, groq, openrouter).`);
  }

  const model = config.imageVisionModel || config.model;
  const apiKey = config.imageVisionApiKey || config.apiKey;

  return { providerKey, provider, model, apiKey };
}

function buildVisionUrl(provider, providerKey, config, model, apiKey) {
  let url = provider.url;
  if (providerKey === 'ollama') {
    url = config.ollamaUrl.replace(/\/+$/, '') + '/api/chat';
  }
  const req = provider.buildVisionRequest('', '', model, apiKey);
  if (req.urlSuffix) url = url + req.urlSuffix;
  return url;
}

async function callVisionOcr(imageBase64, config) {
  const { providerKey, provider, model, apiKey } = resolveVisionProvider(config);
  const sourceLang = config.imageSourceLang || config.sourceLang || '';
  const prompt = buildOcrPrompt(sourceLang);

  const requestData = provider.buildVisionRequest(imageBase64, prompt, model, apiKey);
  const url = buildVisionUrl(provider, providerKey, config, model, apiKey);

  const { status, data } = await nodePostJson(url, requestData.headers, requestData.data, 120000);
  if (status < 200 || status >= 300) {
    throw new Error(`Vision request failed with status ${status}: ${JSON.stringify(data)}`);
  }

  return provider.extractText(data);
}

async function runEpisodeImages(episodeName, config, configName) {
  const episodeDir = findEpisodeDir(episodeName);
  if (!episodeDir) {
    console.error(`Episode folder not found: ${episodeName}`);
    return null;
  }

  const imageFiles = listImageFiles(episodeDir);
  if (imageFiles.length === 0) {
    console.log(`  No images found in ${episodeName}/images/`);
    return null;
  }

  const gitInfo = getGitInfo();
  const outputDir = join(RUNS_DIR, configName, episodeName, 'images', gitInfo.commit);
  mkdirSync(outputDir, { recursive: true });

  console.log(`\n========== ${episodeName} (images) ==========`);
  console.log(`  Images: ${imageFiles.length}`);

  const { providerKey, model } = resolveVisionProvider(config);
  console.log(`  Vision: ${providerKey}/${model}`);
  console.log(`  Translation: ${config.provider}/${config.model} → ${config.targetLang}`);

  const showMetadata = loadEpisodeMetadata(episodeDir);
  if (showMetadata) {
    console.log(`  Metadata: ${showMetadata.title || 'loaded'}${showMetadata.episode ? ` S${showMetadata.episode.season}E${showMetadata.episode.episode}` : ''}`);
  }

  const context = createHeadlessContext(config, { showMetadata });
  const results = [];
  const startTime = Date.now();

  for (const file of imageFiles) {
    const filePath = join(episodeDir, 'images', file);
    const imageBuffer = readFileSync(filePath);
    const imageBase64 = imageBuffer.toString('base64');

    console.log(`\n  📷 ${file}`);

    // Step 1: OCR via vision LLM
    let ocrText;
    try {
      ocrText = await callVisionOcr(imageBase64, config);
    } catch (err) {
      console.error(`    ❌ OCR failed: ${err.message}`);
      results.push({ file, ocrText: null, translatedText: null, error: err.message });
      continue;
    }

    if (!ocrText || ocrText.trim() === NO_TEXT) {
      console.log(`    No text detected`);
      results.push({ file, ocrText: '', translatedText: '', noText: true });
      continue;
    }

    console.log(`    OCR: ${ocrText.replace(/\n/g, ' | ')}`);

    // Step 2: Translate via the pipeline
    // Encode line breaks as emdash (same as subtitle cues) so the pipeline preserves them
    const encodedText = ocrText.replace(/\n/g, '—');
    const cue = { begin: 0, end: 3000, text: encodedText };
    let translatedText;
    try {
      const [translated] = await translateChunkLLM([cue], [], 0, context);
      // Decode emdashes back to line breaks for output
      translatedText = translated.replace(/—/g, '\n');
    } catch (err) {
      console.error(`    ❌ Translation failed: ${err.message}`);
      results.push({ file, ocrText, translatedText: null, error: err.message });
      continue;
    }

    console.log(`    Translation: ${translatedText.replace(/\n/g, ' | ')}`);
    results.push({ file, ocrText, translatedText });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successful = results.filter(r => r.translatedText != null && !r.noText).length;
  const noText = results.filter(r => r.noText).length;
  const failed = results.filter(r => r.error).length;

  console.log(`\n  Done in ${elapsed}s — ${successful} translated, ${noText} no text, ${failed} failed`);

  // Step 3: Per-sentence cross-lingual similarity scoring
  const crossLingualModel = config.crossLingualModel || config.embeddingModel;
  const scorableResults = results.filter(r => r.ocrText && r.translatedText && !r.noText && !r.error);
  if (crossLingualModel && scorableResults.length > 0) {
    console.log(`\n  Scoring ${scorableResults.length} images via ${crossLingualModel}...`);
    const ollamaUrl = config.ollamaUrl?.replace(/\/+$/, '') || 'http://localhost:11434';
    for (const result of scorableResults) {
      const ocrLines = result.ocrText.split('\n').filter(l => l.trim());
      const transLines = result.translatedText.split('\n').filter(l => l.trim());
      const pairCount = Math.min(ocrLines.length, transLines.length);
      if (pairCount === 0) continue;

      try {
        const allTexts = [...ocrLines.slice(0, pairCount), ...transLines.slice(0, pairCount)];
        const embeddings = await computeEmbeddings(allTexts, ollamaUrl, crossLingualModel, nodePostJson);
        const scores = [];
        for (let i = 0; i < pairCount; i++) {
          const sim = cosineSimilarity(embeddings[i], embeddings[pairCount + i]);
          scores.push({ ocr: ocrLines[i], translation: transLines[i], similarity: Math.round(sim * 10000) / 100 });
        }
        result.scores = scores;
        const avg = scores.reduce((s, x) => s + x.similarity, 0) / scores.length;
        result.averageSimilarity = Math.round(avg * 100) / 100;
        console.log(`    ${result.file}: ${result.averageSimilarity}% avg (${scores.map(s => s.similarity + '%').join(', ')})`);
      } catch (err) {
        console.warn(`    ${result.file}: scoring failed — ${err.message}`);
      }
    }
  }

  // Write output
  const outputPath = join(outputDir, 'output.image-translations.json');
  const output = {
    episode: episodeName,
    config: { provider: config.provider, model: config.model, targetLang: config.targetLang, visionProvider: providerKey, visionModel: model },
    stats: { totalImages: imageFiles.length, translated: successful, noText, failed, elapsedSeconds: parseFloat(elapsed) },
    results,
  };
  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`  Output: ${outputPath}`);

  // Auto-generate viewer HTML alongside the JSON
  const viewerHtml = generateImageViewerHtml(output, episodeDir);
  const viewerPath = join(outputDir, 'output.image-viewer.html');
  writeFileSync(viewerPath, viewerHtml, 'utf-8');
  console.log(`  Viewer: ${viewerPath}`);

  // Append to image run history
  const avgScores = scorableResults.filter(r => r.averageSimilarity != null);
  const overallAvg = avgScores.length > 0
    ? Math.round(avgScores.reduce((s, r) => s + r.averageSimilarity, 0) / avgScores.length * 100) / 100
    : null;
  const historyPath = join(RUNS_DIR, configName, 'image-runs.jsonl');
  const runSummary = {
    runId: generateRunId(Date.now(), gitInfo.commit),
    episode: episodeName,
    commit: gitInfo.commit,
    commitMessage: gitInfo.commitMessage,
    visionProvider: providerKey,
    visionModel: model,
    translationModel: config.model,
    targetLang: config.targetLang,
    totalImages: imageFiles.length,
    translated: successful,
    noText,
    failed,
    averageSimilarity: overallAvg,
    elapsedSeconds: parseFloat(elapsed),
  };
  appendRunToHistory(historyPath, runSummary);

  return output;
}

// ─── Main ───

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  usage();
  process.exit(0);
}

const configIdx = args.indexOf('--config');
if (configIdx === -1 || !args[configIdx + 1]) {
  console.error('--config <name> is required');
  process.exit(1);
}
const configName = args[configIdx + 1];
const config = loadConfig(configName);

// Validate vision provider is configured
try {
  resolveVisionProvider(config);
} catch (err) {
  console.error(`Vision configuration error: ${err.message}`);
  console.error(`Set "imageVisionModel" in configs/${configName}.json or use a vision-capable provider.`);
  process.exit(1);
}

const episodeIdx = args.indexOf('--episode');
const episodeName = episodeIdx !== -1 ? args[episodeIdx + 1] : null;

(async () => {
  if (episodeName) {
    await runEpisodeImages(episodeName, config, configName);
  } else {
    const episodes = discoverEpisodesWithImages();
    if (episodes.length === 0) {
      console.error('No episodes with images/ subfolders found in episodes/ or episodes-local/');
      process.exit(1);
    }
    console.log(`Found ${episodes.length} episode(s) with images: ${episodes.join(', ')}`);
    for (const ep of episodes) {
      await runEpisodeImages(ep, config, configName);
    }
  }
})();
