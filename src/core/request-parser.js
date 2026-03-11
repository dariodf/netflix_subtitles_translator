import { logInfo, logWarn } from './utils.js';

export function parseTranslationResponse(text, chunkCues) {
  const lines = text.split('\n');
  const results = new Array(chunkCues.length);
  let matched = 0;

  // Try [N] format first
  for (const line of lines) {
    const match = line.match(/^\[(\d+)\]\s*(?:✓\s*)?(.+)$/);
    if (match) {
      const idx = parseInt(match[1]);
      if (idx < chunkCues.length) { results[idx] = match[2].trim(); matched++; }
    }
  }

  // Fallback: if [N] format largely failed, try plain line-by-line
  if (matched < chunkCues.length * 0.3) {
    const nonEmpty = lines.map(l => l.trim()).filter(l => l.length > 0);
    if (nonEmpty.length >= chunkCues.length * 0.5) {
      matched = 0;
      for (let k = 0; k < Math.min(nonEmpty.length, chunkCues.length); k++) {
        results[k] = nonEmpty[k].replace(/^\[\d+\]\s*/, '').replace(/^✓\s*/, '');
        matched++;
      }
      logInfo(`🌐 Used plain-text fallback: ${matched}/${chunkCues.length} lines`);
    }
  } else {
    logInfo(`🌐 Parsed ${matched}/${chunkCues.length} translated lines`);
  }

  if (matched < chunkCues.length * 0.5) {
    logWarn('⚠️ Low match rate — raw output sample:', text.slice(0, 500));
  }

  // Fill gaps with originals
  for (let i = 0; i < chunkCues.length; i++) {
    if (!results[i]) results[i] = chunkCues[i].text;
  }
  // Strip residual artifacts
  for (let i = 0; i < results.length; i++) {
    results[i] = results[i].replace(/^\[\d+\]\s*/, '');
    results[i] = results[i].replace(/^✓\s*/, '');
    results[i] = results[i].replace(/^[-•]\s+/, '');
    results[i] = results[i].replace(/^[""](.+)[""]$/, '$1');
    // Normalize fullwidth punctuation that small models leak from source
    results[i] = results[i].replace(/（/g, '(').replace(/）/g, ')');
    results[i] = results[i].replace(/【/g, '[').replace(/】/g, ']');
    if (!results[i].trim()) results[i] = chunkCues[i].text;
  }
  return results;
}
