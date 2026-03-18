#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
// TODO: Replace with semantic similarity (embeddings via Ollama or sentence-transformer).
// Exact match and Levenshtein similarity were removed because different correct translations
// can have completely different wording, making string comparison misleading as a quality metric.

import { getGitInfo } from './run-history.js';
import { normalizeSpeakerNames, extractLeadingSpeakerLabel } from '../core/speaker-labels.js';
import { hasRubyArtifact } from '../core/validation.js';

const EPISODES_DIRS = [resolve('episodes'), resolve('episodes-local')];
const RUNS_DIR = resolve('runs');

// ============================
// PURE ANALYSIS FUNCTIONS (exported for testing)
// ============================

/** CJK script detection regex */
const CJK_PATTERN = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\u3400-\u4dbf\uac00-\ud7af]/;

// hasRubyArtifact → imported from ../core/validation.js
// extractSpeakerName / extractTranslatedSpeakerName → replaced by extractLeadingSpeakerLabel from ../core/speaker-labels.js

/**
 * Check for untranslated characters — source script leaking into translation.
 * Returns the matched characters or null.
 */
export function findUntranslatedCharacters(original, translated) {
  // Only check when original contains CJK and translation is mostly Latin
  if (!CJK_PATTERN.test(original)) return null;
  const cjkInTranslation = translated.match(/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\u3400-\u4dbf\uac00-\ud7af]/g);
  if (cjkInTranslation && cjkInTranslation.length > 0) {
    return cjkInTranslation.join('');
  }
  return null;
}

/**
 * Build a name consistency map from all cues.
 * Groups translations of the same source speaker name.
 */
export function buildNameMap(cues) {
  const nameMap = {};

  for (const cue of cues) {
    const sourceName = extractLeadingSpeakerLabel(cue.original);
    if (!sourceName) continue;

    const translatedName = extractLeadingSpeakerLabel(cue.translated);
    if (!translatedName) continue;

    if (!nameMap[sourceName]) {
      nameMap[sourceName] = { variants: {}, count: 0 };
    }
    nameMap[sourceName].count++;

    if (!nameMap[sourceName].variants[translatedName]) {
      nameMap[sourceName].variants[translatedName] = [];
    }
    nameMap[sourceName].variants[translatedName].push(cue.index);
  }

  // Determine majority variant for each name
  for (const name of Object.keys(nameMap)) {
    const variants = nameMap[name].variants;
    let maxCount = 0;
    let majority = null;
    for (const [variant, indices] of Object.entries(variants)) {
      if (indices.length > maxCount) {
        maxCount = indices.length;
        majority = variant;
      }
    }
    nameMap[name].majority = majority;
  }

  return nameMap;
}

/**
 * Count total name inconsistency issues from a name map.
 * Counts lines where the translated name differs from the majority.
 */
export function countNameInconsistencies(nameMap) {
  let count = 0;
  for (const [, data] of Object.entries(nameMap)) {
    if (Object.keys(data.variants).length > 1) {
      for (const [variant, indices] of Object.entries(data.variants)) {
        if (variant !== data.majority) count += indices.length;
      }
    }
  }
  return count;
}

/**
 * Align cues by overlapping time ranges for meaningful cross-TTML comparison.
 * Returns pairs of { sourceIndex, referenceIndex, overlapRatio }.
 */
export function alignCuesByTime(sourceCues, referenceCues) {
  const pairs = [];
  let refStart = 0;

  for (let si = 0; si < sourceCues.length; si++) {
    const src = sourceCues[si];
    let bestOverlap = 0;
    let bestRef = -1;

    for (let ri = refStart; ri < referenceCues.length; ri++) {
      const ref = referenceCues[ri];

      // If reference cue starts well after source ends, stop searching
      if (ref.begin > src.end + 5000) break;

      // Calculate overlap
      const overlapStart = Math.max(src.begin, ref.begin);
      const overlapEnd = Math.min(src.end, ref.end);
      const overlap = Math.max(0, overlapEnd - overlapStart);

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestRef = ri;
      }
    }

    if (bestRef >= 0 && bestOverlap > 0) {
      const srcDuration = src.end - src.begin;
      const overlapRatio = srcDuration > 0 ? bestOverlap / srcDuration : 0;
      if (overlapRatio > 0.3) { // At least 30% overlap
        pairs.push({ sourceIndex: si, referenceIndex: bestRef, overlapRatio });
      }
    }

    // Advance refStart to avoid re-scanning early refs
    while (refStart < referenceCues.length && referenceCues[refStart].end < src.begin - 5000) {
      refStart++;
    }
  }

  return pairs;
}

