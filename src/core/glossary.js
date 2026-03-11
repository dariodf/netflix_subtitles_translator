// ============================
// GLOSSARY (cross-chunk term consistency)
// ============================
export const glossary = {
  terms: new Map(), // term → { source, translated, count }

  /** Reset glossary (called on new episode / retranslate) */
  clear() {
    this.terms.clear();
  },

  /** Parse a [TERMS] line from LLM response and merge into glossary */
  extractFromResponse(responseText) {
    const match = responseText.match(/^\[TERMS?\]\s*(.+)$/mi);
    if (!match) return;
    const termsStr = match[1].trim();
    if (!termsStr) return;

    const pairs = termsStr.split(/[,;]\s*/);
    for (const pair of pairs) {
      let source, translated;
      const arrowMatch = pair.match(/^(.+?)\s*[→=]\s*(.+)$/);
      if (arrowMatch) {
        const left = arrowMatch[1].trim();
        const right = arrowMatch[2].trim();
        const leftNonLatin = (left.match(/[^\x00-\x7F]/g) || []).length / Math.max(left.length, 1); // eslint-disable-line no-control-regex
        const rightNonLatin = (right.match(/[^\x00-\x7F]/g) || []).length / Math.max(right.length, 1); // eslint-disable-line no-control-regex
        if (leftNonLatin > rightNonLatin) {
          source = left; translated = right;
        } else {
          source = right; translated = left;
        }
      } else {
        continue;
      }

      if (!source || !translated || source.length > 50 || translated.length > 50) continue;

      const key = source.toLowerCase();
      const existing = this.terms.get(key);
      if (existing) {
        existing.count++;
        existing.translated = translated;
      } else {
        this.terms.set(key, { source, translated, count: 1 });
      }
    }
  },

  /** Build a context block for injection into prompts */
  buildContextBlock() {
    if (this.terms.size === 0) return '';
    const sorted = [...this.terms.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);
    const lines = sorted.map(t => `${t.source} = ${t.translated}`);
    return `\nRecurring terms (use these translations consistently):\n${lines.join(', ')}\n`;
  },

  /** Strip the [TERMS] line from response text before normal parsing */
  stripFromResponse(responseText) {
    return responseText.replace(/^\[TERMS?\]\s*.+$/mi, '').trim();
  },
};
