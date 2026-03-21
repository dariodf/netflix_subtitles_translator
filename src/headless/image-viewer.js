/**
 * Image translation viewer — self-contained HTML visualization.
 * Shows original image (full width) with OCR and translation columns below.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { escapeHtml } from '../core/utils.js';
import { openInBrowser } from './run-history.js';
import { EPISODES_DIRS, RUNS_DIR } from './shared.js';


function findLatestRun(configName, episodeName) {
  const episodeRunDir = join(RUNS_DIR, configName, episodeName, 'images');
  if (!existsSync(episodeRunDir)) return null;
  const commits = readdirSync(episodeRunDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse();
  return commits[0] ? join(episodeRunDir, commits[0]) : null;
}

function mimeType(filename) {
  const ext = extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

export function generateImageViewerHtml(translationsData, episodeDir) {
  const results = translationsData.results || [];
  const config = translationsData.config || {};

  const cards = results.map((result) => {
    const hasError = !!result.error;
    const noText = !!result.noText;

    // Embed image as base64 data URI
    let imageDataUri = '';
    if (episodeDir) {
      const imagePath = join(episodeDir, 'images', result.file);
      if (existsSync(imagePath)) {
        const imageBuffer = readFileSync(imagePath);
        const mime = mimeType(result.file);
        imageDataUri = `data:${mime};base64,${imageBuffer.toString('base64')}`;
      }
    }

    // Split OCR and translation by lines for per-sentence display
    const ocrLines = (result.ocrText || '').split('\n').filter(l => l.trim());
    const translatedLines = (result.translatedText || '').split('\n').filter(l => l.trim());

    let statusBadge = '';
    if (hasError) statusBadge = '<span class="badge error">Error</span>';
    else if (noText) statusBadge = '<span class="badge no-text">No Text</span>';

    const scores = result.scores || [];

    const ocrHtml = ocrLines.length > 0
      ? ocrLines.map(l => `<div class="line">${escapeHtml(l)}</div>`).join('')
      : '<div class="line empty">—</div>';

    const translatedHtml = translatedLines.length > 0
      ? translatedLines.map((l, idx) => {
          const score = scores[idx];
          const scoreHtml = score
            ? `<span class="score" style="color:${score.similarity >= 90 ? '#27ae60' : score.similarity >= 70 ? '#f39c12' : '#e74c3c'}">${score.similarity}%</span>`
            : '';
          return `<div class="line">${escapeHtml(l)} ${scoreHtml}</div>`;
        }).join('')
      : hasError
        ? `<div class="line error">${escapeHtml(result.error)}</div>`
        : '<div class="line empty">—</div>';

    const avgHtml = result.averageSimilarity != null
      ? `<span class="badge" style="background:${result.averageSimilarity >= 90 ? '#27ae6033' : result.averageSimilarity >= 70 ? '#f39c1233' : '#e74c3c33'};color:${result.averageSimilarity >= 90 ? '#27ae60' : result.averageSimilarity >= 70 ? '#f39c12' : '#e74c3c'}">${result.averageSimilarity}%</span>`
      : '';

    return `
    <div class="card">
      <div class="card-header">
        <span class="file-name">${escapeHtml(result.file)}</span>
        ${avgHtml}
        ${statusBadge}
      </div>
      ${imageDataUri ? `<div class="image-container"><img src="${imageDataUri}" alt="${escapeHtml(result.file)}"></div>` : ''}
      <div class="columns">
        <div class="column ocr">
          <div class="column-header">OCR (Original)</div>
          ${ocrHtml}
        </div>
        <div class="column translation">
          <div class="column-header">Translation</div>
          ${translatedHtml}
        </div>
      </div>
    </div>`;
  }).join('\n');

  const stats = translationsData.stats || {};

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Image Translations — ${escapeHtml(translationsData.episode || '')}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1a1a2e; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; }
  h1 { font-size: 1.4em; margin-bottom: 8px; color: #fff; }
  .meta { font-size: 0.85em; color: #888; margin-bottom: 24px; }
  .meta span { margin-right: 16px; }
  .card { background: #16213e; border-radius: 8px; margin-bottom: 24px; overflow: hidden; max-width: 900px; margin-left: auto; margin-right: auto; }
  .card-header { padding: 12px 16px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #0f3460; }
  .file-name { font-weight: 600; font-size: 0.95em; }
  .badge { font-size: 0.75em; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
  .badge.error { background: #e74c3c33; color: #e74c3c; }
  .badge.no-text { background: #f39c1233; color: #f39c12; }
  .image-container { width: 100%; }
  .image-container img { width: 100%; max-height: 60vh; object-fit: contain; display: block; background: #000; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; }
  .column { padding: 16px; }
  .column.ocr { border-right: 1px solid #0f3460; }
  .column-header { font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 10px; }
  .line { padding: 4px 0; font-size: 0.95em; line-height: 1.5; }
  .line.empty { color: #555; }
  .line.error { color: #e74c3c; font-size: 0.85em; }
  .score { font-size: 0.8em; font-weight: 600; margin-left: 8px; }
</style>
</head>
<body>
<h1>Image Translations — ${escapeHtml(translationsData.episode || '')}</h1>
<div class="meta">
  <span>Vision: ${escapeHtml(config.visionProvider || '')}/${escapeHtml(config.visionModel || '')}</span>
  <span>Translation: ${escapeHtml(config.provider || '')}/${escapeHtml(config.model || '')} → ${escapeHtml(config.targetLang || '')}</span>
  <span>${stats.totalImages || 0} images, ${stats.translated || 0} translated, ${stats.noText || 0} no text, ${stats.failed || 0} failed</span>
</div>
${cards}
</body>
</html>`;
}

// ─── CLI ───

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Image Translation Viewer

Usage:
  node src/headless/image-viewer.js --config <name> --episode <episode> [--commit <hash>] [--open]
`);
  process.exit(0);
}

const configIdx = args.indexOf('--config');
const episodeIdx = args.indexOf('--episode');
const commitIdx = args.indexOf('--commit');
const shouldOpen = args.includes('--open');

if (configIdx === -1 || episodeIdx === -1) {
  console.error('--config and --episode are required');
  process.exit(1);
}

const configName = args[configIdx + 1];
const episodeName = args[episodeIdx + 1];
const commitHash = commitIdx !== -1 ? args[commitIdx + 1] : null;

const runDir = commitHash
  ? join(RUNS_DIR, configName, episodeName, 'images', commitHash)
  : findLatestRun(configName, episodeName);

if (!runDir || !existsSync(runDir)) {
  console.error(`No image run found for ${configName}/${episodeName}/images/${commitHash || 'latest'}`);
  process.exit(1);
}

const translationsPath = join(runDir, 'output.image-translations.json');
if (!existsSync(translationsPath)) {
  console.error(`No output.image-translations.json in ${runDir}`);
  process.exit(1);
}

const translationsData = JSON.parse(readFileSync(translationsPath, 'utf-8'));

// Find episode dir for embedding images
let episodeDir = null;
for (const dir of EPISODES_DIRS) {
  const candidate = join(dir, episodeName);
  if (existsSync(candidate)) { episodeDir = candidate; break; }
}

const html = generateImageViewerHtml(translationsData, episodeDir);
const outputPath = join(runDir, 'output.image-viewer.html');
writeFileSync(outputPath, html, 'utf-8');
console.log(`Viewer: ${outputPath}`);

if (shouldOpen) openInBrowser(outputPath);
