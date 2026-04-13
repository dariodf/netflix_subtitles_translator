import { CONFIG } from '../../config.js';
import { PROVIDERS } from '../../core/providers/definitions.js';
import { escapeHtml } from '../../core/utils.js';
import { fetchOllamaModels, buildOllamaModelOptions, clearOllamaModelsCache, fetchOllamaVisionModels } from '../../providers/ollama.js';

/** Check if Ollama is reachable at the given URL */
function checkOllamaUrl(urlInput, checkBtn) {
  const url = urlInput.value.trim().replace(/\/+$/, '');
  if (!url) return;
  checkBtn.textContent = '⟳';
  checkBtn.style.opacity = '0.5';
  checkBtn.style.borderColor = 'rgba(255,255,255,0.2)';
  // Spin animation via interval
  let angle = 0;
  const spin = setInterval(() => { angle = (angle + 45) % 360; checkBtn.style.transform = `rotate(${angle}deg)`; }, 100);
  const showResult = (ok) => {
    clearInterval(spin);
    checkBtn.style.transform = '';
    checkBtn.textContent = ok ? '✔' : '✘';
    checkBtn.style.opacity = '1';
    checkBtn.style.borderColor = ok ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)';
    checkBtn.style.color = ok ? '#22c55e' : '#ef4444';
  };
  GM_xmlhttpRequest({
    method: 'GET',
    url: url + '/api/tags',
    timeout: 3000,
    onload(resp) { showResult(resp.status >= 200 && resp.status < 400); },
    onerror() { showResult(false); },
    ontimeout() { showResult(false); },
  });
}

/** Populate an Ollama model dropdown from /api/tags */
function populateOllamaDropdown(selectEl, customEl, hintEl, selectedModel, recommendedId, recommendedLabel) {
  if (!selectEl) return Promise.resolve();
  return fetchOllamaModels().then(models => {
    if (!models) {
      // Ollama not running or unreachable
      const fallbackProv = PROVIDERS.ollama;
      selectEl.innerHTML = (fallbackProv.models || []).map(m =>
        `<option value="${m.id}" ${m.id === selectedModel ? 'selected' : ''}>${m.name}</option>`
      ).join('') + `<option value="_custom">Custom...</option>`;
      if (hintEl) {
        hintEl.style.display = 'block';
        hintEl.innerHTML = '⚠️ Could not reach Ollama at <code>' + escapeHtml(CONFIG.localUrl) + '</code>. Is it running? Start it with <code>ollama serve</code>';
      }
      return;
    }
    const opts = buildOllamaModelOptions(models, selectedModel, recommendedId);
    if (opts) {
      selectEl.innerHTML = opts;
      // If current model not in list, add it at top as custom
      if (selectedModel && !models.find(m => m.id === selectedModel)) {
        selectEl.insertAdjacentHTML('afterbegin',
          `<option value="${selectedModel}" selected>${selectedModel} (not installed)</option>`);
      }
    }
    if (customEl && !selectEl._customListenerWired) {
      selectEl._customListenerWired = true;
      selectEl.addEventListener('change', () => {
        customEl.style.display = selectEl.value === '_custom' ? 'block' : 'none';
      });
    }
    // Show hint if recommended model is missing
    if (hintEl && recommendedId) {
      const hasRec = models.some(m => m.id === recommendedId);
      if (!hasRec) {
        hintEl.style.display = 'block';
        hintEl.innerHTML = `💡 ${recommendedLabel || recommendedId} is recommended but not installed. Run: <code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:3px;">ollama pull ${recommendedId}</code>`;
      } else {
        hintEl.style.display = 'none';
      }
    }
  });
}

