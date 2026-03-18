import { PROVIDERS } from './core/providers/definitions.js';

// ============================
// CONFIG
// ============================

/**
 * Read a boolean from GM storage. Handles both legacy string values
 * ('true'/'false') and native boolean values from newer saves.
 */
function getBool(key, def = false) {
  const val = GM_getValue(key, def);
  if (typeof val === 'boolean') return val;
  return val === 'true'; // legacy string format
}

function getJson(key) {
  try { return JSON.parse(GM_getValue(key, '{}')); } catch { return {}; }
}

export const CONFIG = {
  provider: GM_getValue('provider', 'ollama'),
  apiKeys: getJson('apiKeys'),
  apiKey: '', // active value — overwritten below from per-provider keys
  models: getJson('models'),
  model: '', // active value — overwritten below from per-provider models
  ollamaUrl: GM_getValue('ollamaUrl', 'http://localhost:11434'),
  libreTranslateUrl: GM_getValue('libreTranslateUrl', 'https://libretranslate.com'),
  targetLang: GM_getValue('targetLang', 'English'),
  sourceLang: GM_getValue('sourceLang', ''),
  chunkSize: 50, // active value — overwritten below from per-provider sizes
  chunkSizes: getJson('chunkSizes'),
  chunkOverlap: 10,
  prevContextLines: 5,
  timingOffset: parseInt(GM_getValue('timingOffset', '0')) || 0,
  timingStep: parseInt(GM_getValue('timingStep', '200')) || 200,
  fontSize: GM_getValue('fontSize', '2.2vw'),
  // Second model — used for cleanup (flagged only) or full pass (all lines)
  secondEnabled: getBool('secondEnabled', false),
  secondProvider: GM_getValue('secondProvider', 'anthropic'),
  secondModel: GM_getValue('secondModel', ''),
  secondApiKey: GM_getValue('secondApiKey', ''),
  secondChunkSize: 100, // active value — overwritten below from per-provider sizes
  secondChunkSizes: getJson('secondChunkSizes'),
  fullPassEnabled: getBool('fullPassEnabled', false),
  advancedMode: getBool('advancedMode', false),
  masterEnabled: getBool('masterEnabled', true),
  showMetadata: getBool('showMetadata', true),
  showSynopsis: getBool('showSynopsis', true),
  episodeSynopsis: getBool('episodeSynopsis', true),
  fastStart: getBool('fastStart', true),
  glossaryPerChunk: getBool('glossaryPerChunk', false),
  glossaryUpfront: getBool('glossaryUpfront', false),
  glossaryUpfrontSecond: getBool('glossaryUpfrontSecond', false),
  anilistNames: getBool('anilistNames', true),
  replaceCharacterNames: getBool('replaceCharacterNames', false),
};

// Set active model from per-provider storage (legacy fallback for existing users)
CONFIG.model = CONFIG.models[CONFIG.provider] || GM_getValue('model', '') || PROVIDERS[CONFIG.provider]?.defaultModel || '';
if (!CONFIG.secondModel) {
  const secondProviderConfig = PROVIDERS[CONFIG.secondProvider];
  CONFIG.secondModel = secondProviderConfig?.defaultModel || '';
}
// Set active chunk sizes from per-provider storage (or provider defaults)
CONFIG.chunkSize = CONFIG.chunkSizes[CONFIG.provider] || PROVIDERS[CONFIG.provider]?.defaultChunkSize || 50;
CONFIG.secondChunkSize = CONFIG.secondChunkSizes[CONFIG.secondProvider] || PROVIDERS[CONFIG.secondProvider]?.defaultChunkSize || 50;
// Set active API key from per-provider storage (legacy fallback for existing users)
CONFIG.apiKey = CONFIG.apiKeys[CONFIG.provider] || GM_getValue('apiKey', '');

export function saveConfig() {
  GM_setValue('provider', CONFIG.provider);
  // Save per-provider API keys
  CONFIG.apiKeys[CONFIG.provider] = CONFIG.apiKey;
  GM_setValue('apiKeys', JSON.stringify(CONFIG.apiKeys));
  // Save per-provider models
  CONFIG.models[CONFIG.provider] = CONFIG.model;
  GM_setValue('models', JSON.stringify(CONFIG.models));
  GM_setValue('ollamaUrl', CONFIG.ollamaUrl);
  GM_setValue('libreTranslateUrl', CONFIG.libreTranslateUrl);
  GM_setValue('targetLang', CONFIG.targetLang);
  GM_setValue('sourceLang', CONFIG.sourceLang);
  GM_setValue('fontSize', CONFIG.fontSize);
  GM_setValue('timingOffset', CONFIG.timingOffset);
  GM_setValue('timingStep', CONFIG.timingStep);
  GM_setValue('masterEnabled', CONFIG.masterEnabled);
  GM_setValue('secondEnabled', CONFIG.secondEnabled);
  GM_setValue('secondProvider', CONFIG.secondProvider);
  GM_setValue('secondModel', CONFIG.secondModel);
  GM_setValue('secondApiKey', CONFIG.secondApiKey);
  GM_setValue('fullPassEnabled', CONFIG.fullPassEnabled);
  GM_setValue('advancedMode', CONFIG.advancedMode);
  GM_setValue('showMetadata', CONFIG.showMetadata);
  GM_setValue('showSynopsis', CONFIG.showSynopsis);
  GM_setValue('episodeSynopsis', CONFIG.episodeSynopsis);
  GM_setValue('fastStart', CONFIG.fastStart);
  GM_setValue('glossaryPerChunk', CONFIG.glossaryPerChunk);
  GM_setValue('glossaryUpfront', CONFIG.glossaryUpfront);
  GM_setValue('glossaryUpfrontSecond', CONFIG.glossaryUpfrontSecond);
  GM_setValue('anilistNames', CONFIG.anilistNames);
  GM_setValue('replaceCharacterNames', CONFIG.replaceCharacterNames);
  // Save per-provider chunk sizes
  CONFIG.chunkSizes[CONFIG.provider] = CONFIG.chunkSize;
  CONFIG.secondChunkSizes[CONFIG.secondProvider] = CONFIG.secondChunkSize;
  GM_setValue('chunkSizes', JSON.stringify(CONFIG.chunkSizes));
  GM_setValue('secondChunkSizes', JSON.stringify(CONFIG.secondChunkSizes));
}
