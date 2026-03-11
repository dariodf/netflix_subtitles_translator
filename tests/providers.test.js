import { describe, it, expect } from 'vitest';
import { langToCode, codeToLanguage, LANG_CODES } from '../src/core/providers/definitions.js';

describe('langToCode', () => {
  it('converts common language names to ISO codes', () => {
    expect(langToCode('English')).toBe('en');
    expect(langToCode('Japanese')).toBe('ja');
    expect(langToCode('Spanish')).toBe('es');
    expect(langToCode('Korean')).toBe('ko');
    expect(langToCode('Chinese')).toBe('zh');
    expect(langToCode('French')).toBe('fr');
    expect(langToCode('German')).toBe('de');
    expect(langToCode('Portuguese')).toBe('pt');
    expect(langToCode('Russian')).toBe('ru');
    expect(langToCode('Arabic')).toBe('ar');
  });

  it('is case-insensitive', () => {
    expect(langToCode('ENGLISH')).toBe('en');
    expect(langToCode('japanese')).toBe('ja');
    expect(langToCode('SpAnIsH')).toBe('es');
  });

  it('trims whitespace', () => {
    expect(langToCode('  English  ')).toBe('en');
  });

  it('returns "auto" for null/empty/undefined', () => {
    expect(langToCode(null)).toBe('auto');
    expect(langToCode(undefined)).toBe('auto');
    expect(langToCode('')).toBe('auto');
  });

  it('passes through unknown values as-is (already a code)', () => {
    expect(langToCode('en')).toBe('en');
    expect(langToCode('pt-BR')).toBe('pt-br');
  });

  it('covers all entries in LANG_CODES', () => {
    for (const [name, code] of Object.entries(LANG_CODES)) {
      expect(langToCode(name)).toBe(code);
    }
  });
});

describe('codeToLanguage', () => {
  it('converts ISO codes to capitalized language names', () => {
    expect(codeToLanguage('en')).toBe('English');
    expect(codeToLanguage('ja')).toBe('Japanese');
    expect(codeToLanguage('es')).toBe('Spanish');
    expect(codeToLanguage('ko')).toBe('Korean');
    expect(codeToLanguage('zh')).toBe('Chinese');
    expect(codeToLanguage('fr')).toBe('French');
    expect(codeToLanguage('de')).toBe('German');
    expect(codeToLanguage('pt')).toBe('Portuguese');
    expect(codeToLanguage('ru')).toBe('Russian');
    expect(codeToLanguage('ar')).toBe('Arabic');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(codeToLanguage('JA')).toBe('Japanese');
    expect(codeToLanguage('  en  ')).toBe('English');
  });

  it('returns empty string for null/empty/undefined', () => {
    expect(codeToLanguage(null)).toBe('');
    expect(codeToLanguage(undefined)).toBe('');
    expect(codeToLanguage('')).toBe('');
  });

  it('returns empty string for unknown codes', () => {
    expect(codeToLanguage('xx')).toBe('');
    expect(codeToLanguage('zz')).toBe('');
  });

  it('is the inverse of langToCode for all known languages', () => {
    for (const [name, code] of Object.entries(LANG_CODES)) {
      const expected = name.charAt(0).toUpperCase() + name.slice(1);
      expect(codeToLanguage(code)).toBe(expected);
    }
  });
});
