import { CONFIG } from '../config.js';
import { PROVIDERS } from '../core/providers/definitions.js';

export function getSecondApiKey() {
  return CONFIG.secondApiKey || (CONFIG.secondProvider === CONFIG.provider ? CONFIG.apiKey : '');
}

export function getSecondProviderOverride() {
  const secondProviderDef = PROVIDERS[CONFIG.secondProvider];
  const apiKey = getSecondApiKey();
  if (!secondProviderDef || secondProviderDef.type !== 'llm') return null;
  if (secondProviderDef.needsKey && !apiKey) return null;
  return { provider: CONFIG.secondProvider, model: CONFIG.secondModel, apiKey };
}
