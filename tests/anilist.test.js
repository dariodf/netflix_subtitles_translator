import { describe, it, expect } from 'vitest';
import {
  fetchAnilistCharacters,
  stripFurigana,
  matchSpeakerToCharacter,
  buildCharacterNameMap,
  buildNameResolutionPrompt,
  parseNameResolutionResponse,
  resolveCharacterNames,
} from '../src/core/anilist.js';

describe('stripFurigana', () => {
  it('strips hiragana from kanji+furigana pattern', () => {
    expect(stripFurigana('鈴木すずき 春人はると')).toBe('鈴木春人');
  });

  it('strips inline hiragana after kanji', () => {
    expect(stripFurigana('田中たなか')).toBe('田中');
  });

  it('leaves pure kanji unchanged', () => {
    expect(stripFurigana('田中')).toBe('田中');
  });

  it('leaves katakana names unchanged', () => {
    expect(stripFurigana('エルフ')).toBe('エルフ');
  });

  it('leaves Korean text unchanged', () => {
    expect(stripFurigana('인숙')).toBe('인숙');
  });

  it('handles kanji with katakana (keeps katakana)', () => {
    expect(stripFurigana('中村なかむら')).toBe('中村');
  });

  it('leaves pure hiragana unchanged (no kanji present)', () => {
    expect(stripFurigana('ひらがな')).toBe('ひらがな');
  });
});

describe('matchSpeakerToCharacter', () => {
  const characters = [
    { fullName: 'Kenji Tanaka', nativeName: '田中健二', alternatives: [] },
    { fullName: 'Haruto Suzuki', nativeName: '鈴木春人', alternatives: [] },
    { fullName: 'Hanako', nativeName: '花子', alternatives: [] },
    { fullName: 'Takeshi Satō', nativeName: '佐藤武', alternatives: [] },
  ];

  it('matches exact native name', () => {
    expect(matchSpeakerToCharacter('花子', characters)).toBe('Hanako');
  });

  it('matches prefix of native name', () => {
    expect(matchSpeakerToCharacter('田中', characters)).toBe('Kenji Tanaka');
    expect(matchSpeakerToCharacter('佐藤', characters)).toBe('Takeshi Satō');
  });

  it('matches after furigana stripping', () => {
    expect(matchSpeakerToCharacter('鈴木すずき 春人はると', characters)).toBe('Haruto Suzuki');
  });

  it('matches full native name with furigana', () => {
    expect(matchSpeakerToCharacter('田中たなか 健二けんじ', characters)).toBe('Kenji Tanaka');
  });

  it('returns null for unknown label', () => {
    expect(matchSpeakerToCharacter('謎の男', characters)).toBe(null);
  });

  it('returns null for empty input', () => {
    expect(matchSpeakerToCharacter('', characters)).toBe(null);
    expect(matchSpeakerToCharacter('田中', [])).toBe(null);
  });

  it('handles characters without native names', () => {
    const chars = [{ fullName: 'Unknown', nativeName: null, alternatives: [] }];
    expect(matchSpeakerToCharacter('田中', chars)).toBe(null);
  });
});

describe('buildCharacterNameMap', () => {
  const characters = [
    { fullName: 'Kenji Tanaka', nativeName: '田中健二', alternatives: [] },
    { fullName: 'Haruto Suzuki', nativeName: '鈴木春人', alternatives: [] },
  ];

  it('separates matched and unmatched labels', () => {
    const labels = ['田中', '鈴木', '謎の男'];
    const { matched, unmatched } = buildCharacterNameMap(labels, characters);
    expect(matched.get('田中')).toBe('Kenji Tanaka');
    expect(matched.get('鈴木')).toBe('Haruto Suzuki');
    expect(unmatched).toEqual(['謎の男']);
  });

  it('returns all unmatched when no characters', () => {
    const { matched, unmatched } = buildCharacterNameMap(['田中'], []);
    expect(matched.size).toBe(0);
    expect(unmatched).toEqual(['田中']);
  });
});

describe('fetchAnilistCharacters', () => {
  it('parses GraphQL response into character list', async () => {
    const mockPostJson = async () => ({
      data: {
        data: {
          Media: {
            title: { romaji: 'Shadow Academy', native: '影学園', english: 'SHADOW ACADEMY' },
            characters: {
              nodes: [
                { name: { full: 'Kenji Tanaka', native: '田中健二', alternative: ['Ken'] } },
                { name: { full: 'Haruto Suzuki', native: '鈴木春人', alternative: [] } },
              ],
            },
          },
        },
      },
    });

    const chars = await fetchAnilistCharacters('Shadow Academy', mockPostJson);
    expect(chars.length).toBe(2);
    expect(chars[0].fullName).toBe('Kenji Tanaka');
    expect(chars[0].nativeName).toBe('田中健二');
    expect(chars[0].alternatives).toEqual(['Ken']);
    expect(chars[1].fullName).toBe('Haruto Suzuki');
  });

  it('returns empty array on network error', async () => {
    const mockPostJson = async () => { throw new Error('Network error'); };
    const chars = await fetchAnilistCharacters('test', mockPostJson);
    expect(chars).toEqual([]);
  });

  it('returns empty array when no data', async () => {
    const mockPostJson = async () => ({ data: { data: { Media: null } } });
    const chars = await fetchAnilistCharacters('nonexistent', mockPostJson);
    expect(chars).toEqual([]);
  });

  it('filters out characters without fullName', async () => {
    const mockPostJson = async () => ({
      data: {
        data: {
          Media: {
            characters: {
              nodes: [
                { name: { full: null, native: '田中', alternative: [] } },
                { name: { full: 'Hanako', native: '花子', alternative: [] } },
              ],
            },
          },
        },
      },
    });
    const chars = await fetchAnilistCharacters('test', mockPostJson);
    expect(chars.length).toBe(1);
    expect(chars[0].fullName).toBe('Hanako');
  });
});

