import { describe, expect, it } from 'vitest';
import {
  addSegmentAt,
  assignSpeaker,
  deleteSegment,
  findSegmentIndexAt,
  formatTime,
  mergeWithPrevious,
  nextSpeakerLabel,
  pruneSpeakers,
  relabelSpeaker,
  setBoundary,
  speakerColor,
  speakerOrder,
  speakerStats,
  splitSegment,
} from './labelingModel';

const seg = (id, start, end, speaker = 'SPEAKER_00', text = '') => ({ id, start, end, speaker, text });

describe('labelingModel', () => {
  it('formats time with tenths and hours', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(65.25)).toBe('1:05.3');
    expect(formatTime(3725)).toBe('1:02:05.0');
    expect(formatTime(-3)).toBe('0:00.0');
  });

  it('orders speakers by first appearance and assigns stable colors', () => {
    const segments = [seg('b', 5, 6, 'SPEAKER_01'), seg('a', 1, 2, 'SPEAKER_03')];
    const order = speakerOrder(segments, ['SPEAKER_09']);
    expect(order).toEqual(['SPEAKER_03', 'SPEAKER_01', 'SPEAKER_09']);
    expect(speakerColor('SPEAKER_01', order)).not.toBe(speakerColor('SPEAKER_03', order));
  });

  it('computes stats with the longest segment', () => {
    const stats = speakerStats([seg('a', 0, 2), seg('b', 3, 8), seg('c', 9, 10, 'SPEAKER_01')]);
    expect(stats.SPEAKER_00.count).toBe(2);
    expect(stats.SPEAKER_00.total).toBe(7);
    expect(stats.SPEAKER_00.longest.id).toBe('b');
    expect(stats.SPEAKER_01.count).toBe(1);
  });

  it('picks the next free speaker label', () => {
    expect(nextSpeakerLabel(['SPEAKER_00', 'SPEAKER_07', 'Guest'])).toBe('SPEAKER_08');
    expect(nextSpeakerLabel([])).toBe('SPEAKER_00');
  });

  it('finds the segment at time, preferring the later-started overlap', () => {
    const sorted = [seg('a', 0, 10), seg('b', 4, 5, 'SPEAKER_01'), seg('c', 12, 14)];
    expect(findSegmentIndexAt(sorted, 1)).toBe(0);
    expect(findSegmentIndexAt(sorted, 4.5)).toBe(1);
    expect(findSegmentIndexAt(sorted, 7)).toBe(0);
    expect(findSegmentIndexAt(sorted, 11)).toBe(-1);
    expect(findSegmentIndexAt(sorted, 13)).toBe(2);
    expect(findSegmentIndexAt([], 1)).toBe(-1);
  });

  it('splits a segment and its text proportionally', () => {
    const res = splitSegment([seg('a', 0, 10, 'SPEAKER_00', 'one two three four')], 'a', 5, 'new');
    expect(res.newId).toBe('new');
    expect(res.segments).toEqual([
      seg('a', 0, 5, 'SPEAKER_00', 'one two'),
      seg('new', 5, 10, 'SPEAKER_00', 'three four'),
    ]);
    expect(splitSegment([seg('a', 0, 10)], 'a', 0.05)).toBeNull();
    expect(splitSegment([seg('a', 0, 10)], 'missing', 5)).toBeNull();
  });

  it('merges with the previous segment in time order', () => {
    const segments = [seg('b', 3, 5, 'SPEAKER_01', 'world'), seg('a', 0, 2, 'SPEAKER_00', 'hello')];
    const res = mergeWithPrevious(segments, 'b');
    expect(res.keptId).toBe('a');
    expect(res.segments).toEqual([seg('a', 0, 5, 'SPEAKER_00', 'hello world')]);
    expect(mergeWithPrevious(segments, 'a')).toBeNull();
  });

  it('moves boundaries within limits', () => {
    const segments = [seg('a', 2, 6)];
    expect(setBoundary(segments, 'a', 'start', 1, 10)[0].start).toBe(1);
    expect(setBoundary(segments, 'a', 'end', 12, 10)[0].end).toBe(10);
    expect(setBoundary(segments, 'a', 'start', 5.95, 10)).toBeNull();
    expect(setBoundary(segments, 'a', 'end', 1, 10)).toBeNull();
    expect(setBoundary(segments, 'a', 'middle', 3, 10)).toBeNull();
  });

  it('adds a segment that stops at the next one', () => {
    const res = addSegmentAt([seg('a', 0, 1), seg('b', 3, 4)], 2, 'SPEAKER_05', 10, 'n');
    expect(res.segments.map((s) => s.id)).toEqual(['a', 'n', 'b']);
    expect(res.segments[1]).toEqual(seg('n', 2, 3, 'SPEAKER_05'));
    const tail = addSegmentAt([], 9.5, 'SPEAKER_00', 10, 'n2');
    expect(tail.segments[0].end).toBe(10);
  });

  it('assigns, relabels and deletes', () => {
    const segments = [seg('a', 0, 1), seg('b', 1, 2, 'SPEAKER_01')];
    expect(assignSpeaker(segments, 'a', 'SPEAKER_01')[0].speaker).toBe('SPEAKER_01');
    expect(relabelSpeaker(segments, 'SPEAKER_01', 'SPEAKER_00').every((s) => s.speaker === 'SPEAKER_00')).toBe(true);
    expect(relabelSpeaker(segments, 'SPEAKER_01', 'SPEAKER_01')).toBe(segments);
    expect(deleteSegment(segments, 'a').map((s) => s.id)).toEqual(['b']);
  });

  it('prunes names of speakers without segments', () => {
    const speakers = {
      SPEAKER_00: { name: 'Иванов', user_id: 1 },
      SPEAKER_01: { name: 'Петров', user_id: 2 },
      SPEAKER_02: { name: '', user_id: null },
    };
    expect(pruneSpeakers(speakers, [seg('a', 0, 1)], [])).toEqual({ SPEAKER_00: speakers.SPEAKER_00 });
    expect(Object.keys(pruneSpeakers(speakers, [], ['SPEAKER_01']))).toEqual(['SPEAKER_01']);
  });
});

describe('labelingModel: waveform view', () => {
  it('keeps the view while the playhead is inside and re-anchors outside', async () => {
    const { nextViewStart } = await import('./labelingModel');
    expect(nextViewStart(0, 5, 30, 100)).toBe(0);
    expect(nextViewStart(0, 28, 30, 100)).toBe(22);
    expect(nextViewStart(50, 10, 30, 100)).toBe(4);
    expect(nextViewStart(0, 99, 30, 100)).toBe(70);
    expect(nextViewStart(0, 5, 30, 10)).toBe(0);
  });

  it('maps x to time and resamples peaks per bar', async () => {
    const { peaksForView, timeAtX } = await import('./labelingModel');
    expect(timeAtX(50, 100, 10, 30)).toBe(25);
    expect(timeAtX(-5, 100, 10, 30)).toBe(10);
    const peaks = [1, 9, 2, 3, 8, 0, 0, 0];
    expect(peaksForView(peaks, 0.5, 0, 2, 2)).toEqual([9, 3]);
    expect(peaksForView(peaks, 0.5, 2, 2, 1)).toEqual([8]);
    expect(peaksForView([], 0.5, 0, 2, 3)).toEqual([0, 0, 0]);
  });
});
