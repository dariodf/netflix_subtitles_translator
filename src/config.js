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

// Default local server URLs per provider
export const LOCAL_URL_DEFAULTS = { ollama: 'http://localhost:11434', lmstudio: 'http://localhost:1234' };

export const CONFIG = {
  provider: GM_getValue('provider', 'ollama'),
  // Per-provider settings: { [providerKey]: { model, apiKey, chunkSize, localUrl } }
  providerConfigs: getJson('providerConfigs'),
  // Active values — overwritten below from providerConfigs
  apiKey: '',
  model: '',
  chunkSize: 50,
  localUrl: '',
  libreTranslateUrl: GM_getValue('libreTranslateUrl', 'https://libretranslate.com'),
  targetLang: GM_getValue('targetLang', 'English'),
  sourceLang: GM_getValue('sourceLang', ''),
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
  secondChunkSize: 100, // active value — overwritten below
  // Per-second-provider settings: { [providerKey]: { chunkSize } }
  secondProviderConfigs: getJson('secondProviderConfigs'),
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
  // Image translation (vision)
  imageVisionModel: GM_getValue('imageVisionModel', ''),
  imageVisionProvider: GM_getValue('imageVisionProvider', ''),
  imageVisionApiKey: GM_getValue('imageVisionApiKey', ''),
  imageDisplayDuration: parseInt(GM_getValue('imageDisplayDuration', '3000')) || 3000,
  imageSourceLang: GM_getValue('imageSourceLang', ''),
};

// One-time migration from legacy separate maps into providerConfigs
if (Object.keys(CONFIG.providerConfigs).length === 0) {
  const legacyApiKeys = getJson('apiKeys');
  const legacyModels = getJson('models');
  const legacyChunkSizes = getJson('chunkSizes');
  const legacyLocalUrls = getJson('localUrls');
  const legacyApiKey = GM_getValue('apiKey', '');
  const legacyModel = GM_getValue('model', '');
  const allProviders = new Set([
    ...Object.keys(legacyApiKeys), ...Object.keys(legacyModels),
    ...Object.keys(legacyChunkSizes), ...Object.keys(legacyLocalUrls),
  ]);
  for (const p of allProviders) {
    CONFIG.providerConfigs[p] = {
      ...(legacyApiKeys[p] ? { apiKey: legacyApiKeys[p] } : {}),
      ...(legacyModels[p] ? { model: legacyModels[p] } : {}),
      ...(legacyChunkSizes[p] ? { chunkSize: legacyChunkSizes[p] } : {}),
      ...(legacyLocalUrls[p] ? { localUrl: legacyLocalUrls[p] } : {}),
    };
  }
  // Migrate flat legacy keys for the active provider
  if (legacyApiKey && !CONFIG.providerConfigs[CONFIG.provider]?.apiKey) {
    CONFIG.providerConfigs[CONFIG.provider] = { ...CONFIG.providerConfigs[CONFIG.provider], apiKey: legacyApiKey };
  }
  if (legacyModel && !CONFIG.providerConfigs[CONFIG.provider]?.model) {
    CONFIG.providerConfigs[CONFIG.provider] = { ...CONFIG.providerConfigs[CONFIG.provider], model: legacyModel };
  }
}

// One-time migration for secondProviderConfigs
if (Object.keys(CONFIG.secondProviderConfigs).length === 0) {
  const legacySecondChunkSizes = getJson('secondChunkSizes');
  for (const p of Object.keys(legacySecondChunkSizes)) {
    CONFIG.secondProviderConfigs[p] = { chunkSize: legacySecondChunkSizes[p] };
  }
}

// Set active values from providerConfigs
const _pc = CONFIG.providerConfigs[CONFIG.provider] || {};
CONFIG.model = _pc.model || PROVIDERS[CONFIG.provider]?.defaultModel || '';
CONFIG.chunkSize = _pc.chunkSize || PROVIDERS[CONFIG.provider]?.defaultChunkSize || 50;
CONFIG.apiKey = _pc.apiKey || '';
CONFIG.localUrl = _pc.localUrl || LOCAL_URL_DEFAULTS[CONFIG.provider] || '';

CONFIG.secondChunkSize = CONFIG.secondProviderConfigs[CONFIG.secondProvider]?.chunkSize || PROVIDERS[CONFIG.secondProvider]?.defaultChunkSize || 50;
if (!CONFIG.secondModel) {
  CONFIG.secondModel = PROVIDERS[CONFIG.secondProvider]?.defaultModel || '';
}

// Auto-select default vision model if provider supports vision and user hasn't touched the setting
// GM storage returns undefined/null for keys never written; '' means user explicitly chose "Disabled"
if (GM_getValue('imageVisionModel', null) === null) {
  const visionProviderKey = CONFIG.imageVisionProvider || CONFIG.provider;
  const visionProvider = PROVIDERS[visionProviderKey];
  if (visionProvider?.defaultVisionModel) {
    CONFIG.imageVisionModel = visionProvider.defaultVisionModel;
  }
}

export function saveConfig() {
  GM_setValue('provider', CONFIG.provider);
  // Save per-provider config as a single map
  CONFIG.providerConfigs[CONFIG.provider] = {
    ...CONFIG.providerConfigs[CONFIG.provider],
    apiKey: CONFIG.apiKey,
    model: CONFIG.model,
    chunkSize: CONFIG.chunkSize,
    localUrl: CONFIG.localUrl,
  };
  GM_setValue('providerConfigs', JSON.stringify(CONFIG.providerConfigs));
  // Save per-second-provider config
  CONFIG.secondProviderConfigs[CONFIG.secondProvider] = {
    ...CONFIG.secondProviderConfigs[CONFIG.secondProvider],
    chunkSize: CONFIG.secondChunkSize,
  };
  GM_setValue('secondProviderConfigs', JSON.stringify(CONFIG.secondProviderConfigs));
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
  // Image translation (vision)
  GM_setValue('imageVisionModel', CONFIG.imageVisionModel);
  GM_setValue('imageVisionProvider', CONFIG.imageVisionProvider);
  GM_setValue('imageVisionApiKey', CONFIG.imageVisionApiKey);
  GM_setValue('imageDisplayDuration', CONFIG.imageDisplayDuration);
  GM_setValue('imageSourceLang', CONFIG.imageSourceLang);
}