describe('buildNameResolutionPrompt', () => {
  it('builds system and user prompts', () => {
    const { system, user } = buildNameResolutionPrompt(['인숙', '석류'], 'City Lights', 'Korean');
    expect(system).toContain('Korean');
    expect(system).toContain('City Lights');
    expect(user).toContain('인숙');
    expect(user).toContain('석류');
  });

  it('handles missing source language', () => {
    const { system } = buildNameResolutionPrompt(['田中'], 'Test Show', '');
    expect(system).toContain('Asian language');
  });

  it('includes cast character names when provided', () => {
    const cast = [
      { character: 'Natsume' },
      { character: 'Shunsuke' },
      { character: '' },
    ];
    const { system } = buildNameResolutionPrompt(['夏目'], 'Test Show', 'Japanese', cast);
    expect(system).toContain('Natsume');
    expect(system).toContain('Shunsuke');
  });

  it('works without cast', () => {
    const { system } = buildNameResolutionPrompt(['夏目'], 'Test Show', 'Japanese');
    expect(system).not.toContain('Known characters');
  });
});

describe('parseNameResolutionResponse', () => {
  it('parses source = english format', () => {
    const map = parseNameResolutionResponse('인숙 = Insook\n석류 = Seokryu');
    expect(map.get('인숙')).toBe('Insook');
    expect(map.get('석류')).toBe('Seokryu');
  });

  it('parses source → english format', () => {
    const map = parseNameResolutionResponse('인숙 → Insook');
    expect(map.get('인숙')).toBe('Insook');
  });

  it('strips numbering prefixes', () => {
    const map = parseNameResolutionResponse('1. 인숙 = Insook\n2. 석류 = Seokryu');
    expect(map.get('인숙')).toBe('Insook');
    expect(map.get('석류')).toBe('Seokryu');
  });

  it('returns empty map for empty input', () => {
    expect(parseNameResolutionResponse('')).toEqual(new Map());
    expect(parseNameResolutionResponse(null)).toEqual(new Map());
  });

  it('skips malformed lines', () => {
    const map = parseNameResolutionResponse('valid = Name\njust some text\nalso valid = Another');
    expect(map.size).toBe(2);
  });
});

describe('resolveCharacterNames', () => {
  it('resolves names via AniList matching', async () => {
    const cues = [
      { text: '（田中）おい！' },
      { text: '（鈴木）何だ？' },
      { text: '（謎の男）誰だ' },
    ];
    const mockPostJson = async () => ({
      data: {
        data: {
          Media: {
            characters: {
              nodes: [
                { name: { full: 'Kenji Tanaka', native: '田中健二', alternative: [] } },
                { name: { full: 'Haruto Suzuki', native: '鈴木春人', alternative: [] } },
              ],
            },
          },
        },
      },
    });

    const { characterNameMap, unmatchedLabels } = await resolveCharacterNames(cues, 'Shadow Academy', mockPostJson);
    expect(characterNameMap.get('田中')).toBe('Kenji Tanaka');
    expect(characterNameMap.get('鈴木')).toBe('Haruto Suzuki');
    expect(unmatchedLabels).toEqual(['謎の男']);
  });

  it('returns all unmatched when AniList returns nothing', async () => {
    const cues = [{ text: '[인숙]네가 그렇게' }];
    const mockPostJson = async () => ({ data: { data: { Media: null } } });

    const { characterNameMap, unmatchedLabels } = await resolveCharacterNames(cues, 'City Lights', mockPostJson);
    expect(characterNameMap.size).toBe(0);
    expect(unmatchedLabels).toEqual(['인숙']);
  });

  it('returns empty results when no speaker labels', async () => {
    const cues = [{ text: '自由だー！' }];
    const mockPostJson = async () => { throw new Error('should not be called'); };

    const { characterNameMap, unmatchedLabels } = await resolveCharacterNames(cues, 'test', mockPostJson);
    expect(characterNameMap.size).toBe(0);
    expect(unmatchedLabels.length).toBe(0);
  });
});
