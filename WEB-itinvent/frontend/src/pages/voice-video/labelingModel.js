// Pure editing operations for the diarization labeling editor (unit-tested in Node).
// A segment: { id, start, end, speaker, text } — seconds, speaker = "SPEAKER_00"-style label.

export const MIN_SEGMENT_SEC = 0.1;
export const NEW_SEGMENT_SEC = 2;

// Readable on both light and dark backgrounds.
export const SPEAKER_COLORS = [
  '#1e88e5', '#e53935', '#43a047', '#fb8c00', '#8e24aa',
  '#00897b', '#d81b60', '#6d4c41', '#3949ab', '#c0ca33',
  '#00acc1', '#f4511e',
];

const round3 = (n) => Math.round(n * 1000) / 1000;

let idSeq = 0;
export function makeSegmentId() {
  idSeq += 1;
  return `n${Date.now().toString(36)}${idSeq.toString(36)}`;
}

export function formatTime(sec) {
  const total = Math.max(0, Number(sec) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s.toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function formatDuration(sec) {
  const total = Math.round(Math.max(0, Number(sec) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} ч ${m} мин`;
  if (m) return `${m} мин ${s} с`;
  return `${s} с`;
}

export function sortSegments(segments) {
  return [...(segments || [])].sort((a, b) => (a.start - b.start) || (a.end - b.end));
}

// Speakers in order of first appearance plus any extra labels (e.g. just added).
export function speakerOrder(segments, extraLabels = []) {
  const order = [];
  const seen = new Set();
  for (const seg of sortSegments(segments)) {
    if (!seen.has(seg.speaker)) {
      seen.add(seg.speaker);
      order.push(seg.speaker);
    }
  }
  for (const label of extraLabels) {
    if (label && !seen.has(label)) {
      seen.add(label);
      order.push(label);
    }
  }
  return order;
}

export function speakerColor(label, order) {
  const idx = Math.max(0, (order || []).indexOf(label));
  return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
}

export function speakerStats(segments) {
  const stats = {};
  for (const seg of segments || []) {
    const entry = stats[seg.speaker] || { count: 0, total: 0, longest: null };
    entry.count += 1;
    entry.total += Math.max(0, seg.end - seg.start);
    if (!entry.longest || (seg.end - seg.start) > (entry.longest.end - entry.longest.start)) {
      entry.longest = seg;
    }
    stats[seg.speaker] = entry;
  }
  return stats;
}

export function nextSpeakerLabel(labels) {
  let max = -1;
  for (const label of labels || []) {
    const m = /^SPEAKER_(\d+)$/.exec(String(label || ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `SPEAKER_${String(max + 1).padStart(2, '0')}`;
}

// Index of the segment playing at time t (sorted input). With overlapping
// segments the later-started one wins: it is usually the interruption.
export function findSegmentIndexAt(sorted, t) {
  let lo = 0;
  let hi = sorted.length - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].start <= t) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  for (let i = candidate; i >= 0 && i > candidate - 16; i -= 1) {
    if (sorted[i].start <= t && t < sorted[i].end) return i;
  }
  return -1;
}

const replaceById = (segments, id, updater) => segments.map((s) => (s.id === id ? updater(s) : s));

export function assignSpeaker(segments, id, speaker) {
  return replaceById(segments, id, (s) => ({ ...s, speaker }));
}

export function relabelSpeaker(segments, fromLabel, toLabel) {
  if (!fromLabel || !toLabel || fromLabel === toLabel) return segments;
  return segments.map((s) => (s.speaker === fromLabel ? { ...s, speaker: toLabel } : s));
}

export function deleteSegment(segments, id) {
  return segments.filter((s) => s.id !== id);
}

export function updateText(segments, id, text) {
  return replaceById(segments, id, (s) => ({ ...s, text: String(text ?? '') }));
}

// Split the text proportionally to time so both halves keep roughly their words.
function splitText(text, fraction) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const cut = Math.round(words.length * fraction);
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
}

// Returns { segments, newId } or null when t is too close to a boundary.
export function splitSegment(segments, id, t, newId = makeSegmentId()) {
  const seg = segments.find((s) => s.id === id);
  if (!seg) return null;
  if (!(t - seg.start >= MIN_SEGMENT_SEC && seg.end - t >= MIN_SEGMENT_SEC)) return null;
  const at = round3(t);
  const [left, right] = splitText(seg.text, (at - seg.start) / (seg.end - seg.start));
  const out = [];
  for (const s of segments) {
    if (s.id !== id) {
      out.push(s);
    } else {
      out.push({ ...s, end: at, text: left });
      out.push({ ...s, id: newId, start: at, text: right });
    }
  }
  return { segments: out, newId };
}

// Merge a segment into the previous one (in time order); the previous speaker wins.
export function mergeWithPrevious(segments, id) {
  const sorted = sortSegments(segments);
  const idx = sorted.findIndex((s) => s.id === id);
  if (idx <= 0) return null;
  const prev = sorted[idx - 1];
  const cur = sorted[idx];
  const merged = {
    ...prev,
    start: Math.min(prev.start, cur.start),
    end: Math.max(prev.end, cur.end),
    text: [prev.text, cur.text].filter(Boolean).join(' '),
  };
  return {
    segments: segments.filter((s) => s.id !== cur.id).map((s) => (s.id === prev.id ? merged : s)),
    keptId: prev.id,
  };
}

// Move one boundary of a segment to t; returns null if the result would be invalid.
export function setBoundary(segments, id, edge, t, duration) {
  const seg = segments.find((s) => s.id === id);
  if (!seg || !Number.isFinite(t)) return null;
  const limit = Number(duration) > 0 ? Number(duration) : Infinity;
  const at = round3(Math.min(Math.max(0, t), limit));
  if (edge === 'start') {
    if (seg.end - at < MIN_SEGMENT_SEC) return null;
    return replaceById(segments, id, (s) => ({ ...s, start: at }));
  }
  if (edge === 'end') {
    if (at - seg.start < MIN_SEGMENT_SEC) return null;
    return replaceById(segments, id, (s) => ({ ...s, end: at }));
  }
  return null;
}

// New segment at t for missed speech; ends at the next segment start or after NEW_SEGMENT_SEC.
export function addSegmentAt(segments, t, speaker, duration, newId = makeSegmentId()) {
  const limit = Number(duration) > 0 ? Number(duration) : Infinity;
  const start = round3(Math.min(Math.max(0, t), limit - MIN_SEGMENT_SEC));
  if (!Number.isFinite(start) || start < 0) return null;
  const nextStart = sortSegments(segments).find((s) => s.start > start)?.start ?? Infinity;
  let end = Math.min(start + NEW_SEGMENT_SEC, limit, nextStart);
  if (end - start < MIN_SEGMENT_SEC) end = Math.min(start + NEW_SEGMENT_SEC, limit);
  if (end - start < MIN_SEGMENT_SEC) return null;
  return {
    segments: sortSegments([...segments, { id: newId, start, end: round3(end), speaker, text: '' }]),
    newId,
  };
}

// Drop names of labels that no longer have segments and were not kept explicitly.
export function pruneSpeakers(speakers, segments, keepLabels = []) {
  const used = new Set((segments || []).map((s) => s.speaker));
  keepLabels.forEach((l) => used.add(l));
  const out = {};
  for (const [label, info] of Object.entries(speakers || {})) {
    if (used.has(label) && info?.name) out[label] = info;
  }
  return out;
}

export function labelingSnapshot(segments, speakers, title) {
  return JSON.stringify({ segments, speakers, title });
}

// --- Zoomed waveform view -------------------------------------------------

export const ZOOM_LEVELS = [10, 30, 120];

// Keep the view still while the playhead stays inside it; re-anchor when it
// leaves (playhead lands at 20% of the window) — no constant jitter.
export function nextViewStart(prevStart, t, windowSec, duration) {
  const maxStart = Math.max(0, (Number(duration) || 0) - windowSec);
  const clamp = (v) => Math.min(Math.max(0, v), maxStart || Math.max(0, v));
  const start = Number.isFinite(prevStart) ? prevStart : 0;
  if (t >= start && t <= start + windowSec * 0.9) return clamp(start);
  return clamp(t - windowSec * 0.2);
}

export function timeAtX(x, width, viewStart, windowSec) {
  if (!(width > 0)) return viewStart;
  return viewStart + (Math.min(Math.max(0, x), width) / width) * windowSec;
}

// Peaks inside [viewStart, viewStart + windowSec] resampled to `columns` bars (max per bar).
export function peaksForView(peaks, step, viewStart, windowSec, columns) {
  const out = new Array(Math.max(0, columns)).fill(0);
  if (!peaks?.length || !(step > 0) || !(columns > 0)) return out;
  for (let c = 0; c < columns; c += 1) {
    const t0 = viewStart + (c / columns) * windowSec;
    const t1 = viewStart + ((c + 1) / columns) * windowSec;
    const i0 = Math.floor(t0 / step);
    const i1 = Math.max(i0 + 1, Math.ceil(t1 / step));
    let max = 0;
    for (let i = Math.max(0, i0); i < Math.min(peaks.length, i1); i += 1) {
      if (peaks[i] > max) max = peaks[i];
    }
    out[c] = max;
  }
  return out;
}
