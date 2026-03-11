import { describe, it, expect, beforeEach } from 'vitest';
import { glossary } from '../src/core/glossary.js';

// Reset glossary state between tests
beforeEach(() => glossary.clear());

describe('glossary.stripFromResponse', () => {
  it('removes a [TERMS] line from response text', () => {
    const input = '[0] Hola\n[1] Mundo\n[TERMS] hello=hola, world=mundo';
    const result = glossary.stripFromResponse(input);
    expect(result).toBe('[0] Hola\n[1] Mundo');
  });

  it('removes a [TERM] line (singular)', () => {
    const input = '[TERM] name=nombre\n[0] Hola';
    const result = glossary.stripFromResponse(input);
    expect(result).toBe('[0] Hola');
  });

  it('is case-insensitive', () => {
    const input = '[0] Hola\n[terms] hello=hola';
    const result = glossary.stripFromResponse(input);
    expect(result).toBe('[0] Hola');
  });

  it('leaves text unchanged when no [TERMS] line exists', () => {
    const input = '[0] Hola\n[1] Mundo';
    expect(glossary.stripFromResponse(input)).toBe(input);
  });

  it('handles empty string', () => {
    expect(glossary.stripFromResponse('')).toBe('');
  });

  it('handles response that is only a [TERMS] line', () => {
    expect(glossary.stripFromResponse('[TERMS] a=b, c=d')).toBe('');
  });
});

describe('glossary.clear', () => {
  it('removes all terms from the glossary', () => {
    glossary.extractFromResponse('[TERMS] hello→hola, world→mundo');
    expect(glossary.terms.size).toBeGreaterThan(0);
    glossary.clear();
    expect(glossary.terms.size).toBe(0);
  });
});

describe('glossary.extractFromResponse', () => {
  it('extracts terms from [TERMS] line with arrow separator', () => {
    glossary.extractFromResponse('[TERMS] hello→hola, world→mundo');
    expect(glossary.terms.size).toBe(2);
    expect(glossary.terms.get('hola').translated).toBe('hello');
    expect(glossary.terms.get('mundo').translated).toBe('world');
  });

  it('extracts terms from [TERMS] line with = separator', () => {
    glossary.extractFromResponse('[TERMS] hello=hola, world=mundo');
    expect(glossary.terms.size).toBe(2);
  });

  it('extracts terms from [TERM] (singular)', () => {
    glossary.extractFromResponse('[TERM] hello→hola');
    expect(glossary.terms.size).toBe(1);
  });

  it('handles semicolon-separated terms', () => {
    glossary.extractFromResponse('[TERMS] hello→hola; world→mundo');
    expect(glossary.terms.size).toBe(2);
  });

  it('does nothing when no [TERMS] line present', () => {
    glossary.extractFromResponse('[0] Hola\n[1] Mundo');
    expect(glossary.terms.size).toBe(0);
  });

  it('does nothing when [TERMS] line has empty content', () => {
    glossary.extractFromResponse('[TERMS]   ');
    expect(glossary.terms.size).toBe(0);
  });

  it('skips entries without arrow/equals separator', () => {
    glossary.extractFromResponse('[TERMS] hello→hola, justoneword');
    expect(glossary.terms.size).toBe(1);
  });

  it('skips entries longer than 50 chars', () => {
    const longSource = 'a'.repeat(51);
    glossary.extractFromResponse(`[TERMS] ${longSource}→corto`);
    expect(glossary.terms.size).toBe(0);
  });

  it('increments count on duplicate terms', () => {
    glossary.extractFromResponse('[TERMS] hello→hola');
    glossary.extractFromResponse('[TERMS] hello→hola');
    const entry = glossary.terms.get('hola');
    expect(entry.count).toBe(2);
  });

  it('assigns non-Latin text as source and Latin as translated', () => {
    // The function checks non-Latin character ratio to determine source vs translated
    glossary.extractFromResponse('[TERMS] 日本語→Japanese');
    const entry = glossary.terms.get('日本語');
    expect(entry).toBeDefined();
    expect(entry.source).toBe('日本語');
    expect(entry.translated).toBe('Japanese');
  });

  it('is case-insensitive for [TERMS] line matching', () => {
    glossary.extractFromResponse('[terms] hello→hola');
    expect(glossary.terms.size).toBe(1);
  });
});

describe('glossary.buildContextBlock', () => {
  it('returns empty string when no terms exist', () => {
    expect(glossary.buildContextBlock()).toBe('');
  });

  it('builds a context block with terms', () => {
    glossary.extractFromResponse('[TERMS] hello→hola, world→mundo');
    const block = glossary.buildContextBlock();
    expect(block).toContain('Recurring terms');
    expect(block).toContain('=');
  });

  it('sorts terms by count (most frequent first)', () => {
    glossary.extractFromResponse('[TERMS] hello→hola');
    glossary.extractFromResponse('[TERMS] hello→hola');
    glossary.extractFromResponse('[TERMS] hello→hola');
    glossary.extractFromResponse('[TERMS] world→mundo');
    const block = glossary.buildContextBlock();
    // "hola" has count 3, "mundo" has count 1, so hola should appear first
    const holaIdx = block.indexOf('hola');
    const mundoIdx = block.indexOf('mundo');
    expect(holaIdx).toBeLessThan(mundoIdx);
  });

  it('limits output to 30 terms', () => {
    // Add 35 unique terms
    const terms = Array.from({ length: 35 }, (_, i) => `term${i}→traducción${i}`).join(', ');
    glossary.extractFromResponse(`[TERMS] ${terms}`);
    const block = glossary.buildContextBlock();
    // Count '=' separators in output — should be at most 30
    const eqCount = (block.match(/ = /g) || []).length;
    expect(eqCount).toBeLessThanOrEqual(30);
  });
});
