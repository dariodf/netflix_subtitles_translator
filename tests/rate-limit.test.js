import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Mock sleep to avoid real delays in tests
vi.mock('../src/core/utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, sleep: vi.fn(() => Promise.resolve()) };
});

import { _sendLLMRequest } from '../src/pipeline/request.js';

// ── Real Gemini error payloads (sourced from Google AI Developer Forum) ──
// Fixtures live in tests/fixtures/ — update there if Gemini changes response format.

const __dirname = dirname(fileURLToPath(import.meta.url));
const loadFixture = (name) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));

const GEMINI_RPM_THROTTLE = loadFixture('gemini_error_rpm_throttle.json');
const GEMINI_DAILY_QUOTA = loadFixture('gemini_error_daily_quota.json');
const GEMINI_SUCCESS = loadFixture('gemini_success_response.json');

// ── Helpers ──

const makeCues = (n = 2) =>
  Array.from({ length: n }, (_, i) => ({ text: `Line ${i}`, begin: i * 1000, end: (i + 1) * 1000 }));

const scriptLines = ['[0] Line 0', '[1] Line 1'];

/** Wrap a response payload as { status, data }, repeating it for all retry attempts. */
const allRetries = (data, status = 200) =>
  Array.from({ length: 4 }, () => ({ status, data }));

function makeContext({ postJsonResponses }) {
  let callIndex = 0;
  const calls = {
    reportRateLimit: [],
    reportStatus: [],
  };
  return {
    calls,
    context: {
      config: { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'test-key', debugLog: false },
      glossary: { buildContextBlock: () => '', terms: new Map() },
      showMetadata: null,
      sharedTranslationState: { translationPassLabel: null, debugLog: null },
      postJson: vi.fn(async () => postJsonResponses[Math.min(callIndex++, postJsonResponses.length - 1)]),
      reportStatus: vi.fn((msg, type) => calls.reportStatus.push({ msg, type })),
      reportRateLimit: vi.fn((name) => calls.reportRateLimit.push(name)),
    },
  };
}

// ── Tests ──

describe('rate limit handling', () => {
  it('does NOT show rate limit banner for per-minute throttle (RPM)', async () => {
    const { context, calls } = makeContext({ postJsonResponses: allRetries(GEMINI_RPM_THROTTLE) });

    const result = await _sendLLMRequest(makeCues(), scriptLines, {}, context);

    expect(result).toEqual(['Line 0', 'Line 1']);
    expect(calls.reportRateLimit).toEqual([]);
    expect(calls.reportStatus.some(s => s.msg.includes('Rate limited'))).toBe(true);
  });

  it('shows rate limit banner for daily quota exhaustion (RPD)', async () => {
    const { context, calls } = makeContext({ postJsonResponses: allRetries(GEMINI_DAILY_QUOTA) });

    await _sendLLMRequest(makeCues(), scriptLines, {}, context);

    expect(calls.reportRateLimit.length).toBeGreaterThan(0);
    expect(calls.reportRateLimit[0]).toBe('Google Gemini (free tier)');
  });

  it('detects daily quota from HTTP 429 with quota message in body', async () => {
    const { context, calls } = makeContext({ postJsonResponses: allRetries(GEMINI_DAILY_QUOTA, 429) });

    await _sendLLMRequest(makeCues(), scriptLines, {}, context);

    expect(calls.reportRateLimit.length).toBeGreaterThan(0);
  });

  it('treats plain HTTP 429 without body details as RPM (no banner)', async () => {
    const { context, calls } = makeContext({ postJsonResponses: allRetries({}, 429) });

    await _sendLLMRequest(makeCues(), scriptLines, {}, context);

    expect(calls.reportRateLimit).toEqual([]);
  });

  it('recovers successfully after transient RPM throttle', async () => {
    const { context, calls } = makeContext({
      postJsonResponses: [
        { status: 200, data: GEMINI_RPM_THROTTLE },
        { status: 200, data: GEMINI_SUCCESS },
      ],
    });

    const result = await _sendLLMRequest(makeCues(), scriptLines, {}, context);

    expect(result).toEqual(['Hola', 'Mundo']);
    expect(calls.reportRateLimit).toEqual([]);
  });

  it('treats HTTP 503 as transient rate limit (no banner)', async () => {
    const { context, calls } = makeContext({
      postJsonResponses: [
        { status: 503, data: {} },
        { status: 200, data: GEMINI_SUCCESS },
      ],
    });

    const result = await _sendLLMRequest(makeCues(), scriptLines, {}, context);

    expect(result).toEqual(['Hola', 'Mundo']);
    expect(calls.reportRateLimit).toEqual([]);
  });
});
