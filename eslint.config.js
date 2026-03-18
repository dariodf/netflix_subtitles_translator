import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Tampermonkey / Greasemonkey APIs
        GM_getValue: 'readonly',
        GM_setValue: 'readonly',
        GM_xmlhttpRequest: 'readonly',
        GM_registerMenuCommand: 'readonly',
        // Vite build-time constants
        __APP_VERSION__: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/headless/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
