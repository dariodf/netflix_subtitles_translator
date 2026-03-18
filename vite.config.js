import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
    },
  },
  plugins: [
    monkey({
      entry: 'src/browser/main.js',
      userscript: {
        name: 'Netflix Subtitle Translator',
        namespace: 'http://tampermonkey.net/',
        version,
        description: 'Intercept Netflix subtitles, translate via multiple providers, overlay on video',
        match: [
          'https://www.netflix.com/*',
          'https://netflix.com/*',
        ],
        'run-at': 'document-start',
        grant: [
          'GM_xmlhttpRequest',
          'GM_setValue',
          'GM_getValue',
          'GM_registerMenuCommand',
        ],
        connect: '*',
        license: 'MIT',
      },
      build: {
        fileName: 'netflix-subtitle-translator.user.js',
      },
    }),
  ],
});
