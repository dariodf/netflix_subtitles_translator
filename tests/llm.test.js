import { describe, it, expect } from 'vitest';
import { reorderFromPosition } from '../src/pipeline/translate.js';
import { buildDiagnosticPrompt, DIAG_MSGS } from '../src/core/prompts.js';

// ── reorderFromPosition ──────────────────────────────────

describe('reorderFromPosition', () => {
  // 10 cues, each 1 second long, starting at 0, 1000, 2000, ...
  const cues = Array.from({ length: 100 }, (_, i) => ({
    begin: i * 1000,
    end: i * 1000 + 999,
    text: `Line ${i}`,
  }));
  const step = 40; // chunkSize=50, overlap=10 → step=40
  const allChunkStarts = [];
  for (let i = 0; i < cues.length; i += step) allChunkStarts.push(i);
  // allChunkStarts = [0, 40, 80]

  it('returns null when at the beginning (currentLineIdx <= 0)', () => {
    const result = reorderFromPosition(500, cues, allChunkStarts, step, new Set());
    expect(result).toBeNull();
  });

  it('returns null when before any cue', () => {
    const result = reorderFromPosition(-1000, cues, allChunkStarts, step, new Set());
    expect(result).toBeNull();
  });

  it('reorders to prioritize chunk containing current position', () => {
    // At 50000ms, we're at cue index 50 → priorityStart = floor(50/40)*40 = 40
    const result = reorderFromPosition(50000, cues, allChunkStarts, step, new Set());
    expect(result).not.toBeNull();
    expect(result[0]).toBe(40); // chunk starting at 40 comes first
    expect(result[1]).toBe(80); // then 80
    expect(result[2]).toBe(0);  // then 0 (wrap around)
  });

  it('filters out completed chunks', () => {
    const completed = new Set([40]);
    const result = reorderFromPosition(50000, cues, allChunkStarts, step, completed);
    expect(result).not.toBeNull();
    expect(result).not.toContain(40);
  });

  it('returns null when all chunks are completed', () => {
    const completed = new Set(allChunkStarts);
    const result = reorderFromPosition(50000, cues, allChunkStarts, step, completed);
    expect(result).toBeNull();
  });

  it('returns null when position is in the first chunk', () => {
    // At 5000ms, cue index 5 → priorityStart = 0, idx = 0 → returns null (idx <= 0)
    const result = reorderFromPosition(5000, cues, allChunkStarts, step, new Set());
    expect(result).toBeNull();
  });

  it('handles position between cues (gap)', () => {
    // Between cue 39 (ends at 39999) and cue 40 (begins at 40000)
    // findIndex for begin > 39999.5 returns 40, minus 1 = 39
    const result = reorderFromPosition(39999.5, cues, allChunkStarts, step, new Set());
    expect(result).toBeNull(); // idx 39 → priorityStart = 0, idx = 0
  });
});

// ── DIAG_MSGS ────────────────────────────────────────────

