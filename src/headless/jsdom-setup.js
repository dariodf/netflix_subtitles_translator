import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';

/** Provide browser globals (DOMParser, Node) required by the TTML parser. */
export function setupJsdom() {
  if (globalThis.DOMParser) return; // already set up
  const dom = new JSDOM('');
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.Node = dom.window.Node;
}

/**
 * Read a config JSON file and resolve single-level "extends" inheritance.
 * Returns the merged plain object (no defaults applied — callers do that).
 */
export function resolveConfigFile(configPath, configsDir) {
  const userConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  let baseConfig = {};
  if (userConfig.extends) {
    const basePath = join(configsDir, `${userConfig.extends}.json`);
    if (existsSync(basePath)) baseConfig = JSON.parse(readFileSync(basePath, 'utf-8'));
    delete userConfig.extends;
  }
  return { ...baseConfig, ...userConfig };
}
