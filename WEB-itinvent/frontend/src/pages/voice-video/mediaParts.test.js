import { describe, expect, it } from 'vitest';
import { pickMergedPart, speakerMediaSrc } from './mediaParts.js';

const url = (base) => `/api/v1/voice/meetings/${base}/media`;

const parts = [
  { base: 'part1', has_media: true, offset: 0 },
  { base: 'part2', has_media: true, offset: 600 },
];

describe('speakerMediaSrc', () => {
  it('uses meeting media directly when present', () => {
    expect(speakerMediaSrc({
      label: 'SPEAKER_00', start: 42, hasMedia: true, base: 'meet', parts, mediaUrl: url,
    })).toBe(`${url('meet')}#t=42`);
  });

  it('P{n}_ prefix selects merged_from part n-1 with offset subtracted', () => {
    expect(speakerMediaSrc({
      label: 'P2_SPEAKER_01', start: 700, hasMedia: false, base: 'meet', parts, mediaUrl: url,
    })).toBe(`${url('part2')}#t=100`);
  });

  it('falls back to the part whose window contains t', () => {
    expect(speakerMediaSrc({
      label: 'SPEAKER_00', start: 650, hasMedia: false, base: 'meet', parts, mediaUrl: url,
    })).toBe(`${url('part2')}#t=50`);
  });

  it('returns null for non-finite start or no media parts', () => {
    expect(speakerMediaSrc({ label: 'S', start: 'x', hasMedia: false, parts, mediaUrl: url })).toBeNull();
    expect(speakerMediaSrc({
      label: 'S', start: 5, hasMedia: false, parts: [{ base: 'p', has_media: false }], mediaUrl: url,
    })).toBeNull();
  });
});

describe('pickMergedPart', () => {
  it('picks the last part whose offset <= t', () => {
    expect(pickMergedPart(parts, 650)).toEqual({ part: parts[1], local: 50 });
  });

  it('falls back to the first eligible part when t precedes all offsets', () => {
    const shifted = [{ ...parts[0] }, { ...parts[1], offset: 1000 }];
    expect(pickMergedPart(shifted, 500).part.base).toBe('part1');
  });

  it('skips parts without media', () => {
    const p2nomedia = [{ ...parts[0] }, { base: 'part2', has_media: false, offset: 600 }];
    expect(pickMergedPart(p2nomedia, 650).part.base).toBe('part1');
  });

  it('returns null when nothing has media', () => {
    expect(pickMergedPart([], 10)).toBeNull();
    expect(pickMergedPart(null, 10)).toBeNull();
  });
});
