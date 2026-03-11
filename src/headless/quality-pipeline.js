/**
 * Quality pipeline: evaluation, analysis, scoring, and run history.
 * Extracted from runEpisode to enable reuse by replay CLI.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { evaluateTranslation, evaluateSemanticSimilarity, evaluateTimeAlignedSimilarity, formatEvaluationSummary } from './evaluate.js';
import { analyzeTranslation } from './analyze.js';
import { computeQualityScores, formatQualityReport } from './scoring.js';
import { buildRunSummary, appendRunToHistory, readRunHistory, getLastRunForEpisode } from './run-history.js';

/**
 * Run the full quality pipeline: evaluate, analyze, score, and record history.
 *
 * @param {object} options
 * @param {object} options.translationOutput - The translation output object (for scoring)
 * @param {Array} options.translatedCues - Translated cue objects with { begin, end, text }
 * @param {Array} options.sourceCues - Source cue objects with { begin, end, text }
 * @param {Set} options.flaggedLines - Set of flagged line indices
 * @param {Array|null} options.referenceCues - Reference cues for evaluation (nullable)
 * @param {string} options.episodeName - Episode identifier
 * @param {object} options.gitInfo - Git info from getGitInfo()
 * @param {string} options.historyPath - Path to runs.jsonl
 * @param {object|null} [options.embeddingOptions] - Optional embedding config { ollamaUrl, embeddingModel, postJson }
 * @returns {Promise<{ evaluation, analysisResult, scores, previousScores, runSummary, semanticSimilarity, crossLingualSimilarity, referenceAlignedSimilarity }>}
 */
export async function runQualityPipeline({ translationOutput, translatedCues, sourceCues, flaggedLines, referenceCues, episodeName, gitInfo, historyPath, embeddingOptions = null }) {
  // 1. Evaluate against reference (if available)
  let evaluation = null;
  if (referenceCues) {
    evaluation = evaluateTranslation(translatedCues, referenceCues, sourceCues, flaggedLines);
  }

  // 2. Run analysis
  let analysisResult = null;
  try {
    const analysisInput = {
      episode: episodeName,
      cues: translatedCues.map((cue, i) => ({
        index: i,
        original: sourceCues[i].text,
        translated: cue.text,
      })),
      originalCues: sourceCues.map((cue, i) => ({
        index: i,
        begin: cue.begin,
        end: cue.end,
        text: cue.text,
      })),
    };
    analysisResult = analyzeTranslation(analysisInput, sourceCues, referenceCues);
  } catch (err) {
    console.warn(`  Warning: Analysis failed: ${err.message}`);
  }

  // 3. Embedding similarity — run all applicable evaluations in parallel
  const embeddingTasks = [];
  const embeddingLabels = [];

  if (embeddingOptions?.embeddingModel && referenceCues) {
    embeddingTasks.push(evaluateSemanticSimilarity(
      translatedCues, referenceCues,
      embeddingOptions.ollamaUrl, embeddingOptions.embeddingModel, embeddingOptions.postJson,
    ));
    embeddingLabels.push('semantic');
  }
  if (embeddingOptions?.crossLingualModel) {
    embeddingTasks.push(evaluateSemanticSimilarity(
      sourceCues, translatedCues,
      embeddingOptions.ollamaUrl, embeddingOptions.crossLingualModel, embeddingOptions.postJson,
    ));
    embeddingLabels.push('crossLingual');
  }
  if (embeddingOptions?.embeddingModel && referenceCues) {
    embeddingTasks.push(evaluateTimeAlignedSimilarity(
      translatedCues, referenceCues,
      embeddingOptions.ollamaUrl, embeddingOptions.embeddingModel, embeddingOptions.postJson,
    ));
    embeddingLabels.push('referenceAligned');
  }

  const embeddingResults = await Promise.allSettled(embeddingTasks);
  const embeddingByLabel = {};
  embeddingResults.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      embeddingByLabel[embeddingLabels[i]] = result.value;
    } else {
      console.warn(`  Warning: ${embeddingLabels[i]} similarity failed: ${result.reason?.message || result.reason}`);
    }
  });

  const similarities = {
    semantic: embeddingByLabel.semantic || null,
    crossLingual: embeddingByLabel.crossLingual || null,
    referenceAligned: embeddingByLabel.referenceAligned || null,
  };

  // 4. Compute quality scores + delta from last run
  const scores = computeQualityScores(translationOutput, analysisResult, similarities.semantic, similarities.crossLingual);
  const existingRuns = readRunHistory(historyPath);
  const lastRun = getLastRunForEpisode(existingRuns, episodeName);
  const previousScores = lastRun ? lastRun.scores : null;

  // 5. Build run summary + append to history
  const runSummary = buildRunSummary(translationOutput, analysisResult, scores, gitInfo);
  appendRunToHistory(historyPath, runSummary);

  return { evaluation, analysisResult, scores, previousScores, runSummary, similarities };
}

/**
 * Build the similarity data object for writing to output.similarity.json.
 * @param {object} options
 * @param {object} options.similarities - { semantic, crossLingual, referenceAligned } from pipeline
 * @param {string} options.embeddingModel
 * @param {string} options.crossLingualModel
 * @returns {object|null} Similarity data or null if no data available
 */
export function buildSimilarityData({ similarities, embeddingModel, crossLingualModel }) {
  if (!similarities.semantic && !similarities.crossLingual && !similarities.referenceAligned) return null;
  const data = {};
  if (similarities.semantic) {
    data.semantic = {
      averageSimilarity: similarities.semantic.averageSimilarity,
      model: embeddingModel,
      pairs: similarities.semantic.pairs.map(p => ({ index: p.index, similarity: p.similarity })),
    };
  }
  if (similarities.crossLingual) {
    data.crossLingual = {
      averageSimilarity: similarities.crossLingual.averageSimilarity,
      model: crossLingualModel,
      pairs: similarities.crossLingual.pairs.map(p => ({ index: p.index, similarity: p.similarity })),
    };
  }
  if (similarities.referenceAligned) {
    data.referenceAligned = {
      averageSimilarity: similarities.referenceAligned.averageSimilarity,
      model: embeddingModel,
      referenceCues: similarities.referenceAligned.referenceCues,
      pairs: similarities.referenceAligned.pairs.map(p => ({ index: p.index, referenceIndices: p.referenceIndices, similarity: p.similarity })),
    };
  }
  return data;
}

/**
 * Write quality pipeline output files (evaluation, analysis, similarity) and log summary.
 * Shared by headless index.js and replay.js to avoid duplication.
 */
export function writeQualityArtifacts({ outputDir, fileSuffix, evaluation, analysisResult, similarities, scores, previousScores, runSummary, episodeName, embeddingModel, crossLingualModel }) {
  if (evaluation) {
    writeFileSync(join(outputDir, `output.evaluation${fileSuffix}.json`), JSON.stringify(evaluation, null, 2), 'utf-8');
    console.log(formatEvaluationSummary(evaluation, episodeName));
  }
  if (analysisResult) {
    writeFileSync(join(outputDir, `output.analysis${fileSuffix}.json`), JSON.stringify(analysisResult, null, 2), 'utf-8');
  }
  const similarityData = buildSimilarityData({ similarities, embeddingModel, crossLingualModel });
  if (similarityData) {
    writeFileSync(join(outputDir, `output.similarity${fileSuffix}.json`), JSON.stringify(similarityData, null, 2), 'utf-8');
  }
  console.log(formatQualityReport(scores, previousScores));
  console.log(`  Run: ${runSummary.runId}`);
}

export { formatEvaluationSummary, formatQualityReport };