/** Toggle second model Ollama dropdown vs text input */
function loadSecondOllamaModels(panelEl, doFetch = false) {
  const secondSelect = panelEl.querySelector('#st-second-model');
  const secondCustom = panelEl.querySelector('#st-second-model-custom');
  const secondHint = panelEl.querySelector('#st-ollama-second-hint');
  const secondText = panelEl.querySelector('#st-second-model-text');
  const secondRow = panelEl.querySelector('#st-second-model-row');
  const secondProvKey = panelEl.querySelector('#st-second-provider')?.value;
  if (secondProvKey === 'ollama') {
    if (secondRow) secondRow.style.display = 'flex';
    if (secondText) secondText.style.display = 'none';
    if (doFetch) {
      clearOllamaModelsCache();
      return populateOllamaDropdown(
        secondSelect, secondCustom, secondHint,
        secondSelect?.value || CONFIG.secondModel, 'qwen2.5:7b', 'Qwen 2.5 7B (higher quality for second pass)'
      );
    }
  } else {
    if (secondRow) secondRow.style.display = 'none';
    if (secondText) secondText.style.display = 'block';
    if (secondHint) secondHint.style.display = 'none';
    if (secondCustom) secondCustom.style.display = 'none';
  }
}

/** Wire all Ollama-specific panel elements (URL check, model dropdowns, refresh buttons) */
export function wireOllamaPanel(panelEl, modelSelect, modelCustom) {
  // Ollama URL reachability check
  const localUrlInput = panelEl.querySelector('#st-local-url');
  const ollamaCheckBtn = panelEl.querySelector('#st-ollama-check');
  if (localUrlInput && ollamaCheckBtn) {
    ollamaCheckBtn.addEventListener('click', () => checkOllamaUrl(localUrlInput, ollamaCheckBtn));
    localUrlInput.addEventListener('blur', () => checkOllamaUrl(localUrlInput, ollamaCheckBtn));
  }

  // Wire Ollama refresh button for primary model
  const ollamaRefreshBtn = panelEl.querySelector('#st-ollama-refresh');
  if (ollamaRefreshBtn) {
    ollamaRefreshBtn.addEventListener('click', () => {
      ollamaRefreshBtn.textContent = '↻ ...';
      ollamaRefreshBtn.disabled = true;
      clearOllamaModelsCache(); // force fresh fetch
      populateOllamaDropdown(
        modelSelect, modelCustom,
        panelEl.querySelector('#st-ollama-model-hint'),
        modelSelect.value, 'qwen2.5:3b', 'Qwen 2.5 3B (fast, good multilingual)'
      ).then(() => {
        ollamaRefreshBtn.textContent = '↻ Refresh';
        ollamaRefreshBtn.disabled = false;
      });
    });
  }

  // Wire Ollama refresh button for second model
  const ollamaSecondRefreshBtn = panelEl.querySelector('#st-ollama-second-refresh');
  if (ollamaSecondRefreshBtn) {
    ollamaSecondRefreshBtn.addEventListener('click', () => {
      ollamaSecondRefreshBtn.textContent = '↻ ...';
      ollamaSecondRefreshBtn.disabled = true;
      (loadSecondOllamaModels(panelEl, true) || Promise.resolve()).then(() => {
        ollamaSecondRefreshBtn.textContent = '↻ Refresh';
        ollamaSecondRefreshBtn.disabled = false;
      });
    });
  }

  // Populate image model dropdown with vision-capable Ollama models
  const imageModelSelect = panelEl.querySelector('#st-image-model');
  const visionProviderKey = CONFIG.imageVisionProvider || CONFIG.provider;
  if (imageModelSelect && visionProviderKey === 'ollama') {
    fetchOllamaVisionModels().then(visionModels => {
      if (!visionModels || !imageModelSelect.isConnected) return;
      const currentVal = CONFIG.imageVisionModel;
      let opts = '<option value="">Disabled</option>';
      opts += visionModels.map(m => {
        const label = m.paramSize ? `${m.id} (${m.paramSize})` : m.id;
        return `<option value="${m.id}" ${m.id === currentVal ? 'selected' : ''}>${label}</option>`;
      }).join('');
      // Keep current value if not in list
      if (currentVal && !visionModels.find(m => m.id === currentVal)) {
        opts += `<option value="${currentVal}" selected>${currentVal} (not installed)</option>`;
      }
      opts += '<option value="_custom">Custom...</option>';
      imageModelSelect.innerHTML = opts;
    });
  }

  // Return loadSecondOllamaModels bound to this panel for use in toggle/change handlers
  return {
    loadSecondOllamaModels: (doFetch = false) => loadSecondOllamaModels(panelEl, doFetch),
  };
}
