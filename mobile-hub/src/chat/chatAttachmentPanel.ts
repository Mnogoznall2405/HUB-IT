import { validateUploadFile } from '../files/filePolicy';
import type { NativePickedFile } from '../files/nativeFilePicker';

export type PanelMediaAsset = {
  id: string;
  uri: string;
  filename: string;
  mediaType: 'photo' | 'video';
  /** seconds, for the video badge */
  duration: number;
  width?: number;
  height?: number;
};

export type PanelAlbum = {
  id: string;
  title: string;
};

export const MEDIA_PAGE_SIZE = 90;
export const MEDIA_GRID_COLUMNS = 3;
export const MEDIA_MAX_SELECTION = 10;
export const MEDIA_PANEL_TIMEOUT_MS = 8000;

/** Bounds a media-store/permission await: a hung native call rejects after `ms`
 * so the panel can offer «Повторить» instead of an endless spinner. */
export async function withMediaPanelTimeout<T>(
  promise: Promise<T>,
  ms = MEDIA_PANEL_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('media panel timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Toggle an asset keeping pick order; returns selection positions 1..N. */
export function toggleMediaSelection(
  selected: PanelMediaAsset[],
  asset: PanelMediaAsset,
  limit = MEDIA_MAX_SELECTION,
): PanelMediaAsset[] {
  const index = selected.findIndex((item) => item.id === asset.id);
  if (index >= 0) return selected.filter((item) => item.id !== asset.id);
  if (selected.length >= limit) return selected;
  return [...selected, asset];
}

/** Reorder the selection to match `nextIds`; assets missing from the list keep
 * their tail positions so a mid-drag toggle never drops a pick. */
export function reorderPanelAssets(
  current: PanelMediaAsset[],
  nextIds: string[],
): PanelMediaAsset[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  const next: PanelMediaAsset[] = [];
  const placed = new Set<string>();
  for (const id of nextIds) {
    const item = byId.get(id);
    if (item && !placed.has(id)) {
      next.push(item);
      placed.add(id);
    }
  }
  for (const item of current) {
    if (!placed.has(item.id)) next.push(item);
  }
  return next;
}

export function mediaSelectionIndex(selected: PanelMediaAsset[], assetId: string): number {
  return selected.findIndex((item) => item.id === assetId);
}

export function mediaSelectionBadge(selected: PanelMediaAsset[], assetId: string): string {
  const index = mediaSelectionIndex(selected, assetId);
  return index >= 0 ? String(index + 1) : '';
}

const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska',
  webm: 'video/webm', '3gp': 'video/3gpp',
};

export function guessMediaMimeType(asset: PanelMediaAsset): string {
  const ext = String(asset.filename || '').split('.').pop()?.toLowerCase() || '';
  return EXTENSION_MIME[ext] || (asset.mediaType === 'video' ? 'video/mp4' : 'image/jpeg');
}

/** Map a media-library asset into the existing attachment-draft contract. */
export function mediaAssetToPickedFile(asset: PanelMediaAsset): NativePickedFile {
  // The media store exposes no file size; a placeholder size keeps the
  // name/type checks, while the upload path resolves the real byte size.
  const policy = validateUploadFile({
    name: asset.filename || `media-${asset.id}`,
    mimeType: guessMediaMimeType(asset),
    size: 1,
  });
  return {
    uri: asset.uri,
    name: policy.name,
    mimeType: policy.mimeType || guessMediaMimeType(asset),
    size: 0,
    source: 'gallery',
  };
}

export function formatMediaDuration(durationSeconds: number): string {
  const total = Math.max(0, Math.round(Number(durationSeconds) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
