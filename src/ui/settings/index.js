import { CONFIG, saveConfig } from '../../config.js';
import { PROVIDERS } from '../../core/providers/definitions.js';
import { state } from '../../state.js';
import { cacheClear } from '../../browser/cache.js';
import { showStatus } from '../status.js';
import { INSTRUCTIONS_HTML } from '../instructions.js';
import { getShowMetadata } from '../../browser/metadata-fetcher.js';
import { retryCurrentChunk, retranslateAll, applyMasterToggle, applySubtitleToggle, applyDualSubsToggle, applyOrigOnFlaggedToggle, applyTranscriptToggle, PILL_ON, PILL_OFF } from '../../browser/shortcuts.js';
import { wireOllamaPanel } from './ollama-panel.js';

/** Wire a simple boolean toggle pill: flips CONFIG[configKey], updates pill UI, and persists. */
function wireToggle(panelEl, id, configKey) {
  const toggle = panelEl.querySelector(`#${id}-toggle`);
  const sw = panelEl.querySelector(`#${id}-switch`);
  if (!toggle || !sw) return;
  toggle.addEventListener('click', () => {
    CONFIG[configKey] = !CONFIG[configKey];
    sw.style.background = CONFIG[configKey] ? PILL_ON : PILL_OFF;
    sw.querySelector('div').style.left = CONFIG[configKey] ? '16px' : '2px';
    GM_setValue(configKey, CONFIG[configKey]);
  });
}

