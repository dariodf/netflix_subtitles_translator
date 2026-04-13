import { CONFIG } from '../config.js';
import { logWarn } from '../core/utils.js';

let _modelsCache = null;
let _modelsFetchTime = 0;

export function clearLMStudioModelsCache() {
  _modelsCache = null;
}

export function fetchLMStudioModels() {
  const CACHE_TTL = 30000;
  if (_modelsCache && Date.now() - _modelsFetchTime < CACHE_TTL) {
    return Promise.resolve(_modelsCache);
  }
  const base = (CONFIG.localUrl || 'http://localhost:1234').replace(/\/+$/, '');
  return new Promise((resolve) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url: base + '/v1/models',
      timeout: 5000,
      onload(resp) {
        try {
          const data = JSON.parse(resp.responseText);
          const models = (data.data || []).map(m => ({ id: m.id }));
          _modelsCache = models.length ? models : null;
          _modelsFetchTime = Date.now();
          resolve(_modelsCache);
        } catch (err) {
          logWarn('Failed to parse LM Studio models:', err);
          resolve(null);
        }
      },
      onerror() { resolve(null); },
      ontimeout() { resolve(null); },
    });
  });
}
