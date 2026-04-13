import { CONFIG } from '../../config.js';
import { escapeHtml } from '../../core/utils.js';
import { fetchLMStudioModels, clearLMStudioModelsCache } from '../../providers/lmstudio.js';

/** Check if LM Studio is reachable by hitting /v1/models */
function checkLMStudioUrl(urlInput, checkBtn) {
  const url = urlInput.value.trim().replace(/\/+$/, '');
  if (!url) return;
  checkBtn.textContent = '⟳';
  checkBtn.style.opacity = '0.5';
  checkBtn.style.borderColor = 'rgba(255,255,255,0.2)';
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
    url: url + '/v1/models',
    timeout: 3000,
    onload(resp) { showResult(resp.status >= 200 && resp.status < 400); },
    onerror() { showResult(false); },
    ontimeout() { showResult(false); },
  });
}

/** Populate the LM Studio model dropdown from /v1/models */
function populateLMStudioDropdown(selectEl, hintEl, selectedModel) {
  if (!selectEl) return Promise.resolve();
  return fetchLMStudioModels().then(models => {
    if (!models) {
      selectEl.innerHTML = selectedModel
        ? `<option value="${escapeHtml(selectedModel)}" selected>${escapeHtml(selectedModel)}</option>`
        : '<option value="">No models loaded</option>';
      selectEl.innerHTML += '<option value="_custom">Custom...</option>';
      if (hintEl) {
        hintEl.style.display = 'block';
        hintEl.innerHTML = '⚠️ Could not reach LM Studio at <code>' + escapeHtml(CONFIG.localUrl || 'http://localhost:1234') + '</code>. Is it running with the server enabled?';
      }
      return;
    }
    let opts = models.map(m =>
      `<option value="${escapeHtml(m.id)}" ${m.id === selectedModel ? 'selected' : ''}>${escapeHtml(m.id)}</option>`
    ).join('');
    if (selectedModel && !models.find(m => m.id === selectedModel)) {
      opts = `<option value="${escapeHtml(selectedModel)}" selected>${escapeHtml(selectedModel)}</option>` + opts;
    }
    opts += '<option value="_custom">Custom...</option>';
    selectEl.innerHTML = opts;
    if (hintEl) hintEl.style.display = 'none';
  });
}

/** Wire all LM Studio-specific panel elements */
export function wireLMStudioPanel(panelEl, modelSelect, modelCustom) {
  const localUrlInput = panelEl.querySelector('#st-local-url');
  const checkBtn = panelEl.querySelector('#st-lmstudio-check');
  if (localUrlInput && checkBtn) {
    checkBtn.addEventListener('click', () => checkLMStudioUrl(localUrlInput, checkBtn));
    localUrlInput.addEventListener('blur', () => checkLMStudioUrl(localUrlInput, checkBtn));
  }

  const refreshBtn = panelEl.querySelector('#st-lmstudio-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.textContent = '↻ ...';
      refreshBtn.disabled = true;
      clearLMStudioModelsCache();
      populateLMStudioDropdown(
        modelSelect,
        panelEl.querySelector('#st-lmstudio-model-hint'),
        modelSelect?.value,
      ).then(() => {
        refreshBtn.textContent = '↻ Refresh';
        refreshBtn.disabled = false;
      });
    });
  }

  if (modelSelect && modelCustom) {
    modelSelect.addEventListener('change', () => {
      modelCustom.style.display = modelSelect.value === '_custom' ? 'block' : 'none';
    });
  }

  // Initial population
  populateLMStudioDropdown(
    modelSelect,
    panelEl.querySelector('#st-lmstudio-model-hint'),
    CONFIG.model,
  );
}
