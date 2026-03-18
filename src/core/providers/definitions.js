// ============================
// PROVIDER DEFINITIONS
// ============================

/** Shared extractText for OpenAI-compatible APIs (Groq, Mistral, OpenRouter) */
function extractOpenAiCompatibleText(data) {
  if (data.error) throw new Error(data.error.message || data.error.type || JSON.stringify(data.error));
  return data.choices?.[0]?.message?.content || '';
}
export const PROVIDERS = {
  ollama: {
    name: 'Ollama (local, private)',
    paid: false,
    needsKey: false,
    type: 'llm',
    defaultModel: 'qwen2.5:3b',
    defaultSecondModel: 'qwen2.5:7b',
    defaultChunkSize: 100,
    models: [
      { id: 'qwen2.5:3b', name: 'Qwen 2.5 3B — fast, good multilingual (recommended)' },
      { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B — higher quality, slower' },
      { id: 'qwen2.5:14b', name: 'Qwen 2.5 14B — best quality, needs 16GB+ VRAM' },
      { id: 'gemma2', name: 'Gemma 2 — good for translation' },
      { id: 'llama3.1', name: 'Llama 3.1 — good all-rounder' },
      { id: 'mistral', name: 'Mistral — fast' },
      { id: 'aya', name: 'Aya — built for multilingual' },
    ],
    url: 'http://localhost:11434/api/chat',
    buildRequest(system, userMsg, model) {
      return {
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({
          model,
          stream: false,
          think: false,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: userMsg },
          ],
        }),
      };
    },
    extractText(data) {
      if (data.error) throw new Error(data.error);
      return data.message?.content || '';
    },
  },

  gemini: {
    name: 'Google Gemini',
    paid: false,
    needsKey: true,
    type: 'llm',
    defaultModel: 'gemini-3.1-flash-lite-preview',
    defaultChunkSize: 50,
    models: [
      { id: 'gemini-3.1-flash-lite-preview', name: '3.1 Flash Lite — 500 req/day, recommended' },
      { id: 'gemma-3-27b-it', name: 'Gemma 3 27B — 14,400 req/day (low throughput)' },
      { id: 'gemini-2.5-flash', name: '2.5 Flash — best quality (20 req/day)' },
      { id: 'gemini-2.5-flash-lite', name: '2.5 Flash-Lite — fast (20 req/day)' },
    ],
    url: 'https://generativelanguage.googleapis.com/v1beta/models/',
    buildRequest(system, userMsg, model, apiKey) {
      return {
        // API key in header instead of URL for security
        urlSuffix: `${model}:generateContent`,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        data: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: [{ role: 'user', parts: [{ text: userMsg }] }],
          generationConfig: { maxOutputTokens: 8192 },
        }),
      };
    },
    extractText(data) {
      if (data.error) throw new Error(data.error.message || data.error.status);
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    },
  },

  anthropic: {
    name: 'Anthropic (Claude)',
    paid: true,
    needsKey: true,
    type: 'llm',
    defaultModel: 'claude-haiku-4-5-20251001',
    defaultChunkSize: 50,
    models: [
      { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5 — fast, cheapest' },
      { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5 — higher quality' },
    ],
    url: 'https://api.anthropic.com/v1/messages',
    buildRequest(system, userMsg, model, apiKey) {
      return {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        data: JSON.stringify({
          model,
          max_tokens: 8192,
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: userMsg }],
        }),
      };
    },
    extractText(data) {
      if (data.error) throw new Error(data.error.message);
      return data.content?.[0]?.text || '';
    },
  },

  groq: {
    name: 'Groq',
    paid: false,
    needsKey: true,
    type: 'llm',
    defaultModel: 'llama-3.3-70b-versatile',
    defaultChunkSize: 50,
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B — best quality, recommended' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B — fastest, highest quota' },
      { id: 'gemma2-9b-it', name: 'Gemma 2 9B — good multilingual' },
      { id: 'mistral-saba-24b', name: 'Mistral Saba 24B — strong multilingual' },
    ],
    url: 'https://api.groq.com/openai/v1/chat/completions',
    note: 'Very fast inference. Get a key at <a href="https://console.groq.com" target="_blank" style="color:rgba(100,200,255,0.9);">console.groq.com</a>',
    buildRequest(system, userMsg, model, apiKey) {
      return {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        data: JSON.stringify({
          model,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: userMsg },
          ],
          max_tokens: 8192,
        }),
      };
    },
    extractText: extractOpenAiCompatibleText,
  },

  mistral: {
    name: 'Mistral',
    paid: false,
    needsKey: true,
    type: 'llm',
    defaultModel: 'mistral-small-latest',
    defaultChunkSize: 50,
    models: [
      { id: 'mistral-small-latest', name: 'Mistral Small — fast, good quality' },
      { id: 'mistral-large-latest', name: 'Mistral Large — highest quality' },
    ],
    url: 'https://api.mistral.ai/v1/chat/completions',
    note: 'Strong multilingual. Phone verification required. Get a key at <a href="https://console.mistral.ai" target="_blank" style="color:rgba(100,200,255,0.9);">console.mistral.ai</a>',
    buildRequest(system, userMsg, model, apiKey) {
      return {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        data: JSON.stringify({
          model,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: userMsg },
          ],
          max_tokens: 8192,
        }),
      };
    },
    extractText: extractOpenAiCompatibleText,
  },

  openrouter: {
    name: 'OpenRouter',
    paid: false,
    needsKey: true,
    type: 'llm',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    defaultChunkSize: 50,
    models: [
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B — best free, recommended' },
      { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral Small 3.1 — good multilingual' },
      { id: 'qwen/qwen3-235b-a22b:free', name: 'Qwen 3 235B — large, strong multilingual' },
      { id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B — solid all-rounder' },
    ],
    url: 'https://openrouter.ai/api/v1/chat/completions',
    note: 'Many models through one API. Get a key at <a href="https://openrouter.ai" target="_blank" style="color:rgba(100,200,255,0.9);">openrouter.ai</a>',
    buildRequest(system, userMsg, model, apiKey) {
      return {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/nicebro/netflix-subtitle-translator',
          'X-Title': 'Netflix Subtitle Translator',
        },
        data: JSON.stringify({
          model,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: userMsg },
          ],
          max_tokens: 8192,
        }),
      };
    },
    extractText: extractOpenAiCompatibleText,
  },

  libretranslate: {
    name: 'LibreTranslate',
    paid: false,
    needsKey: false,
    type: 'simple',
    url: 'https://libretranslate.com/translate',
    note: 'Public instance may be slow or rate-limited. Self-host for best results: github.com/LibreTranslate/LibreTranslate',
  },

  lingva: {
    name: 'Lingva Translate',
    paid: false,
    needsKey: false,
    type: 'simple',
    instances: [
      'https://lingva.thedaviddelta.com',
      'https://translate.fedilab.app',
    ],
    note: 'Free Google Translate frontend. No API key needed.',
  },

  google_free: {
    name: 'Google Translate (unofficial)',
    paid: false,
    needsKey: false,
    type: 'simple',
    note: 'Unofficial free endpoint. May break or rate-limit without warning.',
  },
};

