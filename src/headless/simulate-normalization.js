#!/usr/bin/env node

/**
 * Simulate speaker name normalization against existing translated output.
 * No LLM needed — runs purely against cached translation files.
 *
 * Usage:
 *   node src/headless/simulate-normalization.js <path/to/output.translated.json>
 *   node src/headless/simulate-normalization.js runs/only-7b/smoke-ko-drama/abc1234/output.translated.json
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { normalizeSpeakerNames } from '../core/speaker-labels.js';
import { buildNameMap, countNameInconsistencies } from './analyze.js';

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node src/headless/simulate-normalization.js <output.translated.json>');
    process.exit(1);
  }

  const fullPath = resolve(filePath);
  const output = JSON.parse(readFileSync(fullPath, 'utf-8'));
  const { cues, originalCues } = output;

  console.log(`\nFile: ${filePath}`);
  console.log(`Episode: ${output.episode || 'unknown'}`);
  console.log(`Total cues: ${cues.length}`);

  // Before normalization
  const nameMapBefore = buildNameMap(cues);
  const inconsistenciesBefore = countNameInconsistencies(nameMapBefore);

  console.log(`\n--- Before normalization ---`);
  console.log(`  Name inconsistencies: ${inconsistenciesBefore}`);
  const inconsistentBefore = Object.entries(nameMapBefore).filter(([, d]) => Object.keys(d.variants).length > 1);
  for (const [sourceName, data] of inconsistentBefore) {
    const variants = Object.entries(data.variants)
      .map(([v, indices]) => `${v} (${indices.length}x)`)
      .join(', ');
    console.log(`    ${sourceName} → ${variants} [majority: ${data.majority}]`);
  }

  // Run normalization on a copy
  const sourceCues = originalCues.map(c => ({ text: c.text }));
  const translatedCues = cues.map(c => ({
    text: c.translated,
    begin: c.begin || 0,
    end: c.end || 0,
  }));

  const cast = output.config?.cast || [];
  const { normalizedCount, canonicalNames } = normalizeSpeakerNames(sourceCues, translatedCues, cast);

  // After normalization
  const normalizedCues = cues.map((c, i) => ({
    ...c,
    translated: translatedCues[i].text,
  }));
  const nameMapAfter = buildNameMap(normalizedCues);
  const inconsistenciesAfter = countNameInconsistencies(nameMapAfter);

  console.log(`\n--- After normalization ---`);
  console.log(`  Name inconsistencies: ${inconsistenciesAfter}`);
  console.log(`  Lines fixed: ${normalizedCount}`);

  if (canonicalNames.size > 0) {
    console.log(`\n  Canonical names:`);
    for (const [source, canonical] of canonicalNames) {
      console.log(`    ${source} -> ${canonical}`);
    }
  }

  // Show remaining inconsistencies if any
  const inconsistentAfter = Object.entries(nameMapAfter).filter(([, d]) => Object.keys(d.variants).length > 1);
  if (inconsistentAfter.length > 0) {
    console.log(`\n  Remaining inconsistencies after normalization:`);
    for (const [sourceName, data] of inconsistentAfter) {
      const variants = Object.entries(data.variants)
        .map(([v, indices]) => `${v} (${indices.length}x)`)
        .join(', ');
      console.log(`    ${sourceName} → ${variants}`);
    }
  }

  // Show sample fixes
  const fixes = [];
  for (let i = 0; i < cues.length && fixes.length < 10; i++) {
    if (cues[i].translated !== translatedCues[i].text) {
      fixes.push({
        index: i,
        original: originalCues[i].text,
        before: cues[i].translated,
        after: translatedCues[i].text,
      });
    }
  }
  if (fixes.length > 0) {
    console.log(`\n  Sample fixes (first ${fixes.length}):`);
    for (const fix of fixes) {
      console.log(`    #${fix.index}: "${fix.before}" -> "${fix.after}"`);
    }
  }

  console.log('');
}

main();
