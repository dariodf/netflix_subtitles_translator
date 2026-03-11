/**
 * Levenshtein distance between two strings (standard DP).
 */
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use single-row optimization for memory efficiency
  const bLen = b.length;
  let prev = new Array(bLen + 1);
  let curr = new Array(bLen + 1);

  for (let j = 0; j <= bLen; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= bLen; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }

  return prev[bLen];
}

/**
 * Normalize text for comparison: lowercase, collapse whitespace, trim.
 */
function normalize(text) {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Similarity score between two strings (0-100%).
 */
export function similarityScore(translated, reference) {
  const a = normalize(translated);
  const b = normalize(reference);
  if (a === b) return 100;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  const dist = levenshteinDistance(a, b);
  return Math.round((1 - dist / maxLen) * 10000) / 100;
}

/**
 * Evaluate translated cues against reference cues.
 *
 * Note: Exact match and Levenshtein similarity were removed because different correct
 * translations of the same source can have completely different wording, making string
 * comparison misleading as a quality metric.
 *
 * For semantic similarity, see evaluateSemanticSimilarity() below which uses
 * Ollama embeddings to compare translations against reference subtitles.
 *
 * @param {Array<{text: string}>} translatedCues
 * @param {Array<{text: string}>} referenceCues
 * @param {Array<{text: string}>} originalCues
 * @param {Set<number>} flaggedLines
 * @returns {{ metrics: object, lines: Array }}
 */
export function evaluateTranslation(translatedCues, referenceCues, originalCues, flaggedLines) {
  const compareCount = Math.min(translatedCues.length, referenceCues.length);
  const cueCountMismatch = translatedCues.length !== referenceCues.length;

  const lines = [];

  for (let i = 0; i < compareCount; i++) {
    const translated = translatedCues[i]?.text || '';
    const reference = referenceCues[i]?.text || '';
    const original = originalCues[i]?.text || '';

    lines.push({
      index: i,
      original,
      translated,
      reference,
      flagged: flaggedLines.has(i),
    });
  }

  return {
    metrics: {
      totalCues: translatedCues.length,
      referenceCues: referenceCues.length,
      comparedCues: compareCount,
      cueCountMismatch,
      flaggedCount: flaggedLines.size,
    },
    lines,
  };
}

/**
 * Cosine similarity between two vectors. Returns -1 to 1.
 */
export function cosineSimilarity(vectorA, vectorB) {
  if (vectorA.length !== vectorB.length || vectorA.length === 0) return 0;
  let dotProduct = 0, magnitudeA = 0, magnitudeB = 0;
  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    magnitudeA += vectorA[i] * vectorA[i];
    magnitudeB += vectorB[i] * vectorB[i];
  }
  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Compute embeddings for an array of texts via Ollama /api/embed endpoint.
 * @param {string[]} texts - Texts to embed
 * @param {string} ollamaUrl - Ollama base URL (e.g., "http://localhost:11434")
 * @param {string} embeddingModel - Model name (e.g., "nomic-embed-text")
 * @param {Function} postJson - postJson(url, headers, data, timeout)
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
export async function computeEmbeddings(texts, ollamaUrl, embeddingModel, postJson) {
  const url = ollamaUrl.replace(/\/+$/, '') + '/api/embed';
  const { status, data } = await postJson(url, {}, { model: embeddingModel, input: texts }, 120000);
  if (status < 200 || status >= 300) {
    throw new Error(`Embedding request failed with status ${status}`);
  }
  return data.embeddings;
}

const EMBEDDING_BATCH_SIZE = 200;

/**
 * Batch-embed two text arrays and compute pairwise cosine similarity.
 * @param {string[]} textsA
 * @param {string[]} textsB - Must be same length as textsA
 * @param {string} ollamaUrl
 * @param {string} embeddingModel
 * @param {Function} postJson
 * @returns {Promise<{similarities: number[], average: number}>}
 */
async function batchEmbedAndCompare(textsA, textsB, ollamaUrl, embeddingModel, postJson) {
  const allTexts = [...textsA, ...textsB];
  const allEmbeddings = [];
  for (let start = 0; start < allTexts.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = allTexts.slice(start, start + EMBEDDING_BATCH_SIZE);
    const batchEmbeddings = await computeEmbeddings(batch, ollamaUrl, embeddingModel, postJson);
    allEmbeddings.push(...batchEmbeddings); // batch is ≤ EMBEDDING_BATCH_SIZE, safe for spread
  }

  const count = textsA.length;
  const similarities = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const sim = cosineSimilarity(allEmbeddings[i], allEmbeddings[count + i]);
    similarities.push(Math.round(sim * 10000) / 10000);
    total += sim;
  }
  return {
    similarities,
    average: count > 0 ? Math.round((total / count) * 10000) / 10000 : 0,
  };
}

