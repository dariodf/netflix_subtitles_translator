// ============================
// VISION / OCR PROMPTS
// ============================

/** Sentinel returned by the vision LLM when no text is detected. */
export const NO_TEXT = 'NO_TEXT';

/**
 * Build a prompt for the vision LLM to extract text from a video frame.
 * @param {string} sourceLang - source language hint (e.g. 'Japanese'), or empty string
 * @returns {string} the OCR prompt
 */
export function buildOcrPrompt(sourceLang) {
  const langHint = sourceLang
    ? `The on-screen text is likely in ${sourceLang}. `
    : '';

  return [
    'Extract all visible text from this video frame.',
    `${langHint}Include title cards, signs, labels, and any other readable text.`,
    'Preserve line breaks as they appear on screen.',
    'Return ONLY the extracted text, nothing else.',
    'If there is no readable text in the image, return exactly: NO_TEXT',
  ].join('\n');
}
