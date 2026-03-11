import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isXmlSubtitle, handleSubtitleData } from '../src/browser/intercept.js';
import { CONFIG } from '../src/config.js';

vi.mock('../src/pipeline/handler.js', () => ({ handleSubtitlePayload: vi.fn() }));
vi.mock('../src/browser/context.js', () => ({ createBrowserContext: vi.fn(() => ({})) }));

import { handleSubtitlePayload } from '../src/pipeline/handler.js';

describe('isXmlSubtitle', () => {
  it('detects TTML with <tt tag', () => {
    expect(isXmlSubtitle('<tt xmlns="http://www.w3.org/ns/ttml">...')).toBe(true);
  });

  it('detects XML with <?xml declaration', () => {
    expect(isXmlSubtitle('<?xml version="1.0"?><tt>...</tt>')).toBe(true);
  });

  it('detects XML with <body tag', () => {
    expect(isXmlSubtitle('<body><div><p>text</p></div></body>')).toBe(true);
  });

  it('rejects plain text', () => {
    expect(isXmlSubtitle('Hello world')).toBeFalsy();
  });

  it('rejects empty string', () => {
    expect(isXmlSubtitle('')).toBeFalsy();
  });

  it('rejects null/undefined', () => {
    expect(isXmlSubtitle(null)).toBeFalsy();
    expect(isXmlSubtitle(undefined)).toBeFalsy();
  });

  it('rejects JSON', () => {
    expect(isXmlSubtitle('{"key": "value"}')).toBeFalsy();
  });

  it('detects real TTML fixture content', () => {
    const { readFileSync } = require('fs');
    const { resolve } = require('path');
    const xml = readFileSync(resolve(__dirname, 'fixtures', 'netflix_ttml_sample1.xml'), 'utf-8');
    expect(isXmlSubtitle(xml)).toBe(true);
  });
});

describe('masterEnabled guard in handleSubtitleData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CONFIG.masterEnabled = true;
  });

  it('calls handleSubtitlePayload when masterEnabled is true', () => {
    handleSubtitleData('<tt>test</tt>', 'https://example.com/subs.ttml');
    expect(handleSubtitlePayload).toHaveBeenCalledOnce();
  });

  it('does not call handleSubtitlePayload when masterEnabled is false', () => {
    CONFIG.masterEnabled = false;
    handleSubtitleData('<tt>test</tt>', 'https://example.com/subs.ttml');
    expect(handleSubtitlePayload).not.toHaveBeenCalled();
  });
});
