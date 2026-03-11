import { describe, it, expect } from 'vitest';
import { evictOldestEntries } from '../src/browser/cache.js';

describe('evictOldestEntries', () => {
  it('returns empty when cache is within size limit', () => {
    const cache = { a: { _ts: 1 }, b: { _ts: 2 } };
    expect(evictOldestEntries(cache, 5, 'url:/watch/1')).toEqual([]);
  });

  it('returns empty when cache equals max size', () => {
    const cache = { a: { _ts: 1 }, b: { _ts: 2 } };
    expect(evictOldestEntries(cache, 2, 'url:/watch/1')).toEqual([]);
  });

  it('evicts oldest entries first (by _ts)', () => {
    const cache = {
      old: { _ts: 100 },
      older: { _ts: 50 },
      new: { _ts: 500 },
      newest: { _ts: 1000 },
    };
    const toRemove = evictOldestEntries(cache, 2, 'url:/watch/1');
    expect(toRemove.length).toBe(2);
    expect(toRemove).toContain('older');
    expect(toRemove).toContain('old');
    expect(toRemove).not.toContain('newest');
  });

  it('preserves the preserveKey even if oldest', () => {
    const cache = {
      'url:/watch/1': { _ts: 1 }, // oldest but preserved
      b: { _ts: 100 },
      c: { _ts: 200 },
      d: { _ts: 300 },
    };
    const toRemove = evictOldestEntries(cache, 2, 'url:/watch/1');
    expect(toRemove).not.toContain('url:/watch/1');
    expect(toRemove).toContain('b');
  });

  it('handles entries without _ts (treated as 0)', () => {
    const cache = {
      noTs: 'plain string',
      withTs: { _ts: 500 },
      array: [1, 2, 3],
    };
    const toRemove = evictOldestEntries(cache, 1, 'preserve');
    // noTs and array have _ts=0, withTs has _ts=500
    // Should evict the two with lowest _ts
    expect(toRemove.length).toBe(2);
    expect(toRemove).toContain('noTs');
    expect(toRemove).toContain('array');
  });

  it('handles large cache correctly', () => {
    const cache = {};
    for (let i = 0; i < 25; i++) {
      cache[`key${i}`] = { _ts: i * 100 };
    }
    const toRemove = evictOldestEntries(cache, 20, 'url:/current');
    expect(toRemove.length).toBe(5);
    // Should be the 5 oldest (key0-key4)
    for (let i = 0; i < 5; i++) {
      expect(toRemove).toContain(`key${i}`);
    }
  });
});
