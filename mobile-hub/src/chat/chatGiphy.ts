import { Directory, File, Paths } from 'expo-file-system';
import { withMediaPanelTimeout } from './chatAttachmentPanel';

export type ChatGifItem = {
  id: string;
  title: string;
  previewUrl: string;
  fullUrl: string;
};

// Same public frontend key as web ChatEmojiPanel. Native only talks to Giphy the same way web already does.
const GIPHY_API_KEY = 'jmrWbIIOpKlLIAVDHVyVvjhEJSJ3nNZC';

// AUD-7: bound the gif cache — keep the newest files by mtime.
const GIF_CACHE_KEEP_FILES = 30;

/** LRU-prune a dedicated cache directory to the `keep` most recent files.
 * Directories are never touched; failures are best-effort. */
export function pruneCacheDirectory(directory: Directory, keep = GIF_CACHE_KEEP_FILES): void {
  try {
    const files = directory.list().filter((entry): entry is File => entry instanceof File);
    if (files.length <= keep) return;
    files
      .sort((a, b) => Number(a.lastModified || 0) - Number(b.lastModified || 0))
      .slice(0, files.length - keep)
      .forEach((file) => {
        try { file.delete(); } catch { /* keep the rest */ }
      });
  } catch { /* pruning must never break a download/export */ }
}

export function mapGiphyResult(item: {
  id?: string;
  title?: string;
  images?: {
    fixed_width?: { url?: string };
    original?: { url?: string };
  };
}): ChatGifItem | null {
  const id = String(item?.id || '').trim();
  const previewUrl = String(item?.images?.fixed_width?.url || item?.images?.original?.url || '').trim();
  const fullUrl = String(item?.images?.original?.url || item?.images?.fixed_width?.url || '').trim();
  if (!id || !fullUrl) return null;
  return {
    id,
    title: String(item?.title || '').trim(),
    previewUrl: previewUrl || fullUrl,
    fullUrl,
  };
}

export function buildGiphyUrl(kind: 'trending' | 'search', query = ''): string {
  const encoded = encodeURIComponent(query.trim());
  if (kind === 'search') {
    return `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encoded}&limit=30&rating=g`;
  }
  return `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=30&rating=g`;
}

export async function fetchChatGifs(kind: 'trending' | 'search', query = ''): Promise<ChatGifItem[]> {
  // AUD-5: bound the await — a hung fetch must reject so the GIF tab lands on
  // an error state instead of an endless spinner.
  const response = await withMediaPanelTimeout(fetch(buildGiphyUrl(kind, query)));
  const data = await withMediaPanelTimeout(
    response.json() as Promise<{ data?: Array<Parameters<typeof mapGiphyResult>[0]> }>,
  );
  return (Array.isArray(data.data) ? data.data : [])
    .map(mapGiphyResult)
    .filter((item): item is ChatGifItem => Boolean(item));
}

export async function downloadGifToCache(item: ChatGifItem): Promise<{
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  source: 'gif';
}> {
  const directory = new Directory(Paths.cache, 'hubit-gifs');
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, `gif_${item.id}.gif`);
  if (destination.exists) destination.delete();
  const downloaded = await File.downloadFileAsync(item.fullUrl, destination, { idempotent: true });
  // AUD-7: bound the cache — keep the newest files, drop the rest.
  pruneCacheDirectory(directory);
  return {
    uri: downloaded.uri,
    name: `gif_${item.id}.gif`,
    mimeType: 'image/gif',
    size: Math.max(1, Number(downloaded.size || 0)),
    source: 'gif',
  };
}