export function togglePanel() {
    if (state.panelEl) { state.panelEl.remove(); state.panelEl = null; return; }

    const currentProvider = PROVIDERS[CONFIG.provider];

    if (!document.getElementById('st-panel-styles')) {
      const style = document.createElement('style');
      style.id = 'st-panel-styles';
      style.textContent = `
        #st-settings-panel { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.2) transparent; }
        #st-settings-panel::-webkit-scrollbar { width: 4px; }
        #st-settings-panel::-webkit-scrollbar-track { background: transparent; }
        #st-settings-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }
        #st-settings-panel::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.35); }
      `;
      document.head.appendChild(style);
    }

    state.panelEl = document.createElement('div');
    state.panelEl.id = 'st-settings-panel';
    Object.assign(state.panelEl.style, {
      position: 'fixed', top: '60px', right: '20px', width: '360px',
      background: 'rgba(20,20,20,0.97)', border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '12px', padding: '20px', zIndex: '2147483647',
      fontFamily: 'Netflix Sans, Arial, sans-serif', color: 'white', fontSize: '13px',
      backdropFilter: 'blur(10px)', maxHeight: '85vh', overflowY: 'auto', scrollbarGutter: 'stable',
    });

    const labelStyle = 'display:block;margin-bottom:6px;opacity:0.6;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;';
    const inputStyle = 'width:100%;padding:8px 10px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;margin-bottom:14px;box-sizing:border-box;font-size:13px;font-family:inherit;';
    const selectStyle = inputStyle.replace('background:rgba(255,255,255,0.1)', 'background:#1e1e2e') + 'appearance:auto;';

    // Provider options
    const providerOptions = Object.entries(PROVIDERS).map(([key, p]) => {
      const tag = p.paid ? '' : ' ★ FREE';
      return `<option value="${key}" ${CONFIG.provider === key ? 'selected' : ''}>${p.name}${tag}</option>`;
    }).join('');

    // Model section (LLM providers only)
    let modelSection = '';
    if (currentProvider.type === 'llm') {
      if (CONFIG.provider === 'ollama') {
        // Ollama: static dropdown with hardcoded models, refresh button fetches from /api/tags
        const ollamaProv = PROVIDERS.ollama;
        const ollamaIsCustom = !(ollamaProv.models || []).find(m => m.id === CONFIG.model);
        const ollamaModelOpts = (ollamaProv.models || []).map(m =>
          `<option value="${m.id}" ${CONFIG.model === m.id ? 'selected' : ''}>${m.name}</option>`
        ).join('') + `<option value="_custom" ${ollamaIsCustom ? 'selected' : ''}>Custom...</option>`;
        const btnStyle = 'padding:6px 10px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;cursor:pointer;font-size:11px;white-space:nowrap;';
        modelSection = `
          <label style="${labelStyle}">Model</label>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:14px;">
            <select id="st-model" style="${selectStyle};margin-bottom:0;flex:1;">${ollamaModelOpts}</select>
            <button id="st-ollama-refresh" title="Fetch installed models from Ollama" style="${btnStyle}">↻ Refresh</button>
          </div>
          <input id="st-model-custom" placeholder="Custom model name" value="${ollamaIsCustom ? CONFIG.model : ''}" style="${inputStyle}display:${ollamaIsCustom ? 'block' : 'none'};" />
          <div id="st-ollama-model-hint" style="display:none;font-size:11px;line-height:1.4;padding:8px 10px;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.25);border-radius:6px;margin:-8px 0 14px;"></div>
        `;
      } else if (currentProvider.models) {
        const isCustom = !currentProvider.models.find(m => m.id === CONFIG.model);
        const modelOpts = currentProvider.models.map(m =>
          `<option value="${m.id}" ${CONFIG.model === m.id ? 'selected' : ''}>${m.name}</option>`
        ).join('') + `<option value="_custom" ${isCustom ? 'selected' : ''}>Custom...</option>`;

        modelSection = `
          <label style="${labelStyle}">Model</label>
          <select id="st-model" style="${selectStyle}">${modelOpts}</select>
          <input id="st-model-custom" placeholder="Custom model name" value="${isCustom ? CONFIG.model : ''}"
            style="${inputStyle}display:${isCustom ? 'block' : 'none'};" />
        `;
      }
    }

    // API key
    let keySection = '';
    if (currentProvider.type === 'llm') {
      const keyLinks = {
        gemini: { url: 'https://aistudio.google.com/apikey', label: '🔑 Get a Gemini API key →' },
        groq: { url: 'https://console.groq.com/keys', label: '🔑 Get a Groq API key →' },
        mistral: { url: 'https://console.mistral.ai/api-keys', label: '🔑 Get a Mistral API key →' },
        openrouter: { url: 'https://openrouter.ai/keys', label: '🔑 Get an OpenRouter API key →' },
      };
      const link = keyLinks[CONFIG.provider];
      const keyLinkHtml = link
        ? `<a href="${link.url}" target="_blank" style="color:rgba(100,200,255,0.9);font-size:11px;text-decoration:none;">${link.label}</a>`
        : '';
      const placeholders = {
        gemini: 'Paste your Gemini API key here',
        groq: 'gsk_...',
        mistral: 'Paste your Mistral API key here',
        openrouter: 'sk-or-...',
        anthropic: 'sk-ant-...',
        ollama: 'Optional — for remote/authenticated instances',
      };
      keySection = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
          <label style="font-size:12px;font-weight:600;opacity:0.8;">API Key${!currentProvider.needsKey ? ' <span style="opacity:0.5;font-weight:400;">(optional)</span>' : ''}</label>
          ${keyLinkHtml}
        </div>
        <input id="st-apikey" type="password" value="${CONFIG.apiKey}" placeholder="${placeholders[CONFIG.provider] || 'API key'}" style="${inputStyle}" />
      `;
    }

    // Provider-specific URL
    let urlSection = '';
    if (CONFIG.provider === 'ollama') {
      urlSection = `
        <label style="${labelStyle}">Ollama URL</label>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:14px;">
          <input id="st-ollama-url" value="${CONFIG.ollamaUrl}" placeholder="http://localhost:11434" style="${inputStyle};margin-bottom:0;flex:1;" />
          <button id="st-ollama-check" title="Check if Ollama is reachable" style="padding:6px 10px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;cursor:pointer;font-size:13px;min-width:36px;text-align:center;">✓</button>
        </div>
      `;
    } else if (CONFIG.provider === 'libretranslate') {
      urlSection = `
        <label style="${labelStyle}">LibreTranslate URL</label>
        <input id="st-libre-url" value="${CONFIG.libreTranslateUrl}" placeholder="https://libretranslate.com" style="${inputStyle}" />
      `;
    }

    // Provider note
    let noteSection = '';
    if (currentProvider.note) {
      noteSection = `<div style="padding:8px 10px;background:rgba(59,130,246,0.15);border-radius:6px;margin-bottom:14px;font-size:12px;line-height:1.5;opacity:0.8;">ℹ️ ${currentProvider.note}</div>`;
    }

    const isAdvancedMode = CONFIG.advancedMode;

    const _showMetadata = getShowMetadata();

    state.panelEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="32" height="32">
            <defs><linearGradient id="st-hdr-bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ff2030"/><stop offset="100%" stop-color="#b5000a"/></linearGradient></defs>
            <circle cx="64" cy="64" r="60" fill="#ffffff"/>
            <circle cx="64" cy="64" r="60" fill="none" stroke="#ccc" stroke-width="1"/>
            <rect x="22" y="38" width="84" height="18" rx="4" fill="rgba(0,0,0,0.08)"/>
            <text x="64" y="51" font-family="Helvetica Neue,Arial,sans-serif" font-size="11" font-weight="600" fill="rgba(0,0,0,0.35)" text-anchor="middle">字幕!</text>
            <path d="M64 60L64 68M58 64L64 68L70 64" stroke="rgba(0,0,0,0.25)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <rect x="22" y="74" width="84" height="18" rx="4" fill="url(#st-hdr-bar)"/>
            <text x="64" y="87" font-family="Helvetica Neue,Arial,sans-serif" font-size="11" font-weight="700" fill="rgba(255,255,255,0.95)" text-anchor="middle">Subtitles!</text>
          </svg>
          Subtitle Translator
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <div id="st-master-toggle" style="display:flex;align-items:center;gap:6px;cursor:pointer;" title="Enable/disable all translation">
            <div style="width:32px;height:18px;border-radius:9px;background:${CONFIG.masterEnabled ? PILL_ON : PILL_OFF};position:relative;transition:background 0.2s;" id="st-master-switch">
              <div style="width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:2px;${CONFIG.masterEnabled ? 'left:16px' : 'left:2px'};transition:left 0.2s;"></div>
            </div>
            <span id="st-master-label" style="font-size:11px;font-weight:600;opacity:${CONFIG.masterEnabled ? '0.9' : '0.4'};">${CONFIG.masterEnabled ? 'ON' : 'OFF'}</span>
          </div>
          <button id="st-instructions" title="Usage guide" style="background:none;border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;cursor:pointer;font-size:11px;padding:4px 8px;opacity:0.6;">📖 Help</button>
          <div id="st-close" style="cursor:pointer;opacity:0.5;font-size:18px;padding:4px 8px;">✕</div>
        </div>
      </div>

      <div id="st-main-content" style="display:${CONFIG.masterEnabled ? 'block' : 'none'};">

      ${state.rateLimitHit ? `<div style="padding:10px 12px;background:rgba(245,158,11,0.2);border:1px solid rgba(245,158,11,0.4);border-radius:8px;margin-bottom:14px;font-size:12px;line-height:1.5;">
        ⚠️ <strong>Rate limit was hit this session.</strong> Try switching to a model with higher quota, or use a different provider.
      </div>` : ''}

      ${!GM_getValue('welcomeDismissed', false) ? `<div id="st-welcome" style="padding:12px 14px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:8px;margin-bottom:14px;font-size:12px;line-height:1.6;position:relative;">
        <div id="st-welcome-dismiss" style="position:absolute;top:8px;right:10px;cursor:pointer;opacity:0.5;font-size:14px;" title="Dismiss">✕</div>
        👋 <strong>Welcome!</strong> To get started:<br>
        1. Pick a provider below — Ollama is local &amp; private, or choose a cloud provider<br>
        2. Get an API key if needed (link below the key field)<br>
        3. Set your target language<br>
        4. Enable subtitles in Netflix — the translator handles the rest
      </div>` : ''}

      <label style="${labelStyle}">Translation Provider</label>
      <select id="st-provider" style="${selectStyle}">${providerOptions}</select>

      ${noteSection}
      ${keySection}
      ${urlSection}
      ${modelSection}

      <div id="st-ollama-hint" style="display:${CONFIG.provider === 'ollama' && !CONFIG.secondEnabled ? 'block' : 'none'};padding:8px 10px;background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.3);border-radius:6px;margin-bottom:14px;font-size:11px;line-height:1.4;">
        💡 <strong>Tip:</strong> Enable the <em>Second Model</em> in advanced settings to use a larger model (e.g. qwen2.5:7b) for a quality pass after the fast first translation.
      </div>

      <label style="${labelStyle}">Target Language</label>
      ${(() => {
        const langs = [
          'English','Spanish','French','German','Italian','Portuguese','Dutch','Polish','Swedish','Norwegian','Danish','Finnish',
          'Russian','Ukrainian','Czech','Slovak','Romanian','Hungarian','Bulgarian','Croatian','Serbian','Slovenian','Greek','Turkish',
          'Chinese (Simplified)','Chinese (Traditional)','Japanese','Korean','Vietnamese','Thai','Indonesian','Malay','Hindi','Bengali','Arabic','Hebrew','Persian','Urdu',
        ];
        const isCustom = !langs.includes(CONFIG.targetLang);
        return `<select id="st-target" style="${selectStyle}">
          ${langs.map(l => `<option value="${l}" ${CONFIG.targetLang === l ? 'selected' : ''}>${l}</option>`).join('')}
          <option value="_custom" ${isCustom ? 'selected' : ''}>Custom...</option>
        </select>
        <input id="st-target-custom" value="${isCustom ? CONFIG.targetLang : ''}" placeholder="e.g. Catalan, Swahili" style="${inputStyle}display:${isCustom ? 'block' : 'none'};" />`;
      })()}


      <div id="st-advanced-section" style="display:${isAdvancedMode ? 'block' : 'none'};">

        <label style="${labelStyle}">Chunk Size <span style="opacity:0.5">(default ${PROVIDERS[CONFIG.provider]?.defaultChunkSize || 50} for ${PROVIDERS[CONFIG.provider]?.name || 'this provider'})</span></label>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:14px;">
          <input id="st-chunksize" type="number" value="${CONFIG.chunkSize}" placeholder="${PROVIDERS[CONFIG.provider]?.defaultChunkSize || 50}" min="10" max="500" style="${inputStyle};margin-bottom:0;flex:1;" />
          <button id="st-chunksize-reset" title="Reset to recommended default" style="padding:6px 10px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;cursor:pointer;font-size:11px;white-space:nowrap;">↺ Reset</button>
        </div>

        <div id="st-second-toggle" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:10px;">
          <div style="width:32px;height:18px;border-radius:9px;background:${CONFIG.secondEnabled ? PILL_ON : PILL_OFF};position:relative;transition:background 0.2s;" id="st-second-switch">
            <div style="width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:2px;${CONFIG.secondEnabled ? 'left:16px' : 'left:2px'};transition:left 0.2s;"></div>
          </div>
          <span style="font-size:12px;font-weight:600;">Second Model</span>
          <span style="font-size:11px;opacity:0.4;">use a stronger model after first pass</span>
        </div>
        <div id="st-second-section" style="display:${CONFIG.secondEnabled ? 'block' : 'none'};">
          <label style="${labelStyle}">Provider</label>
          <select id="st-second-provider" style="${selectStyle}">${Object.entries(PROVIDERS).filter(([,p]) => p.type === 'llm').map(([key, p]) =>
            `<option value="${key}" ${CONFIG.secondProvider === key ? 'selected' : ''}>${p.name}</option>`
          ).join('')}</select>
          <label style="${labelStyle}">Model</label>
          <div id="st-second-model-row" style="display:${CONFIG.secondProvider === 'ollama' ? 'flex' : 'none'};gap:6px;align-items:center;margin-bottom:14px;">
            <select id="st-second-model" style="${selectStyle};margin-bottom:0;flex:1;">${(() => {
              const secondProviderDef = PROVIDERS[CONFIG.secondProvider];
              if (CONFIG.secondProvider !== 'ollama' || !secondProviderDef?.models) return `<option value="${CONFIG.secondModel}" selected>${CONFIG.secondModel}</option>`;
              const isCustomSecond = !secondProviderDef.models.find(m => m.id === CONFIG.secondModel);
              return secondProviderDef.models.map(m => `<option value="${m.id}" ${CONFIG.secondModel === m.id ? 'selected' : ''}>${m.name}</option>`).join('')
                + `<option value="_custom" ${isCustomSecond ? 'selected' : ''}>Custom...</option>`;
            })()}</select>
            <button id="st-ollama-second-refresh" title="Fetch installed models from Ollama" style="padding:6px 10px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;cursor:pointer;font-size:11px;white-space:nowrap;">↻ Refresh</button>
          </div>
          <input id="st-second-model-text" value="${CONFIG.secondModel}" placeholder="e.g. qwen2.5:7b or gemini-2.5-flash" style="${inputStyle}display:${CONFIG.secondProvider === 'ollama' ? 'none' : 'block'};" />
          <input id="st-second-model-custom" placeholder="Custom model name" value="" style="${inputStyle}display:none;" />
          <div id="st-ollama-second-hint" style="display:none;font-size:11px;line-height:1.4;padding:8px 10px;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.25);border-radius:6px;margin:-8px 0 14px;"></div>
          <div style="font-size:11px;opacity:0.45;margin:-10px 0 12px 2px;line-height:1.3;">Pick a larger/stronger model than your first — it reviews and improves the initial translation.</div>
          <label style="${labelStyle}">API Key <span style="opacity:0.5">(blank = use primary key)</span></label>
          <input id="st-second-apikey" type="password" value="${CONFIG.secondApiKey}" placeholder="Leave blank to use primary key" style="${inputStyle}" />
          <label style="${labelStyle}">Chunk Size <span style="opacity:0.5">(default ${PROVIDERS[CONFIG.secondProvider]?.defaultChunkSize || 50} for ${PROVIDERS[CONFIG.secondProvider]?.name || 'this provider'})</span></label>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:14px;">
            <input id="st-second-chunksize" type="number" value="${CONFIG.secondChunkSize}" placeholder="${PROVIDERS[CONFIG.secondProvider]?.defaultChunkSize || 50}" min="20" max="500" step="10" style="${inputStyle};margin-bottom:0;flex:1;" />
            <button id="st-second-chunksize-reset" title="Reset to recommended default" style="padding:6px 10px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;cursor:pointer;font-size:11px;white-space:nowrap;">↺ Reset</button>
          </div>
          <div style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:10px 0;" id="st-fullpass-toggle">
            <div style="width:32px;height:18px;border-radius:9px;background:${CONFIG.fullPassEnabled ? PILL_ON : PILL_OFF};position:relative;transition:background 0.2s;" id="st-fullpass-switch">
              <div style="width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:2px;${CONFIG.fullPassEnabled ? 'left:16px' : 'left:2px'};transition:left 0.2s;"></div>
            </div>
            <span style="font-size:12px;font-weight:500;">Full Pass</span>
            <span style="font-size:11px;opacity:0.4;">retranslate all (off = flagged only)</span>
          </div>
          ${state.flaggedLines.size > 0 ? `<div style="padding:6px 10px;background:rgba(251,191,36,0.15);border-radius:6px;margin-bottom:10px;font-size:12px;">🚩 ${state.flaggedLines.size} lines currently flagged</div>` : ''}
        </div>

        <div style="border-top:1px solid rgba(255,255,255,0.1);margin:14px 0 10px;"></div>

        <div style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;opacity:0.4;margin-bottom:10px;">Overlay &amp; Playback</div>

        <div id="st-toggle-subs" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:6px;">
          <div style="width:32px;height:18px;border-radius:9px;background:${state.enabled ? PILL_ON : PILL_OFF};position:relative;transition:background 0.2s;" id="st-toggle-subs-switch">
            <div style="width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:2px;${state.enabled ? 'left:16px' : 'left:2px'};transition:left 0.2s;"></div>
          </div>
          <span style="font-size:12px;font-weight:500;">Subtitles (S)</span>
          <span style="font-size:11px;opacity:0.4;">show/hide translation overlay</span>
        </div>

        <div id="st-dual-subs" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:6px;">
          <div style="width:32px;height:18px;border-radius:9px;background:${state.dualSubs ? PILL_ON : PILL_OFF};position:relative;transition:background 0.2s;" id="st-dual-subs-switch">
            <div style="width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:2px;${state.dualSubs ? 'left:16px' : 'left:2px'};transition:left 0.2s;"></div>
          </div>
          <span style="font-size:12px;font-weight:500;">Dual Subs (O)</span>
          <span style="font-size:11px;opacity:0.4;">show original above translation</span>
        </div>

        <div id="st-show-orig-flagged" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:6px;">
          <div style="width:32px;height:18px;border-radius:9px;background:${state.showOrigOnFlagged ? PILL_ON : PILL_OFF};position:relative;transition:background 0.2s;" id="st-show-orig-flagged-switch">
            <div style="width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:2px;${state.showOrigOnFlagged ? 'left:16px' : 'left:2px'};transition:left 0.2s;"></div>
          </div>
          <span style="font-size:12px;font-weight:500;">Orig on flagged (Shift+O)</span>
          <span style="font-size:11px;opacity:0.4;">show original text for uncertain lines</span>
        </div>

        <div id="st-transcript" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px;">
          <div style="width:32px;height:18px;border-radius:9px;background:${state.transcriptVisible ? PILL_ON : PILL_OFF};position:relative;transition:background 0.2s;" id="st-transcript-switch">
            <div style="width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:2px;${state.transcriptVisible ? 'left:16px' : 'left:2px'};transition:left 0.2s;"></div>
          </div>
          <span style="font-size:12px;font-weight:500;">Transcript View (L)</span>
          <span style="font-size:11px;opacity:0.4;">scrollable transcript panel</span>
        </div>

        <label style="${labelStyle}">Font Size</label>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:14px;">
          <button id="st-fontsize-down" style="width:36px;height:36px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;cursor:pointer;font-size:18px;font-weight:700;line-height:1;">−</button>
          <span id="st-fontsize-display" style="flex:1;text-align:center;font-size:14px;font-weight:600;">${CONFIG.fontSize}</span>
          <button id="st-fontsize-up" style="width:36px;height:36px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;cursor:pointer;font-size:18px;font-weight:700;line-height:1;">+</button>
        </div>

        <label style="${labelStyle}">Timing Offset <span style="opacity:0.5">(ms, keys: D = delay / E = earlier)</span></label>
        <input id="st-offset" type="number" value="${CONFIG.timingOffset}" placeholder="0" step="100" style="${inputStyle}" />

        <label style="${labelStyle}">Offset Step <span style="opacity:0.5">(ms per D/E press)</span></label>
        <input id="st-offset-step" type="number" value="${CONFIG.timingStep}" placeholder="200" min="50" step="50" style="${inputStyle}" />

        <button id="st-retry" style="width:100%;padding:8px;background:rgba(59,130,246,0.3);border:1px solid rgba(59,130,246,0.4);border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-bottom:6px;">Retry Current Chunk (R)</button>
        <button id="st-retry-all" style="width:100%;padding:8px;background:rgba(59,130,246,0.3);border:1px solid rgba(59,130,246,0.4);border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-bottom:6px;">Retry All (Shift+A)</button>

        <button id="st-clear-cache" style="width:100%;padding:8px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-bottom:6px;">Clear Translation Cache (Shift+C)</button>

        <div style="opacity:0.4;font-size:11px;line-height:1.6;margin-bottom:10px;">
          Lines loaded: ${state.translatedCues.length} · Provider: ${currentProvider.name}${state.flaggedLines.size > 0 ? ` · <span style="color:#fbbf24;">${state.flaggedLines.size} flagged</span>` : ''}
        </div>

        <div style="border-top:1px solid rgba(255,255,255,0.1);margin:14px 0 10px;"></div>
        <div style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;opacity:0.4;margin-bottom:10px;">Prompt Context</div>

        <label style="${labelStyle}">Source Language <span style="opacity:0.5">(blank = auto)</span></label>
        <input id="st-source" value="${CONFIG.sourceLang}" placeholder="e.g. Japanese, Korean, ko, ja" style="${inputStyle}" />

        ${currentProvider.type === 'llm' ? `
        <div id="st-charnames-toggle" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px;">
          <div style="width:32px;height:18px;border-radius:9px;background:${CONFIG.showMetadata ? PILL_ON : PILL_OFF};position:relative;transition:background 0.2s;" id="st-charnames-switch">
            <div style="width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:2px;${CONFIG.showMetadata ? 'left:16px' : 'left:2px'};transition:left 0.2s;"></div>
          </div>
          <span style="font-size:12px;font-weight:500;">Character Names</span>
          <span style="font-size:11px;opacity:0.4;">auto-fetch cast names for consistent translation</span>
        </div>
        <div id="st-charnames-info" style="display:none;padding:8px 10px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.2);border-radius:6px;margin:-8px 0 14px;font-size:11px;line-height:1.4;"></div>
        <div id="st-show-synopsis-toggle" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px;">
          <div style="width:32px;height:18px;border-radius:9px;background:${CONFIG.showSynopsis ? PILL_ON : PILL_OFF};position:relative;transition:background 0.2s;" id="st-show-synopsis-switch">
            <div style="width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:2px;${CONFIG.showSynopsis ? 'left:16px' : 'left:2px'};transition:left 0.2s;"></div>
          </div>
          <span style="font-size:12px;font-weight:500;">Show Summary</span>
          <span style="font-size:11px;opacity:0.4;">add show synopsis to prompt for better context</span>
        </div>
        <div id="st-ep-synopsis-toggle" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px;">
          <div style="width:32px;height:18px;border-radius:9px;background:${CONFIG.episodeSynopsis ? PILL_ON : PILL_OFF};position:relative;transition:background 0.2s;" id="st-ep-synopsis-switch">
            <div style="width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:2px;${CONFIG.episodeSynopsis ? 'left:16px' : 'left:2px'};transition:left 0.2s;"></div>
          </div>
          <span style="font-size:12px;font-weight:500;">Episode Summary</span>
          <span style="font-size:11px;opacity:0.4;">add episode synopsis to prompt</span>
        </div>
        <div id="st-faststart-toggle" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px;">
          <div style="width:32px;height:18px;border-radius:9px;background:${CONFIG.fastStart ? PILL_ON : PILL_OFF};position:relative;transition:background 0.2s;" id="st-faststart-switch">
            <div style="width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:2px;${CONFIG.fastStart ? 'left:16px' : 'left:2px'};transition:left 0.2s;"></div>
          </div>
          <span style="font-size:12px;font-weight:500;">Fast Start</span>
          <span style="font-size:11px;opacity:0.4;">half-size first chunk for quicker initial results</span>
        </div>
        <div id="st-glossary-chunk-toggle" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px;">
          <div style="width:32px;height:18px;border-radius:9px;background:${CONFIG.glossaryPerChunk ? PILL_ON : PILL_OFF};position:relative;transition:background 0.2s;" id="st-glossary-chunk-switch">
            <div style="width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:2px;${CONFIG.glossaryPerChunk ? 'left:16px' : 'left:2px'};transition:left 0.2s;"></div>
          </div>
          <span style="font-size:12px;font-weight:500;">Per-chunk Glossary</span>
          <span style="font-size:11px;opacity:0.4;">extract names &amp; terms from each chunk as it translates</span>
        </div>
        <div id="st-glossary-upfront-toggle" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px;">
          <div style="width:32px;height:18px;border-radius:9px;background:${CONFIG.glossaryUpfront ? PILL_ON : PILL_OFF};position:relative;transition:background 0.2s;" id="st-glossary-upfront-switch">
            <div style="width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:2px;${CONFIG.glossaryUpfront ? 'left:16px' : 'left:2px'};transition:left 0.2s;"></div>
          </div>
          <span style="font-size:12px;font-weight:500;">Upfront Glossary</span>
          <span style="font-size:11px;opacity:0.4;">scan full script for names before translating (1 extra call)</span>
        </div>
        ${CONFIG.secondEnabled ? `<div id="st-glossary-upfront-second-toggle" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px;">
          <div style="width:32px;height:18px;border-radius:9px;background:${CONFIG.glossaryUpfrontSecond ? PILL_ON : PILL_OFF};position:relative;transition:background 0.2s;" id="st-glossary-upfront-second-switch">
            <div style="width:14px;height:14px;border-radius:50%;background:white;position:absolute;top:2px;${CONFIG.glossaryUpfrontSecond ? 'left:16px' : 'left:2px'};transition:left 0.2s;"></div>
          </div>
          <span style="font-size:12px;font-weight:500;">Upfront Glossary (2nd model)</span>
          <span style="font-size:11px;opacity:0.4;">re-scan with second model before its pass</span>
        </div>` : ''}
        ` : ''}

      </div>

      <div id="st-advanced-toggle" style="text-align:center;margin:10px 0 14px;cursor:pointer;">
        <span style="font-size:12px;color:rgba(255,255,255,0.5);">${isAdvancedMode ? '▲ Hide advanced settings' : '▼ Show advanced settings'}</span>
      </div>

      </div>

      <div id="st-shortcuts-toggle" style="text-align:center;margin-top:12px;cursor:pointer;">
        <span style="font-size:12px;color:rgba(255,255,255,0.4);">⌨ Show keyboard shortcuts</span>
      </div>
      <div id="st-shortcuts-section" style="display:none;padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;margin-top:6px;">
        <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:baseline;font-size:12px;">
          <kbd style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:3px;font-size:11px;font-family:monospace;white-space:nowrap;">Shift+S</kbd><span style="opacity:0.6;">Master ON/OFF (stops all translation)</span>
          <kbd style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:3px;font-size:11px;font-family:monospace;white-space:nowrap;">S</kbd><span style="opacity:0.6;">Toggle subtitles on/off</span>
          <kbd style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:3px;font-size:11px;font-family:monospace;white-space:nowrap;">O</kbd><span style="opacity:0.6;">Dual subs (original + translation)</span>
          <kbd style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:3px;font-size:11px;font-family:monospace;white-space:nowrap;">Shift+O</kbd><span style="opacity:0.6;">Show original on flagged lines</span>
          <kbd style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:3px;font-size:11px;font-family:monospace;white-space:nowrap;">L</kbd><span style="opacity:0.6;">Transcript panel</span>
          <kbd style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:3px;font-size:11px;font-family:monospace;white-space:nowrap;">R</kbd><span style="opacity:0.6;">Retry current chunk</span>
          <kbd style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:3px;font-size:11px;font-family:monospace;white-space:nowrap;">Shift+A</kbd><span style="opacity:0.6;">Retranslate everything</span>
          <kbd style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:3px;font-size:11px;font-family:monospace;white-space:nowrap;">Shift+C</kbd><span style="opacity:0.6;">Clear translation cache</span>
          <kbd style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:3px;font-size:11px;font-family:monospace;white-space:nowrap;">D / E</kbd><span style="opacity:0.6;">Delay / Earlier timing</span>
          <kbd style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:3px;font-size:11px;font-family:monospace;white-space:nowrap;">Shift+T</kbd><span style="opacity:0.6;">This settings panel</span>
        </div>
      </div>
    `;

    document.body.appendChild(state.panelEl);

    // --- Events ---
    state.panelEl.querySelector('#st-close').addEventListener('click', () => togglePanel());

    const welcomeDismiss = state.panelEl.querySelector('#st-welcome-dismiss');
    if (welcomeDismiss) {
      welcomeDismiss.addEventListener('click', () => {
        GM_setValue('welcomeDismissed', true);
        state.panelEl.querySelector('#st-welcome').remove();
      });
    }

    state.panelEl.querySelector('#st-master-toggle').addEventListener('click', () => {
      applyMasterToggle();
    });

    // Shortcuts toggle
    state.panelEl.querySelector('#st-shortcuts-toggle').addEventListener('click', () => {
      const section = state.panelEl.querySelector('#st-shortcuts-section');
      const label = state.panelEl.querySelector('#st-shortcuts-toggle span');
      const visible = section.style.display !== 'none';
      section.style.display = visible ? 'none' : 'block';
      label.textContent = visible ? '⌨ Show keyboard shortcuts' : '⌨ Hide keyboard shortcuts';
    });

    // Advanced settings toggle
    state.panelEl.querySelector('#st-advanced-toggle').addEventListener('click', () => {
      CONFIG.advancedMode = !CONFIG.advancedMode;
      const section = state.panelEl.querySelector('#st-advanced-section');
      const label = state.panelEl.querySelector('#st-advanced-toggle span');
      section.style.display = CONFIG.advancedMode ? 'block' : 'none';
      label.textContent = CONFIG.advancedMode ? '▲ Hide advanced settings' : '▼ Show advanced settings';
      GM_setValue('advancedMode', CONFIG.advancedMode);
    });

    // Instructions button — opens guide in new tab
    state.panelEl.querySelector('#st-instructions').addEventListener('click', () => {
      const w = window.open('', '_blank');
      w.document.write(INSTRUCTIONS_HTML);
      w.document.close();
    });

    // Character Names toggle (show metadata)
    const charnamesToggle = state.panelEl.querySelector('#st-charnames-toggle');
    const charnamesSwitch = state.panelEl.querySelector('#st-charnames-switch');
    const charnamesInfo = state.panelEl.querySelector('#st-charnames-info');
    if (charnamesToggle && charnamesSwitch) {
      charnamesToggle.addEventListener('click', () => {
        CONFIG.showMetadata = !CONFIG.showMetadata;
        charnamesSwitch.style.background = CONFIG.showMetadata ? PILL_ON : PILL_OFF;
        charnamesSwitch.querySelector('div').style.left = CONFIG.showMetadata ? '16px' : '2px';
        GM_setValue('showMetadata', CONFIG.showMetadata);
        if (charnamesInfo) charnamesInfo.style.display = (CONFIG.showMetadata && _showMetadata) ? 'block' : 'none';
      });
      // Show cached metadata info if available
      if (charnamesInfo && _showMetadata && CONFIG.showMetadata) {
        const showMeta = _showMetadata;
        const castSummary = showMeta.hasCharacterNames
          ? showMeta.cast.slice(0, 8).filter(x => x.character).map(x => x.character).join(', ')
            + (showMeta.cast.filter(x => x.character).length > 8 ? ` +${showMeta.cast.filter(x => x.character).length - 8} more` : '')
          : 'actor names only (no character names available)';
        charnamesInfo.innerHTML = `🎬 <strong>${showMeta.title}</strong>${showMeta.year ? ` (${showMeta.year})` : ''}${showMeta.episode ? ` · S${showMeta.episode.season}E${showMeta.episode.episode}` : ''}<br>` +
          `<span style="opacity:0.7;">Cast: ${castSummary}</span>`;
        charnamesInfo.style.display = 'block';
      }
    }

    wireToggle(state.panelEl, 'st-show-synopsis',         'showSynopsis');
    wireToggle(state.panelEl, 'st-ep-synopsis',           'episodeSynopsis');
    wireToggle(state.panelEl, 'st-faststart',             'fastStart');
    wireToggle(state.panelEl, 'st-glossary-chunk',        'glossaryPerChunk');
    wireToggle(state.panelEl, 'st-glossary-upfront',      'glossaryUpfront');
    wireToggle(state.panelEl, 'st-glossary-upfront-second', 'glossaryUpfrontSecond');

    state.panelEl.querySelector('#st-target').addEventListener('change', (e) => {
      const customInput = state.panelEl.querySelector('#st-target-custom');
      customInput.style.display = e.target.value === '_custom' ? 'block' : 'none';
      if (e.target.value === '_custom') customInput.focus();
    });

    state.panelEl.querySelector('#st-provider').addEventListener('change', (e) => {
      CONFIG.provider = e.target.value;
      const selectedProvider = PROVIDERS[CONFIG.provider];
      CONFIG.model = selectedProvider?.defaultModel || '';
      // Load user's saved chunk size for this provider, or provider default
      CONFIG.chunkSize = CONFIG.chunkSizes[CONFIG.provider] || selectedProvider?.defaultChunkSize || 50;
      // Auto-set second model defaults when switching to Ollama (only if user hasn't configured second model yet)
      if (CONFIG.provider === 'ollama' && selectedProvider?.defaultSecondModel && !CONFIG.secondModel) {
        CONFIG.secondProvider = 'ollama';
        CONFIG.secondModel = selectedProvider.defaultSecondModel;
      }
      state.panelEl.remove(); state.panelEl = null;
      togglePanel();
    });

    // Reset chunk size buttons
    state.panelEl.querySelector('#st-chunksize-reset')?.addEventListener('click', () => {
      const def = PROVIDERS[CONFIG.provider]?.defaultChunkSize || 50;
      state.panelEl.querySelector('#st-chunksize').value = def;
      delete CONFIG.chunkSizes[CONFIG.provider]; // clear user override
    });
    state.panelEl.querySelector('#st-second-chunksize-reset')?.addEventListener('click', () => {
      const secondProv = state.panelEl.querySelector('#st-second-provider')?.value || CONFIG.secondProvider;
      const def = PROVIDERS[secondProv]?.defaultChunkSize || 50;
      state.panelEl.querySelector('#st-second-chunksize').value = def;
      delete CONFIG.secondChunkSizes[secondProv]; // clear user override
    });

    const modelSelect = state.panelEl.querySelector('#st-model');
    const modelCustom = state.panelEl.querySelector('#st-model-custom');
    if (modelSelect && modelCustom) {
      modelSelect.addEventListener('change', () => {
        modelCustom.style.display = modelSelect.value === '_custom' ? 'block' : 'none';
      });
    }

    // Wire Ollama-specific panel elements (URL check, model dropdowns, refresh buttons)
    const ollama = wireOllamaPanel(state.panelEl, modelSelect, modelCustom);

    // Second model toggle
    const secondToggle = state.panelEl.querySelector('#st-second-toggle');
    const secondSection = state.panelEl.querySelector('#st-second-section');
    const secondSwitch = state.panelEl.querySelector('#st-second-switch');
    if (secondToggle) {
      secondToggle.addEventListener('click', () => {
        CONFIG.secondEnabled = !CONFIG.secondEnabled;
        secondSection.style.display = CONFIG.secondEnabled ? 'block' : 'none';
        secondSwitch.style.background = CONFIG.secondEnabled ? PILL_ON : PILL_OFF;
        secondSwitch.querySelector('div').style.left = CONFIG.secondEnabled ? '16px' : '2px';
        // Hide Ollama hint when second model is enabled
        const ollamaHint = state.panelEl.querySelector('#st-ollama-hint');
        if (ollamaHint) ollamaHint.style.display = (!CONFIG.secondEnabled && CONFIG.provider === 'ollama') ? 'block' : 'none';
        // Toggle Ollama dropdown vs text input visibility
        if (CONFIG.secondEnabled) ollama.loadSecondOllamaModels(false);
      });
    }

    const fullPassToggle = state.panelEl.querySelector('#st-fullpass-toggle');
    const fullPassSwitch = state.panelEl.querySelector('#st-fullpass-switch');
    if (fullPassToggle) {
      fullPassToggle.addEventListener('click', () => {
        CONFIG.fullPassEnabled = !CONFIG.fullPassEnabled;
        fullPassSwitch.style.background = CONFIG.fullPassEnabled ? PILL_ON : PILL_OFF;
        fullPassSwitch.querySelector('div').style.left = CONFIG.fullPassEnabled ? '16px' : '2px';
      });
    }

    // Auto-set second chunk size when second provider changes
    const secondProvSelect = state.panelEl.querySelector('#st-second-provider');
    if (secondProvSelect) {
      secondProvSelect.addEventListener('change', (e) => {
        const changedProvider = PROVIDERS[e.target.value];
        const saved = CONFIG.secondChunkSizes[e.target.value];
        const chunkInput = state.panelEl.querySelector('#st-second-chunksize');
        if (chunkInput) chunkInput.value = saved || changedProvider?.defaultChunkSize || 50;
        // Reload Ollama dropdown vs text input visibility for second model
        ollama.loadSecondOllamaModels(false);
      });
    }

    // Font size stepper
    function updateFontSize(delta) {
      const current = parseFloat(CONFIG.fontSize) || 2.2;
      const unit = CONFIG.fontSize.replace(/[\d.]+/, '') || 'vw';
      const step = unit === 'px' ? 2 : 0.2;
      const newVal = Math.max(step, Math.round((current + delta * step) * 10) / 10);
      CONFIG.fontSize = newVal + unit;
      const display = state.panelEl.querySelector('#st-fontsize-display');
      if (display) display.textContent = CONFIG.fontSize;
      // Live preview
      if (state.overlayEl) state.overlayEl.style.fontSize = CONFIG.fontSize;
      if (state.origOverlayEl) state.origOverlayEl.style.fontSize = `calc(${CONFIG.fontSize} * 0.75)`;
    }
    state.panelEl.querySelector('#st-fontsize-up').addEventListener('click', () => updateFontSize(1));
    state.panelEl.querySelector('#st-fontsize-down').addEventListener('click', () => updateFontSize(-1));

    // Collect current settings from panel inputs and persist
    function collectAndSave() {
      CONFIG.provider = state.panelEl.querySelector('#st-provider').value;

      const keyInput = state.panelEl.querySelector('#st-apikey');
      if (keyInput) CONFIG.apiKey = keyInput.value.trim();

      const ollamaInput = state.panelEl.querySelector('#st-ollama-url');
      if (ollamaInput) CONFIG.ollamaUrl = ollamaInput.value.trim() || 'http://localhost:11434';

      const libreInput = state.panelEl.querySelector('#st-libre-url');
      if (libreInput) CONFIG.libreTranslateUrl = libreInput.value.trim() || 'https://libretranslate.com';

      if (modelSelect) {
        CONFIG.model = modelSelect.value === '_custom'
          ? (modelCustom?.value.trim() || PROVIDERS[CONFIG.provider]?.defaultModel || '')
          : modelSelect.value;
      }

      const targetSelect = state.panelEl.querySelector('#st-target');
      CONFIG.targetLang = targetSelect.value === '_custom'
        ? (state.panelEl.querySelector('#st-target-custom').value.trim() || 'English')
        : (targetSelect.value || 'English');
      CONFIG.sourceLang = state.panelEl.querySelector('#st-source').value.trim();

      CONFIG.fontSize = state.panelEl.querySelector('#st-fontsize-display').textContent.trim() || '2.2vw';
      CONFIG.chunkSize = Math.max(10, Math.min(500, parseInt(state.panelEl.querySelector('#st-chunksize').value) || 150));
      CONFIG.timingOffset = parseInt(state.panelEl.querySelector('#st-offset').value) || 0;
      CONFIG.timingStep = Math.max(50, parseInt(state.panelEl.querySelector('#st-offset-step').value) || 200);
      if (state.overlayEl) state.overlayEl.style.fontSize = CONFIG.fontSize;

      // Second model settings
      const secondProvInput = state.panelEl.querySelector('#st-second-provider');
      if (secondProvInput) CONFIG.secondProvider = secondProvInput.value;
      const secondModelSelect = state.panelEl.querySelector('#st-second-model');
      const secondModelCustom = state.panelEl.querySelector('#st-second-model-custom');
      const secondModelText = state.panelEl.querySelector('#st-second-model-text');
      if (CONFIG.secondProvider === 'ollama' && secondModelSelect) {
        CONFIG.secondModel = secondModelSelect.value === '_custom'
          ? (secondModelCustom?.value.trim() || PROVIDERS.ollama.defaultSecondModel || '')
          : secondModelSelect.value;
      } else if (secondModelText) {
        CONFIG.secondModel = secondModelText.value.trim();
      }
      const secondKeyInput = state.panelEl.querySelector('#st-second-apikey');
      if (secondKeyInput) CONFIG.secondApiKey = secondKeyInput.value.trim();
      const secondChunkInput = state.panelEl.querySelector('#st-second-chunksize');
      if (secondChunkInput) CONFIG.secondChunkSize = Math.max(20, Math.min(300, parseInt(secondChunkInput.value) || 100));

      saveConfig();
    }

    // Auto-save on blur (text inputs, password) and change (selects/dropdowns)
    state.panelEl.querySelectorAll('input[type="text"], input[type="number"], input[type="password"], input:not([type])').forEach(el => {
      el.addEventListener('blur', collectAndSave);
    });
    state.panelEl.querySelectorAll('select').forEach(el => {
      el.addEventListener('change', collectAndSave);
    });

    state.panelEl.querySelector('#st-toggle-subs').addEventListener('click', () => {
      applySubtitleToggle();
    });

    state.panelEl.querySelector('#st-dual-subs').addEventListener('click', () => {
      applyDualSubsToggle();
    });

    state.panelEl.querySelector('#st-show-orig-flagged').addEventListener('click', () => {
      applyOrigOnFlaggedToggle();
    });

    state.panelEl.querySelector('#st-retry').addEventListener('click', () => {
      togglePanel();
      retryCurrentChunk();
    });

    state.panelEl.querySelector('#st-retry-all').addEventListener('click', () => {
      togglePanel();
      retranslateAll();
    });

    state.panelEl.querySelector('#st-clear-cache').addEventListener('click', () => {
      cacheClear();
      state.translatedCues = [];
      showStatus('Cache cleared', 'success');
    });

    state.panelEl.querySelector('#st-transcript').addEventListener('click', () => {
      applyTranscriptToggle();
    });
  }
