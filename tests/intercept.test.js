import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isXmlSubtitle, isMetadataUrl, handleSubtitleData } from '../src/browser/intercept.js';
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

describe('isMetadataUrl', () => {
  it('detects Netflix metadata API URL', () => {
    expect(isMetadataUrl('https://www.netflix.com/nq/website/memberapi/release/metadata?movieid=81727843&imageFormat=webp')).toBe(true);
  });

  it('detects URL with extra query params', () => {
    expect(isMetadataUrl('https://www.netflix.com/nq/website/memberapi/release/metadata?movieid=123&_=1773843760327')).toBe(true);
  });

  it('rejects subtitle URLs', () => {
    expect(isMetadataUrl('https://ipv4-c001-nrt002.nflxvideo.net/textstream?o=AQE')).toBeFalsy();
  });

  it('rejects null/undefined', () => {
    expect(isMetadataUrl(null)).toBeFalsy();
    expect(isMetadataUrl(undefined)).toBeFalsy();
  });

  it('rejects unrelated Netflix URLs', () => {
    expect(isMetadataUrl('https://www.netflix.com/watch/81727843')).toBeFalsy();
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