describe('DIAG_MSGS', () => {
  it('has messages for all standard validation reasons', () => {
    const expected = [
      'missing', 'untranslated', 'malformed —', 'em dash dropped',
      'annotation mismatch', '? mismatch', '! mismatch',
      'source leak', 'source prepend/append', 'shifted', 'truncated',
    ];
    for (const reason of expected) {
      expect(DIAG_MSGS[reason]).toBeDefined();
      expect(typeof DIAG_MSGS[reason]).toBe('function');
    }
  });

  it('generates correct message for missing', () => {
    expect(DIAG_MSGS['missing'](3, '')).toContain('[3]');
    expect(DIAG_MSGS['missing'](3, '')).toContain('EMPTY');
  });

  it('generates correct message for truncated (includes lengths)', () => {
    const msg = DIAG_MSGS['truncated'](2, 'Hi', 'Hello world this is long');
    expect(msg).toContain('[2]');
    expect(msg).toContain('2 chars');
    expect(msg).toContain('vs 24');
  });

  it('generates specific diagnostic for bracket speaker label', () => {
    const msg = DIAG_MSGS['annotation mismatch'](0, 'laughing', '[laughing]');
    expect(msg).toContain('[speaker] label');
    expect(msg).toContain('[Name]');
  });

  it('generates specific diagnostic for paren speaker label', () => {
    const msg = DIAG_MSGS['annotation mismatch'](0, 'Hello', '（太郎）Hello');
    expect(msg).toContain('(speaker) label');
    expect(msg).toContain('(Name)');
  });

  it('generates correct annotation mismatch for non-bracket original', () => {
    const msg = DIAG_MSGS['annotation mismatch'](0, '[risa]', 'Hello');
    expect(msg).toContain('translation has brackets');
  });

  it('generates punctuation messages with correct directions', () => {
    const qMsg = DIAG_MSGS['? mismatch'](1, 'Hola.', 'How are you?');
    expect(qMsg).toContain('has ?');
    expect(qMsg).toContain('missing ?');

    const eMsg = DIAG_MSGS['! mismatch'](1, 'Hola!', 'Hello');
    expect(eMsg).toContain('has no !');
    expect(eMsg).toContain('has !');
  });
});

// ── buildDiagnosticPrompt ────────────────────────────────

describe('buildDiagnosticPrompt', () => {
  const chunkCues = [
    { text: 'Hello world' },
    { text: 'How are you?' },
    { text: 'Goodbye now' },
  ];

  it('shows translations for good lines and originals for bad lines', () => {
    const results = ['Hola mundo', 'How are you?', 'Adiós'];
    const gaps = [1];
    const reasons = { 1: 'untranslated' };
    const { scriptLines, diagnosticLines } = buildDiagnosticPrompt(chunkCues, results, gaps, reasons, 'Spanish');
    expect(scriptLines[0]).toBe('[0] Hola mundo');
    expect(scriptLines[1]).toBe('[1] How are you?'); // original text for retry
    expect(scriptLines[2]).toBe('[2] Adiós');
    expect(diagnosticLines.length).toBe(1);
    expect(diagnosticLines[0]).toContain('NOT translated');
  });

  it('handles multiple gaps', () => {
    const results = [null, 'How are you?', '—Adiós'];
    const gaps = [0, 1, 2];
    const reasons = { 0: 'missing', 1: 'untranslated', 2: 'malformed —' };
    const { scriptLines, diagnosticLines } = buildDiagnosticPrompt(chunkCues, results, gaps, reasons, 'Spanish');
    expect(scriptLines.length).toBe(3);
    expect(diagnosticLines.length).toBe(3);
    expect(diagnosticLines[0]).toContain('EMPTY');
    expect(diagnosticLines[1]).toContain('NOT translated');
    expect(diagnosticLines[2]).toContain('malformed');
  });

  it('handles unknown reason codes gracefully', () => {
    const results = ['Hola', 'weird output', 'Adiós'];
    const gaps = [1];
    const reasons = { 1: 'wrong lang (French)' };
    const { diagnosticLines } = buildDiagnosticPrompt(chunkCues, results, gaps, reasons, 'Spanish');
    expect(diagnosticLines[0]).toContain('wrong lang');
  });

  it('handles mixed script reason with target language', () => {
    const results = ['Hola', '混合 text', 'Adiós'];
    const gaps = [1];
    const reasons = { 1: 'mixed script' };
    const { diagnosticLines } = buildDiagnosticPrompt(chunkCues, results, gaps, reasons, 'Spanish');
    expect(diagnosticLines[0]).toContain('Spanish');
  });

  it('returns empty arrays when no gaps', () => {
    const results = ['Hola', 'Cómo', 'Adiós'];
    const { scriptLines, diagnosticLines } = buildDiagnosticPrompt(chunkCues, results, [], {}, 'Spanish');
    expect(diagnosticLines).toEqual([]);
    expect(scriptLines.length).toBe(3);
    expect(scriptLines[0]).toBe('[0] Hola');
  });
});