/**
 * Run all analysis checks on a translated output.
 * @param {object} output - The parsed output.translated.json
 * @param {Array|null} sourceFileCues - Cues parsed from original source TTML (for timing verification)
 * @param {Array|null} referenceCues - Cues parsed from reference TTML (for time-aligned evaluation)
 * @returns {object} Analysis result
 */
export function analyzeTranslation(output, sourceFileCues, referenceCues) {
  const { cues, originalCues, episode } = output;
  const issues = [];
  const categories = {};

  function addIssue(index, category, detail) {
    issues.push({
      index,
      category,
      original: originalCues[index]?.text || '',
      translated: cues[index]?.translated || '',
      detail,
    });
    categories[category] = (categories[category] || 0) + 1;
  }

  // 1. Timing verification
  if (sourceFileCues) {
    let timingMismatches = 0;
    for (let i = 0; i < Math.min(originalCues.length, sourceFileCues.length); i++) {
      const orig = originalCues[i];
      const src = sourceFileCues[i];
      if (Math.abs(orig.begin - src.begin) > 0.1 || Math.abs(orig.end - src.end) > 0.1) {
        timingMismatches++;
        if (timingMismatches <= 3) {
          addIssue(i, 'timingMismatch', `begin: ${orig.begin} vs ${src.begin}, end: ${orig.end} vs ${src.end}`);
        }
      }
    }
    if (originalCues.length !== sourceFileCues.length) {
      addIssue(0, 'cueCountMismatch', `output has ${originalCues.length} cues, source TTML has ${sourceFileCues.length}`);
    }
  }

  // 2. Name consistency
  const nameMap = buildNameMap(cues);
  for (const [sourceName, data] of Object.entries(nameMap)) {
    const variantCount = Object.keys(data.variants).length;
    if (variantCount > 1) {
      for (const [variant, indices] of Object.entries(data.variants)) {
        if (variant !== data.majority) {
          for (const idx of indices) {
            addIssue(idx, 'nameInconsistency',
              `"${sourceName}" → "${variant}" (majority: "${data.majority}", ${variantCount} variants total)`);
          }
        }
      }
    }
  }

  // 3. Per-cue checks
  for (let i = 0; i < cues.length; i++) {
    const orig = originalCues[i]?.text || '';
    const trans = cues[i]?.translated || '';

    // Speaker label preservation — require dialogue after speaker label to distinguish from sound effects
    const hasSpeakerLabel = /^（[^）]+）./.test(orig) || /^\[[^\]]+\]./.test(orig);
    if (hasSpeakerLabel && trans.length > 0 && !/^\(/.test(trans) && !/^\[/.test(trans)) {
      addIssue(i, 'speakerLabelLost', `original has speaker label, translation dropped label format`);
    }

    // Ruby artifacts
    if (hasRubyArtifact(trans)) {
      addIssue(i, 'rubyArtifact', `hyphenated romanization detected: "${trans.match(/\b[A-Za-z]{1,4}(?:-[A-Za-z]{1,4}){2,}\b/)?.[0]}"`);
    }

    // Em dash count mismatch
    const origEmDashes = (orig.match(/—/g) || []).length;
    const transEmDashes = (trans.match(/—/g) || []).length;
    if (transEmDashes > origEmDashes) {
      addIssue(i, 'emDashCountMismatch', `original has ${origEmDashes} separators, translation has ${transEmDashes}`);
    }

    // Truncated dual-speaker line — translation has "—" but ends right after, or original has "—" but translation doesn't
    if (origEmDashes > 0 && trans.length > 0) {
      if (/—$/.test(trans.trim())) {
        addIssue(i, 'truncatedDualSpeaker', `translation ends with trailing "—" — second speaker missing`);
      } else if (!trans.includes('—') && origEmDashes > 0) {
        addIssue(i, 'truncatedDualSpeaker', `original has ${origEmDashes} "—" separator(s) but translation has none`);
      }
    }

    // Too-short translation
    if (orig.length >= 15 && trans.length > 0 && trans.length < orig.length * 0.2) {
      addIssue(i, 'tooShort', `translation is ${trans.length} chars vs ${orig.length} original`);
    }

    // Untranslated characters
    const leaked = findUntranslatedCharacters(orig, trans);
    if (leaked) {
      addIssue(i, 'untranslatedCharacters', `source script characters in translation: "${leaked}"`);
    }

    // Too-long translation (possible hallucination/padding)
    // CJK→Latin naturally expands 3-4x; 4x catches real errors with few false positives
    if (orig.length >= 10 && trans.length > 0 && trans.length > orig.length * 4) {
      addIssue(i, 'tooLong', `translation is ${trans.length} chars vs ${orig.length} original (${(trans.length / orig.length).toFixed(1)}x)`);
    }

    // Number mismatch — digits in source should appear in translation
    const origNumbers = (orig.match(/\d+/g) || []);
    if (origNumbers.length > 0 && trans.length > 0) {
      const missing = origNumbers.filter(n => !trans.includes(n));
      if (missing.length > 0) {
        addIssue(i, 'numberMismatch', `numbers in source not found in translation: ${missing.join(', ')}`);
      }
    }

    // Line break mismatch — subtitle line count should be preserved
    const origLineCount = (orig.match(/\n/g) || []).length + 1;
    const transLineCount = (trans.match(/\n/g) || []).length + 1;
    if (origLineCount > 1 && transLineCount !== origLineCount) {
      addIssue(i, 'lineBreakMismatch', `source has ${origLineCount} lines, translation has ${transLineCount}`);
    }
  }

  // 4. Repetition detection (same translation for different originals)
  const translationGroups = {};
  for (const cue of cues) {
    if (!cue.translated || cue.translated.length < 5) continue;
    const key = cue.translated.toLowerCase().trim();
    if (!translationGroups[key]) translationGroups[key] = [];
    translationGroups[key].push(cue.index);
  }
  for (const [_translation, indices] of Object.entries(translationGroups)) {
    if (indices.length < 2) continue;
    // Check if originals are actually different
    const originals = new Set(indices.map(i => originalCues[i]?.text));
    if (originals.size > 1) {
      for (const idx of indices.slice(1)) {
        addIssue(idx, 'repetition',
          `same translation as #${indices[0]}: "${cues[idx].translated}" (different originals)`);
      }
    }
  }

  // 5. Consecutive issue detection — 3+ adjacent lines with issues suggests systemic model confusion
  const issueIndices = new Set(issues.map(issue => issue.index));
  const consecutiveRuns = [];
  let currentRun = [];
  for (let i = 0; i < cues.length; i++) {
    if (issueIndices.has(i)) {
      currentRun.push(i);
    } else {
      if (currentRun.length >= 3) consecutiveRuns.push(currentRun);
      currentRun = [];
    }
  }
  if (currentRun.length >= 3) consecutiveRuns.push(currentRun);

  // 6. Normalization simulation — run on a copy to show what would be fixed
  const sourceCuesForNormalization = originalCues.map(c => ({ text: c.text }));
  const translatedCuesForNormalization = cues.map(c => ({
    text: c.translated,
    begin: c.begin || 0,
    end: c.end || 0,
  }));
  const { normalizedCount, canonicalNames } = normalizeSpeakerNames(
    sourceCuesForNormalization, translatedCuesForNormalization, output.config?.cast || [],
  );
  const normalizationSimulation = {
    fixableLines: normalizedCount,
    canonicalNames: Object.fromEntries(canonicalNames),
  };

  // Re-analyze name consistency after normalization to get the "after" count
  const normalizedCues = cues.map((c, i) => ({
    ...c,
    translated: translatedCuesForNormalization[i].text,
  }));
  const nameMapAfter = buildNameMap(normalizedCues);
  normalizationSimulation.nameInconsistencyBefore = categories.nameInconsistency || 0;
  normalizationSimulation.nameInconsistencyAfter = countNameInconsistencies(nameMapAfter);

  // 6. Time-aligned evaluation (when reference available)
  let timeAlignedEvaluation = null;
  if (referenceCues) {
    // Build cue arrays with timing for alignment
    const sourceTimed = cues.map((c, i) => ({
      begin: originalCues[i].begin,
      end: originalCues[i].end,
      text: c.translated,
    }));

    const refTimed = referenceCues.map(c => ({
      begin: c.begin,
      end: c.end,
      text: c.text,
    }));

    const pairs = alignCuesByTime(sourceTimed, refTimed);

    const matchedSourceIndices = new Set(pairs.map(p => p.sourceIndex));
    const matchedRefIndices = new Set(pairs.map(p => p.referenceIndex));

    timeAlignedEvaluation = {
      alignedPairs: pairs.length,
      unmatchedSource: cues.length - matchedSourceIndices.size,
      unmatchedReference: referenceCues.length - matchedRefIndices.size,
    };
  }

  return {
    episode: episode || '',
    summary: {
      totalCues: cues.length,
      issueCount: issues.length,
      categories,
      consecutiveIssueRuns: consecutiveRuns.length,
      longestConsecutiveRun: consecutiveRuns.reduce((max, r) => Math.max(max, r.length), 0),
    },
    nameMap,
    normalizationSimulation,
    issues,
    consecutiveRuns,
    timeAlignedEvaluation,
  };
}

/**
 * Format a human-readable analysis summary for console output.
 */
export function formatAnalysisSummary(analysis) {
  const { summary, nameMap, normalizationSimulation, timeAlignedEvaluation } = analysis;
  const parts = [];

  parts.push(`\n--- Analysis: ${analysis.episode} ---`);
  parts.push(`  Total cues: ${summary.totalCues}`);
  parts.push(`  Issues found: ${summary.issueCount}`);

  if (Object.keys(summary.categories).length > 0) {
    parts.push(`  Categories:`);
    for (const [cat, count] of Object.entries(summary.categories).sort((a, b) => b[1] - a[1])) {
      parts.push(`    ${cat}: ${count}`);
    }
  }

  // Name consistency
  const inconsistentNames = Object.entries(nameMap).filter(([, d]) => Object.keys(d.variants).length > 1);
  if (inconsistentNames.length > 0) {
    parts.push(`\n  Name consistency issues:`);
    for (const [sourceName, data] of inconsistentNames) {
      const variants = Object.entries(data.variants)
        .map(([v, indices]) => `${v} (${indices.length}x)`)
        .join(', ');
      parts.push(`    ${sourceName} → ${variants} [majority: ${data.majority}]`);
    }
  }

  // Normalization simulation
  if (normalizationSimulation && normalizationSimulation.fixableLines > 0) {
    const { nameInconsistencyBefore, nameInconsistencyAfter, fixableLines, canonicalNames } = normalizationSimulation;
    parts.push(`\n  Normalization simulation:`);
    parts.push(`    Fixable lines: ${fixableLines}`);
    parts.push(`    nameInconsistency: ${nameInconsistencyBefore} -> ${nameInconsistencyAfter}`);
    for (const [source, canonical] of Object.entries(canonicalNames)) {
      parts.push(`    ${source} -> ${canonical}`);
    }
  }

  // Consecutive issue runs
  if (analysis.consecutiveRuns.length > 0) {
    parts.push(`\n  Consecutive issue runs: ${analysis.consecutiveRuns.length} (longest: ${summary.longestConsecutiveRun} lines)`);
    for (const run of analysis.consecutiveRuns.slice(0, 5)) {
      parts.push(`    lines ${run[0]}-${run[run.length - 1]} (${run.length} lines)`);
    }
    if (analysis.consecutiveRuns.length > 5) {
      parts.push(`    ... and ${analysis.consecutiveRuns.length - 5} more`);
    }
  }

  // Time-aligned evaluation
  if (timeAlignedEvaluation) {
    parts.push(`\n  Time-aligned evaluation:`);
    parts.push(`    Aligned pairs: ${timeAlignedEvaluation.alignedPairs}`);
    parts.push(`    Unmatched source: ${timeAlignedEvaluation.unmatchedSource}`);
    parts.push(`    Unmatched reference: ${timeAlignedEvaluation.unmatchedReference}`);
  }

  // Show first few issues as examples
  const uniqueCategories = [...new Set(analysis.issues.map(i => i.category))];
  if (uniqueCategories.length > 0) {
    parts.push(`\n  Example issues:`);
    for (const cat of uniqueCategories) {
      const example = analysis.issues.find(i => i.category === cat);
      parts.push(`    [${cat}] #${example.index}: ${example.detail}`);
      parts.push(`      original:   ${example.original}`);
      parts.push(`      translated: ${example.translated}`);
    }
  }

  return parts.join('\n');
}

// ============================
// CLI
// ============================

function usage() {
  console.log(`
Netflix Subtitle Translator — Translation Analysis

Usage:
  node src/headless/analyze.js --config <name> --episode <episode>              Analyze one episode
  node src/headless/analyze.js --config <name> --episode <ep> --source-lang ko  Analyze specific source
  node src/headless/analyze.js --config <name>                                  Analyze all episodes

Reads output.translated.json (or output.translated.<lang>.json) and optionally compares
against source TTML and reference TTML. Writes output.analysis.json with quality metrics.
`);
}

async function runAnalysis(configName, episodeName, sourceLangSuffix = '', commit = null) {
  const gitCommit = commit || getGitInfo().commit;
  const outputDir = join(RUNS_DIR, configName, episodeName, gitCommit);
  const translatedPath = join(outputDir, `output.translated${sourceLangSuffix}.json`);

  if (!existsSync(translatedPath)) {
    console.error(`  No translated output found at ${translatedPath}`);
    return null;
  }

  const output = JSON.parse(readFileSync(translatedPath, 'utf-8'));
  console.log(`\n========== ${episodeName} ==========`);
  console.log(`  Cues: ${output.cues.length}`);

  // Try to load source TTML for timing verification
  let sourceFileCues = null;
  const episodeDir = EPISODES_DIRS.map(d => join(d, episodeName)).find(d => existsSync(d));
  // Lazy-load TTML parser globals only when episode directory is available
  let parseTTML = null;
  if (episodeDir) {
    const { setupJsdom } = await import('./jsdom-setup.js');
    setupJsdom();
    ({ parseTTML } = await import('../core/parser.js'));
  }

  if (episodeDir && output.source) {
    const sourcePath = join(episodeDir, output.source);
    if (existsSync(sourcePath) && parseTTML) {
      const xml = readFileSync(sourcePath, 'utf-8');
      sourceFileCues = parseTTML(xml).cues;
      console.log(`  Source TTML: ${output.source} (${sourceFileCues.length} cues)`);
    }
  }

  // Try to load reference TTML for time-aligned evaluation
  // Reference is the target language file (e.g., en.ttml for targetLang=English)
  let referenceCues = null;
  if (episodeDir) {
    const targetLang = output.config?.targetLang || 'English';
    const { LANG_CODES } = await import('../core/providers/definitions.js');
    const targetCode = Object.entries(LANG_CODES)
      .find(([name]) => name.toLowerCase() === targetLang.toLowerCase())?.[1];
    const refFile = targetCode ? `${targetCode}.ttml` : null;
    if (refFile && existsSync(join(episodeDir, refFile)) && parseTTML) {
      const xml = readFileSync(join(episodeDir, refFile), 'utf-8');
      referenceCues = parseTTML(xml).cues;
      console.log(`  Reference TTML: ${refFile} (${referenceCues.length} cues)`);
    }
  }

  const analysis = analyzeTranslation(output, sourceFileCues, referenceCues);
  const analysisPath = join(outputDir, `output.analysis${sourceLangSuffix}.json`);
  writeFileSync(analysisPath, JSON.stringify(analysis, null, 2), 'utf-8');

  console.log(formatAnalysisSummary(analysis));
  console.log(`  Output: ${analysisPath}`);

  return analysis;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(0);
  }

  const configIdx = args.indexOf('--config');
  if (configIdx === -1 || !args[configIdx + 1]) {
    console.error('Missing required --config <name> flag.');
    process.exit(1);
  }
  const configName = args[configIdx + 1];

  const episodeIdx = args.indexOf('--episode');
  const episodeName = episodeIdx !== -1 ? args[episodeIdx + 1] : null;
  const sourceLangIdx = args.indexOf('--source-lang');
  const sourceLangArg = sourceLangIdx !== -1 ? args[sourceLangIdx + 1] : null;
  const sourceLangSuffix = sourceLangArg ? `.${sourceLangArg.toLowerCase()}` : '';

  if (episodeName) {
    console.log(`Analyzing: ${episodeName}${sourceLangArg ? ` (source: ${sourceLangArg})` : ''}`);
    await runAnalysis(configName, episodeName, sourceLangSuffix);
  } else {
    // Discover all translated outputs for current commit (including lang-suffixed ones)
    const gitCommit = getGitInfo().commit;
    const configDir = join(RUNS_DIR, configName);
    if (!existsSync(configDir)) {
      console.error(`Runs directory not found: ${configDir}`);
      process.exit(1);
    }
    const episodeDirs = readdirSync(configDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();

    let found = false;
    for (const epName of episodeDirs) {
      const commitDir = join(configDir, epName, gitCommit);
      if (!existsSync(commitDir)) continue;
      const outputFiles = readdirSync(commitDir)
        .filter(f => f.startsWith('output.translated') && f.endsWith('.json'));
      for (const outputFile of outputFiles) {
        // Extract suffix: "output.translated.ko.json" → ".ko", "output.translated.json" → ""
        const suffix = outputFile.replace('output.translated', '').replace('.json', '');
        await runAnalysis(configName, epName, suffix, gitCommit);
        found = true;
      }
    }

    if (!found) {
      console.error('No translated output found. Run translation first.');
      process.exit(1);
    }
  }
}

// Only run CLI when executed directly (not when imported for testing)
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('/analyze.js') ||
  process.argv[1].endsWith('\\analyze.js')
);
if (isMainModule) {
  main();
}