// ============================
// LANGUAGE CODES (for simple translators)
// ============================
export const LANG_CODES = {
  english: 'en', japanese: 'ja', korean: 'ko', chinese: 'zh',
  spanish: 'es', french: 'fr', german: 'de', italian: 'it',
  portuguese: 'pt', russian: 'ru', arabic: 'ar', hindi: 'hi',
  thai: 'th', vietnamese: 'vi', indonesian: 'id', turkish: 'tr',
  dutch: 'nl', polish: 'pl', swedish: 'sv', danish: 'da',
  norwegian: 'no', finnish: 'fi', czech: 'cs', romanian: 'ro',
  hungarian: 'hu', greek: 'el', hebrew: 'he', malay: 'ms',
  tagalog: 'tl', ukrainian: 'uk',
};

export function langToCode(lang) {
  if (!lang) return 'auto';
  const lower = lang.toLowerCase().trim();
  return LANG_CODES[lower] || lower;
}

/** Convert ISO 639-1 code to full language name (e.g. 'ja' → 'Japanese') */
let _codeToLanguageMap = null;
export function codeToLanguage(code) {
  if (!code) return '';
  if (!_codeToLanguageMap) {
    _codeToLanguageMap = {};
    for (const [name, isoCode] of Object.entries(LANG_CODES)) {
      _codeToLanguageMap[isoCode] = name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
  return _codeToLanguageMap[code.toLowerCase().trim()] || '';
}
