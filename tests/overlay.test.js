import { describe, it, expect } from 'vitest';
import { formatCueTextForDisplay } from '../src/ui/overlay.js';

describe('formatCueTextForDisplay', () => {
  it('converts em dash (encoded <br>) to newline', () => {
    expect(formatCueTextForDisplay('your quarterlies—look very good.')).toBe('your quarterlies\nlook very good.');
  });

  it('converts slash separator to newline', () => {
    expect(formatCueTextForDisplay('Hello / World')).toBe('Hello\nWorld');
  });

  it('converts multiple em dashes to newlines', () => {
    expect(formatCueTextForDisplay('A—B—C')).toBe('A\nB\nC');
  });

  it('leaves plain text unchanged', () => {
    expect(formatCueTextForDisplay('No breaks here.')).toBe('No breaks here.');
  });

  it('handles empty string', () => {
    expect(formatCueTextForDisplay('')).toBe('');
  });
});
