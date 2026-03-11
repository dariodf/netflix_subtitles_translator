import { CONFIG } from '../config.js';
import { logInfo, logWarn } from '../core/utils.js';

// Fetch locally installed Ollama models via /api/tags
let _ollamaModelsCache = null;
let _ollamaModelsFetchTime = 0;

export function clearOllamaModelsCache() {
  _ollamaModelsCache = null;
}

export function fetchOllamaModels() {
  const CACHE_TTL = 30000;
  if (_ollamaModelsCache && Date.now() - _ollamaModelsFetchTime < CACHE_TTL) {
    return Promise.resolve(_ollamaModelsCache);
  }
  const url = CONFIG.ollamaUrl.replace(/\/+$/, '') + '/api/tags';
  return new Promise((resolve) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      timeout: 5000,
      onload(resp) {
        try {
          const data = JSON.parse(resp.responseText);
          const models = (data.models || []).map(m => ({
            id: m.name || m.model,
            size: m.size || 0,
            paramSize: m.details?.parameter_size || '',
          }));
          models.sort((a, b) => a.size - b.size);
          _ollamaModelsCache = models;
          _ollamaModelsFetchTime = Date.now();
          resolve(models);
        } catch (err) {
          logWarn('Failed to parse Ollama models:', err);
          resolve(null);
        }
      },
      onerror() { resolve(null); },
      ontimeout() { resolve(null); },
    });
  });
}

export function buildOllamaModelOptions(models, selectedModel, recommendedId) {
  if (!models || models.length === 0) return null;
  const recommendedModelId = recommendedId || '';
  return models.map(m => {
    const label = m.paramSize ? `${m.id} (${m.paramSize})` : m.id;
    const rec = m.id === recommendedModelId ? ' ★ recommended' : '';
    return `<option value="${m.id}" ${m.id === selectedModel ? 'selected' : ''}>${label}${rec}</option>`;
  }).join('') + `<option value="_custom">Custom...</option>`;
}

export function warmupPrimaryModel() {
  if (CONFIG.provider !== 'ollama' || CONFIG.secondProvider !== 'ollama' || CONFIG.model === CONFIG.secondModel) return;
  const warmupUrl = CONFIG.ollamaUrl.replace(/\/+$/, '') + '/api/chat';
  GM_xmlhttpRequest({
    method: 'POST', url: warmupUrl,
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ model: CONFIG.model, stream: false, messages: [{ role: 'user', content: 'hi' }] }),
    timeout: 60000,
    onload() { logInfo(`🔄 Primary model (${CONFIG.model}) warmed up`); },
    onerror() { logWarn('⚠️ Failed to warm up primary model'); },
  });
}
