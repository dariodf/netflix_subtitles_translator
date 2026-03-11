import { readFileSync, writeFileSync, existsSync } from 'fs';

export function createFileCache(filePath) {
  let data = {};

  if (existsSync(filePath)) {
    try {
      data = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      data = {};
    }
  }

  function save() {
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  return {
    get(key) {
      return data[key] ?? null;
    },

    set(key, value) {
      data[key] = value;
      save();
    },

    setWithUrl(key, translatedCues, originalCues, cacheExtra) {
      data[key] = translatedCues;
      // Also save a url-based entry for consistency with browser cache
      if (cacheExtra?.url) {
        data['url:' + cacheExtra.url] = {
          cacheKey: key,
          translatedCues,
          originalCues,
          ...cacheExtra,
        };
      }
      save();
    },

    clear() {
      data = {};
      save();
    },
  };
}
