// Merged-meeting media helpers (pure, unit-testable).
// `parts` entries: { base, has_media, offset } — offset = part start inside the
// merged timeline, seconds.

// Media src for a speaker label at time `start` (seconds).
// - Meeting with its own media → mediaUrl(base)#t=start
// - Label "P{n}_SPEAKER_xx" → part n-1 (merged_from order)
// - Otherwise → the last part whose offset <= start (its window contains t)
// Returns url with #t fragment or null.
export function speakerMediaSrc({ label, start, hasMedia, base, parts, mediaUrl }) {
  const t = Number(start);
  if (!Number.isFinite(t)) return null;
  if (hasMedia) return `${mediaUrl(base)}#t=${Math.max(0, t)}`;
  const eligible = (parts || []).filter((p) => p.has_media);
  if (!eligible.length) return null;
  const prefix = /^P(\d+)_/i.exec(String(label || ''));
  if (prefix) {
    const part = eligible[Number(prefix[1]) - 1] || parts[Number(prefix[1]) - 1];
    if (part?.has_media) {
      return `${mediaUrl(part.base)}#t=${Math.max(0, t - (part.offset || 0))}`;
    }
  }
  const byOffset = eligible.filter((p) => Number(p.offset || 0) <= t);
  const part = byOffset[byOffset.length - 1] || eligible[0];
  return `${mediaUrl(part.base)}#t=${Math.max(0, t - (part.offset || 0))}`;
}

// Which part should serve time `t` on a merged timeline, and the local offset.
// Returns { part, local } or null when nothing has media.
export function pickMergedPart(parts, t) {
  const target = Number(t);
  const eligible = (parts || []).filter((p) => p.has_media);
  if (!eligible.length || !Number.isFinite(target)) return null;
  const byOffset = eligible.filter((p) => Number(p.offset || 0) <= target);
  const part = byOffset[byOffset.length - 1] || eligible[0];
  return { part, local: Math.max(0, target - (part.offset || 0)) };
}
