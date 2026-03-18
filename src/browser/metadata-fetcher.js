import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { sleep } from '../core/utils.js';
import { logInfo, logWarn } from '../core/utils.js';
import { buildContextFromNetflix } from '../core/metadata.js';

// ============================
// SHOW METADATA (Cinemeta / Netflix metadata)
// ============================
let _showMetadata = null;
let _showMetadataPath = null;
let _showMetadataPromise = null;

export function getShowMetadata() {
  return _showMetadata;
}

export function clearShowMetadata() {
  _showMetadata = null;
  _showMetadataPath = null;
  _showMetadataPromise = null;
}

function _getNetflixVideoId() {
  if (state.latestTtmlMetadata?.movieId) return state.latestTtmlMetadata.movieId;
  const playerEl = document.querySelector('[data-uia="player"][data-videoid]');
  if (playerEl) return playerEl.dataset.videoid;
  const urlMatch = window.location.pathname.match(/\/watch\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  try {
    const origUrl = window.netflix?.reactContext?.models?.serverDefs?.data?.originalUrl || '';
    const ctxMatch = origUrl.match(/\/watch\/(\d+)/);
    if (ctxMatch) return ctxMatch[1];
  } catch { /* ignore */ }
  return null;
}

export async function fetchShowMetadata() {
  if (!CONFIG.showMetadata) return null;
  const path = location.pathname;

  if (_showMetadata && _showMetadataPath === path) return _showMetadata;
  if (_showMetadataPromise && _showMetadataPath === path) return _showMetadataPromise;

  _showMetadataPath = path;
  _showMetadataPromise = _fetchShowMetadataInner();
  try {
    _showMetadata = await _showMetadataPromise;
  } catch (err) {
    logWarn('🎬 Show context error:', err);
    _showMetadata = null;
  }
  _showMetadataPromise = null;
  return _showMetadata;
}

async function _fetchShowMetadataInner() {
  try {
  let netflixVideoId = _getNetflixVideoId();
  if (!netflixVideoId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(2000);
      netflixVideoId = _getNetflixVideoId();
      if (netflixVideoId) break;
    }
  }
  if (!netflixVideoId) {
    logInfo('🎬 Could not determine Netflix video ID');
    return null;
  }

  // Use intercepted metadata if available (no extra request needed)
  let video = null;
  if (state.interceptedNetflixMetadata?.video?.title) {
    video = state.interceptedNetflixMetadata.video;
    logInfo(`🎬 Using intercepted Netflix metadata for video ID: ${netflixVideoId}`);
  } else {
    // Wait briefly for interception to arrive, then retry
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(1000);
      if (state.interceptedNetflixMetadata?.video?.title) {
        video = state.interceptedNetflixMetadata.video;
        logInfo(`🎬 Using intercepted Netflix metadata for video ID: ${netflixVideoId}`);
        break;
      }
    }
  }

  if (!video?.title) {
    logInfo(`🎬 No intercepted metadata available for ID ${netflixVideoId}`);
    return null;
  }

  const context = buildContextFromNetflix(video, netflixVideoId);

  logInfo(`🎬 Netflix: "${context.title}" (${context.year})${context.episode ? ` S${context.episode.season}E${context.episode.episode}: "${context.episode.title}"` : ''}`);
  document.dispatchEvent(new CustomEvent('st-metadata-updated'));

  return context;
  } catch (err) {
    logWarn('🎬 Show context fetch failed:', err);
    return null;
  }
}
