/**
 * Shared headless utilities — constants and helpers used across CLI scripts.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { resolveConfigFile } from './jsdom-setup.js';
import { buildContextFromNetflix } from '../core/metadata.js';

// ─── Constants ───

export const EPISODES_DIRS = [resolve('episodes'), resolve('episodes-local')];
export const CONFIGS_DIR = resolve('configs');
export const RUNS_DIR = resolve('runs');

export const DEFAULT_CONFIG = {
  provider: 'ollama',
  model: 'qwen2.5:3b',
  apiKey: '',
  ollamaUrl: 'http://localhost:11434',
  targetLang: 'Spanish',
  sourceLang: '',
  chunkSize: 50,
  chunkOverlap: 5,
  prevContextLines: 3,
  fastStart: false,
  glossaryPerChunk: false,
  glossaryUpfront: false,
  showMetadata: false,
  showSynopsis: false,
  episodeSynopsis: false,
  secondEnabled: false,
  secondProvider: '',
  secondModel: '',
  secondApiKey: '',
  secondChunkSize: 50,
  fullPassEnabled: false,
  glossaryUpfrontSecond: false,
  anilistNames: true,
  replaceCharacterNames: false,
};

// ─── Config loading ───

export function loadConfig(configName) {
  const configPath = join(CONFIGS_DIR, `${configName}.json`);
  if (!existsSync(configPath)) {
    console.error(`No config found at ${configPath}`);
    console.error(`Create configs/${configName}.json with your translation settings.`);
    process.exit(1);
  }
  try {
    const merged = resolveConfigFile(configPath, CONFIGS_DIR);
    const config = { ...DEFAULT_CONFIG, ...merged };
    if (!config.apiKey && process.env.PROVIDER_API_KEY) {
      config.apiKey = process.env.PROVIDER_API_KEY;
    }
    return config;
  } catch (err) {
    console.error(`Error reading config: ${err.message}`);
    process.exit(1);
  }
}

// ─── Episode discovery ───

export function findEpisodeDir(episodeName) {
  for (const dir of EPISODES_DIRS) {
    const candidate = join(dir, episodeName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function discoverEpisodes() {
  const episodes = new Set();
  for (const dir of EPISODES_DIRS) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) episodes.add(entry.name);
    }
  }
  return [...episodes].sort();
}

// ─── Metadata ───

export function loadEpisodeMetadata(episodeDir) {
  const metadataPath = join(episodeDir, 'metadata.json');
  if (!existsSync(metadataPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    if (raw.video) {
      let videoId = raw.videoId || '';
      if (!videoId && raw.video.type === 'show' && raw.video.seasons) {
        const firstEp = raw.video.seasons[0]?.episodes?.[0];
        videoId = firstEp?.id || firstEp?.episodeId || '';
      }
      return buildContextFromNetflix(raw.video, String(videoId));
    }
    return raw;
  } catch (err) {
    console.warn(`  Warning: could not parse metadata.json: ${err.message}`);
    return null;
  }
}

// ─── Formatting ───

export function padRight(str, len) { return String(str).padEnd(len); }
export function padLeft(str, len) { return String(str).padStart(len); }
export function fmtPct(val) {
  if (val === null || val === undefined) return 'n/a';
  return `${val.toFixed(1)}%`;
}
