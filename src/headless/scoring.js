/**
 * Quality score computation for translation runs.
 * Pure functions — no I/O, no side effects.
 */

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Collect unique problem line indices from flagged lines and analysis issues.
 * @param {number[]} flaggedLines - Array of flagged line indices
 * @param {Array<{index: number}>} issues - Analysis issues
 * @returns {Set<number>} Unique problem line indices
 */
export function collectProblemLines(flaggedLines, issues) {
  const set = new Set(flaggedLines);
  for (const issue of issues) {
    set.add(issue.index);
  }
  return set;
}

/**
 * Compute name consistency score from analysis nameMap.
 * For each source speaker name with 2+ occurrences, count how many uses
 * match the majority variant. Returns null if no speaker names found.
 * @param {object} nameMap - From analyzeTranslation result
 * @returns {number|null} 0-100 or null if no speaker names
 */
export function computeNameConsistencyScore(nameMap) {
  if (!nameMap || Object.keys(nameMap).length === 0) return null;

  let totalUses = 0;
  let majorityUses = 0;

  for (const entry of Object.values(nameMap)) {
    if (entry.count < 2) continue;
    totalUses += entry.count;
    // Count uses of the majority variant
    const majorityCount = entry.variants[entry.majority]?.length || 0;
    majorityUses += majorityCount;
  }

  if (totalUses === 0) return null;
  return round2((majorityUses / totalUses) * 100);
}

/**
 * Compute quality scores from translation and analysis data.
 * @param {object} translationOutput - Parsed output.translated.json
 * @param {object|null} analysisOutput - Parsed output.analysis.json (or null)
 * @returns {object} Scoring results
 */
export function computeQualityScores(translationOutput, analysisOutput, semanticSimilarity = null, crossLingualSimilarity = null) {
  const { stats } = translationOutput;
  const totalCues = stats.totalCues;

  if (totalCues === 0) {
    return {
      qualityScore: null,
      flagRate: null,
      analysisIssueRate: null,
      nameConsistencyScore: null,
      flaggedCount: 0,
      analysisIssueCount: 0,
      uniqueProblemLines: 0,
      totalCues: 0,
      categoryBreakdown: {},
    };
  }

  const flaggedLines = stats.flaggedLines || [];
  const issues = analysisOutput?.issues || [];
  const problemLines = collectProblemLines(flaggedLines, issues);
  const uniqueProblemCount = problemLines.size;

  const qualityScore = round2((totalCues - uniqueProblemCount) / totalCues * 100);
  const flagRate = round2(flaggedLines.length / totalCues * 100);

  // Unique issue lines (one line can have multiple issue categories)
  const uniqueIssueLines = new Set(issues.map(i => i.index)).size;
  const analysisIssueRate = analysisOutput
    ? round2(uniqueIssueLines / totalCues * 100)
    : null;

  const nameConsistencyScore = analysisOutput
    ? computeNameConsistencyScore(analysisOutput.nameMap)
    : null;

  const scores = {
    qualityScore,
    flagRate,
    analysisIssueRate,
    nameConsistencyScore,
    flaggedCount: flaggedLines.length,
    analysisIssueCount: issues.length,
    uniqueProblemLines: uniqueProblemCount,
    totalCues,
    categoryBreakdown: analysisOutput?.summary?.categories || {},
  };

  if (semanticSimilarity) {
    scores.semanticSimilarityScore = round2(semanticSimilarity.averageSimilarity * 100);
  }

  if (crossLingualSimilarity) {
    scores.crossLingualScore = round2(crossLingualSimilarity.averageSimilarity * 100);
  }

  return scores;
}

/**
 * Format a percentage with optional delta from previous run.
 * @param {number|null} value - Current value
 * @param {number|null} previous - Previous value (null = no delta)
 * @param {boolean} lowerIsBetter - If true, negative delta is good
 * @returns {string}
 */
function formatPct(value, previous, lowerIsBetter = false) {
  if (value === null) return '  n/a';
  let str = `${value.toFixed(1)}%`;
  if (previous !== null && previous !== undefined) {
    const delta = round2(value - previous);
    if (delta !== 0) {
      const sign = delta > 0 ? '+' : '';
      str += ` (${sign}${delta.toFixed(1)})`;
    }
  }
  return str;
}

/**
 * Format quality scores for console display with optional delta from previous run.
 * @param {object} scores - Output from computeQualityScores
 * @param {object|null} previousScores - Previous run's scores for delta display
 * @returns {string} Formatted multi-line string
 */
export function formatQualityReport(scores, previousScores) {
  if (scores.qualityScore === null) return '  Quality: n/a (no cues)';

  const prev = previousScores || {};
  const cleanCount = scores.totalCues - scores.uniqueProblemLines;

  const lines = [];
  lines.push(`  Quality: ${formatPct(scores.qualityScore, prev.qualityScore)}  ${cleanCount}/${scores.totalCues} clean lines`);
  lines.push(`    Flags:  ${formatPct(scores.flagRate, prev.flagRate, true)}  ${scores.flaggedCount} lines`);

  if (scores.analysisIssueRate !== null) {
    const uniqueIssueLines = new Set((scores._issues || []).map(i => i.index)).size ||
      Math.round(scores.analysisIssueRate * scores.totalCues / 100);
    lines.push(`    Issues: ${formatPct(scores.analysisIssueRate, prev.analysisIssueRate, true)}  ${uniqueIssueLines} lines`);
  }

  if (scores.nameConsistencyScore !== null) {
    lines.push(`    Names:  ${formatPct(scores.nameConsistencyScore, prev.nameConsistencyScore)}`);
  }

  if (scores.semanticSimilarityScore !== null && scores.semanticSimilarityScore !== undefined) {
    lines.push(`    Semantic: ${formatPct(scores.semanticSimilarityScore, prev.semanticSimilarityScore)}`);
  }

  if (scores.crossLingualScore !== null && scores.crossLingualScore !== undefined) {
    lines.push(`    CrossLingual: ${formatPct(scores.crossLingualScore, prev.crossLingualScore)}`);
  }

  const cats = scores.categoryBreakdown;
  if (Object.keys(cats).length > 0) {
    const catStr = Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    lines.push(`    Categories: ${catStr}`);
  }

  return lines.join('\n');
}
