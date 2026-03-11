export function fetchJsonViaGM(url, timeout = 8000) {
  return new Promise((resolve) => {
    GM_xmlhttpRequest({
      method: 'GET', url, timeout,
      onload(resp) {
        try { resolve(JSON.parse(resp.responseText)); }
        catch { resolve(null); }
      },
      onerror() { resolve(null); },
      ontimeout() { resolve(null); },
    });
  });
}

export function postJsonViaGM(url, headers, data, timeout = 30000) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'POST', url, headers,
      data: typeof data === 'string' ? data : JSON.stringify(data),
      timeout,
      onload(resp) {
        try { resolve({ status: resp.status, data: JSON.parse(resp.responseText) }); }
        catch (err) { reject(new Error('Parse error: ' + err.message)); }
      },
      onerror() { reject(new Error('Network error')); },
      ontimeout() { reject(new Error('Request timed out')); },
    });
  });
}
