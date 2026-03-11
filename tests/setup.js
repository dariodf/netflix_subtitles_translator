// Stub Tampermonkey globals for testing
globalThis.GM_getValue = (key, defaultValue) => defaultValue;
globalThis.GM_setValue = () => {};
globalThis.GM_registerMenuCommand = () => {};
globalThis.GM_xmlhttpRequest = (opts) => {
  if (globalThis._gmXhrMock) globalThis._gmXhrMock(opts);
};
