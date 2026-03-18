import { PROVIDERS, langToCode } from '../core/providers/definitions.js';
import { sleep, makeCue, logInfo, logError } from '../core/utils.js';

export async function translateWithSimple(cues, context) {
  const config = context.config;
  const sharedTranslationState = context.sharedTranslationState;
  const BATCH = 30;
  const totalBatches = Math.ceil(cues.length / BATCH);
  const allTranslated = [];
  let batchNum = 0;

  for (let i = 0; i < cues.length; i += BATCH) {
    const batch = cues.slice(i, i + BATCH);
    batchNum++;
    logInfo(`📦 Simple translate batch ${batchNum}/${totalBatches} (${batch.length} lines)`);
    context.reportStatus(`Batch ${batchNum}/${totalBatches} via ${PROVIDERS[config.provider].name}...`, 'working');

    const combined = batch.map(c => c.text).join('\n');
    let translated;

    try {
      translated = await translateTextSimple(combined, config, context);
    } catch (err) {
      logError('Simple translate error:', err);
      translated = combined;
    }

    const lines = translated.split('\n');
    for (let j = 0; j < batch.length; j++) {
      allTranslated.push(makeCue(batch[j], (lines[j] || batch[j].text).trim()));
    }

    // Show partial results progressively
    sharedTranslationState.translatedCues = [
      ...allTranslated,
      ...cues.slice(allTranslated.length).map(c => makeCue(c, c.text)),
    ];
    context.commitTranslation(sharedTranslationState.translatedCues);

    // Rate limit protection
    if (i + BATCH < cues.length) await sleep(300);
  }

  return allTranslated;
}

async function translateTextSimple(text, config, context) {
  const srcCode = langToCode(config.sourceLang);
  const tgtCode = langToCode(config.targetLang);

  switch (config.provider) {
    case 'libretranslate': return translateLibreTranslate(text, srcCode, tgtCode, config, context);
    case 'lingva':         return translateLingva(text, srcCode, tgtCode, context);
    case 'google_free':    return translateGoogleFree(text, srcCode, tgtCode, context);
    default: throw new Error(`Unknown simple provider: ${config.provider}`);
  }
}

async function translateLibreTranslate(text, src, tgt, config, context) {
  const url = (config.libreTranslateUrl || 'https://libretranslate.com').replace(/\/+$/, '') + '/translate';
  try {
    const { data } = await context.postJson(url, { 'Content-Type': 'application/json' }, { q: text, source: src === 'auto' ? 'auto' : src, target: tgt }, 30000);
    if (data.error) throw new Error(data.error);
    return data.translatedText || text;
  } catch (err) {
    if (err.message === 'Network error') throw new Error('LibreTranslate request failed. Is the server running?', { cause: err });
    if (err.message === 'Request timed out') throw new Error('LibreTranslate timed out', { cause: err });
    if (err.message.startsWith('Parse error')) return text;
    throw err;
  }
}

async function translateLingva(text, src, tgt, context) {
  const instance = PROVIDERS.lingva.instances[0];
  const source = src === 'auto' ? 'auto' : src;
  const url = `${instance}/api/v1/${source}/${tgt}/${encodeURIComponent(text)}`;

  try {
    const data = await context.fetchJson(url, 30000);
    return data?.translation || text;
  } catch {
    // Try fallback instance
    if (PROVIDERS.lingva.instances.length > 1) {
      const fallbackUrl = `${PROVIDERS.lingva.instances[1]}/api/v1/${source}/${tgt}/${encodeURIComponent(text)}`;
      try {
        const data = await context.fetchJson(fallbackUrl, 30000);
        return data?.translation || text;
      } catch {
        throw new Error('All Lingva instances failed');
      }
    }
    throw new Error('Lingva request failed');
  }
}

async function translateGoogleFree(text, src, tgt, context) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${src === 'auto' ? 'auto' : src}&tl=${tgt}&dt=t&q=${encodeURIComponent(text)}`;

  try {
    const data = await context.fetchJson(url, 30000);
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map(seg => seg[0]).join('');
    }
    return text;
  } catch {
    throw new Error('Google Translate request failed');
  }
}