/**
 * Evaluate semantic similarity between translated and reference cues using embeddings.
 * @param {Array<{text: string}>} translatedCues
 * @param {Array<{text: string}>} referenceCues
 * @param {string} ollamaUrl
 * @param {string} embeddingModel
 * @param {Function} postJson
 * @returns {Promise<{averageSimilarity: number, pairs: Array}>}
 */
export async function evaluateSemanticSimilarity(translatedCues, referenceCues, ollamaUrl, embeddingModel, postJson) {
  const count = Math.min(translatedCues.length, referenceCues.length);
  const translatedTexts = [];
  const referenceTexts = [];
  for (let i = 0; i < count; i++) {
    translatedTexts.push(translatedCues[i].text || '');
    referenceTexts.push(referenceCues[i].text || '');
  }

  const { similarities, average } = await batchEmbedAndCompare(translatedTexts, referenceTexts, ollamaUrl, embeddingModel, postJson);

  const pairs = similarities.map((sim, i) => ({
    index: i,
    translated: translatedTexts[i],
    reference: referenceTexts[i],
    similarity: sim,
  }));

  return { averageSimilarity: average, pairs };
}

/**
 * For each source cue, find ALL reference cues that overlap by at least 30% of the source duration.
 * Returns per-source-line data with merged reference text and reference cue indices.
 * @param {Array<{begin: number, end: number, text: string}>} sourceCues
 * @param {Array<{begin: number, end: number, text: string}>} referenceCues
 * @returns {Array<{sourceIndex: number, referenceIndices: number[], mergedReference: string}>}
 */
export function alignAllOverlapping(sourceCues, referenceCues) {
  const result = [];
  let refStart = 0;

  for (let si = 0; si < sourceCues.length; si++) {
    const src = sourceCues[si];
    const srcDuration = src.end - src.begin;
    const overlapping = [];

    for (let ri = refStart; ri < referenceCues.length; ri++) {
      const ref = referenceCues[ri];
      if (ref.begin > src.end + 5000) break;

      const overlapStart = Math.max(src.begin, ref.begin);
      const overlapEnd = Math.min(src.end, ref.end);
      const overlap = Math.max(0, overlapEnd - overlapStart);

      if (overlap > 0 && srcDuration > 0 && (overlap / srcDuration) > 0.3) {
        overlapping.push(ri);
      }
    }

    while (refStart < referenceCues.length && referenceCues[refStart].end < src.begin - 5000) {
      refStart++;
    }

    if (overlapping.length > 0) {
      const mergedReference = overlapping.map(ri => referenceCues[ri].text).join(' ');
      result.push({ sourceIndex: si, referenceIndices: overlapping, mergedReference });
    }
  }

  return result;
}

/**
 * Compute time-aligned semantic similarity between translated cues and reference cues.
 * For each source/translated cue, finds overlapping reference cues by timing,
 * merges their text, and computes embedding similarity.
 * @param {Array<{begin: number, end: number, text: string}>} translatedCues - Same timing as source
 * @param {Array<{begin: number, end: number, text: string}>} referenceCues
 * @param {string} ollamaUrl
 * @param {string} embeddingModel
 * @param {Function} postJson
 * @returns {Promise<{averageSimilarity: number, referenceCues: Array, pairs: Array}>}
 */
export async function evaluateTimeAlignedSimilarity(translatedCues, referenceCues, ollamaUrl, embeddingModel, postJson) {
  const aligned = alignAllOverlapping(translatedCues, referenceCues);
  const mappedReferenceCues = referenceCues.map((c, i) => ({ index: i, begin: c.begin, end: c.end, text: c.text }));
  if (aligned.length === 0) {
    return { averageSimilarity: 0, referenceCues: mappedReferenceCues, pairs: [] };
  }

  const translatedTexts = aligned.map(a => translatedCues[a.sourceIndex].text || '');
  const mergedTexts = aligned.map(a => a.mergedReference);

  const { similarities, average } = await batchEmbedAndCompare(translatedTexts, mergedTexts, ollamaUrl, embeddingModel, postJson);

  const pairs = similarities.map((sim, i) => ({
    index: aligned[i].sourceIndex,
    referenceIndices: aligned[i].referenceIndices,
    mergedReference: mergedTexts[i],
    similarity: sim,
  }));

  return { averageSimilarity: average, referenceCues: mappedReferenceCues, pairs };
}

/**
 * Format a human-readable evaluation summary for console output.
 */
export function formatEvaluationSummary(evaluation, episodeName) {
  const { metrics } = evaluation;
  const parts = [];

  parts.push(`\n--- Evaluation: ${episodeName} ---`);
  parts.push(`  Cues compared: ${metrics.comparedCues}` + (metrics.cueCountMismatch ? ` (mismatch: ${metrics.totalCues} translated vs ${metrics.referenceCues} reference)` : ''));
  parts.push(`  Flagged lines: ${metrics.flaggedCount}`);

  return parts.join('\n');
}
