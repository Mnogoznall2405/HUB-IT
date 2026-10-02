import { Directory, File, Paths } from 'expo-file-system';
import { downloadGifToCache, fetchChatGifs, pruneCacheDirectory } from './chatGiphy';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.useRealTimers();
});

describe('AUD-5 fetch timeout', () => {
  it('rejects a hung Giphy request instead of spinning forever', async () => {
    jest.useFakeTimers();
    globalThis.fetch = jest.fn(() => new Promise<Response>(() => {})) as never;

    const pending = fetchChatGifs('trending');
    const assertion = expect(pending).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(9000);
    await assertion;
  });

  it('still resolves a normal response', async () => {
    globalThis.fetch = jest.fn(async () => ({
      json: async () => ({
        data: [{
          id: 'g1',
          title: 'ok',
          images: { original: { url: 'https://media.test/g1.gif' } },
        }],
      }),
    })) as never;

    await expect(fetchChatGifs('search', 'ok')).resolves.toEqual([
      expect.objectContaining({ id: 'g1', fullUrl: 'https://media.test/g1.gif' }),
    ]);
  });
});

describe('AUD-7 gif cache pruning', () => {
  it('keeps only the newest files by mtime', () => {
    const directory = new Directory(Paths.cache, 'hubit-gifs-prune-check');
    directory.create({ intermediates: true, idempotent: true });
    for (let index = 0; index < 12; index += 1) {
      new File(directory, `gif_${index}.gif`).write('x');
    }
    pruneCacheDirectory(directory, 5);

    const names = directory.list().map((entry) => entry.name).sort();
    expect(names).toHaveLength(5);
    expect(names).toContain('gif_11.gif');
    expect(names).not.toContain('gif_0.gif');
  });

  it('bounds the download cache when a new gif arrives', async () => {
    const directory = new Directory(Paths.cache, 'hubit-gifs');
    directory.create({ intermediates: true, idempotent: true });
    for (let index = 0; index < 35; index += 1) {
      new File(directory, `gif_stale_${index}.gif`).write('x');
    }

    const downloaded = await downloadGifToCache({
      id: 'fresh-gif',
      title: 'fresh',
      previewUrl: 'https://media.test/fresh-preview.gif',
      fullUrl: 'https://media.test/fresh.gif',
    });

    const remaining = directory.list().map((entry) => entry.name);
    expect(remaining.length).toBeLessThanOrEqual(30);
    // The just-downloaded file is the newest — it survives the prune.
    expect(remaining).toContain('gif_fresh-gif.gif');
    expect(new File(downloaded.uri).exists).toBe(true);
  });
});
