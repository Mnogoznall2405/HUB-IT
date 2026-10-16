import {
  LegacyUploadRequired,
  RETRY_DELAYS_MS,
  uploadPhotoResumable,
  type ResumableUploadDeps,
} from './resumablePhotoUpload';

const CHUNK = 4;
const SIZE = 10; // 3 куска: 4 + 4 + 2

const networkError = () => Object.assign(new Error('Network Error'), { isAxiosError: true });
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

// Минимальный «сервер»: помнит принятые куски между вызовами, как настоящий.
function fakeServer() {
  const received = new Set<number>();
  const sentChunks: number[] = [];
  let completed = 0;
  const failures: Array<() => Error | null> = [];
  const maybeFail = () => {
    const next = failures.shift();
    const error = next?.();
    if (error) throw error;
  };
  const state = () => ({
    upload_id: 'u1',
    status: completed ? 'complete' as const : 'uploading' as const,
    item_id: 7,
    size: SIZE,
    chunk_size: CHUNK,
    total_chunks: 3,
    received: [...received].sort(),
    file_no: completed ? 555 : null,
  });
  const deps: Partial<ResumableUploadDeps> = {
    prepare: async (file) => ({ ...file, size: SIZE }),
    readChunk: (_uri, _offset, length) => new ArrayBuffer(length),
    makeClientId: async () => 'client-id-0001',
    create: async () => state(),
    putChunk: async (_id, index) => {
      maybeFail();
      received.add(index);
      sentChunks.push(index);
      return state();
    },
    complete: async () => {
      maybeFail();
      completed += 1;
      return { file_no: 555, item_id: 7, file_name: 'a.jpg' };
    },
    sleep: jest.fn(async () => undefined),
  };
  return { deps, failures, sentChunks, received, completedCount: () => completed };
}

let counter = 0;
const photo = () => {
  counter += 1;
  return { uri: `file:///photo-${counter}.jpg`, name: 'a.jpg', mimeType: 'image/jpeg' };
};

describe('uploadPhotoResumable', () => {
  it('survives a dropped connection mid-upload without resending accepted chunks', async () => {
    const server = fakeServer();
    server.failures.push(() => null, () => networkError(), () => networkError());

    const fileNo = await uploadPhotoResumable(7, photo(), 'main', {}, server.deps);

    expect(fileNo).toBe(555);
    expect(server.sentChunks).toEqual([0, 1, 2]);
    expect(server.completedCount()).toBe(1);
    expect(server.deps.sleep).toHaveBeenCalledTimes(2);
  });

  it('after the app gave up, the next attempt sends only what the server lacks', async () => {
    const server = fakeServer();
    const file = photo();
    // Chunk 0 goes through, then the link stays dead for every retry.
    server.failures.push(() => null, ...RETRY_DELAYS_MS.map(() => () => networkError()), () => networkError());

    await expect(uploadPhotoResumable(7, file, 'main', {}, server.deps)).rejects.toThrow('Network Error');
    expect([...server.received]).toEqual([0]);

    server.failures.length = 0;
    await expect(uploadPhotoResumable(7, file, 'main', {}, server.deps)).resolves.toBe(555);
    expect(server.sentChunks).toEqual([0, 1, 2]); // chunk 0 was sent exactly once overall
    expect(server.completedCount()).toBe(1);
  });

  it('does not retry a permanent rejection', async () => {
    const server = fakeServer();
    server.failures.push(() => httpError(400));

    await expect(uploadPhotoResumable(7, photo(), 'main', {}, server.deps)).rejects.toMatchObject({
      response: { status: 400 },
    });
    expect(server.deps.sleep).not.toHaveBeenCalled();
    expect(server.completedCount()).toBe(0);
  });

  it('retries while the server is still assembling (409) and finishes once', async () => {
    const server = fakeServer();
    server.failures.push(() => null, () => null, () => null, () => httpError(409));

    await expect(uploadPhotoResumable(7, photo(), 'main', {}, server.deps)).resolves.toBe(555);
    expect(server.completedCount()).toBe(1);
  });

  it('asks the caller to fall back to a whole-file upload on a server without resumable support', async () => {
    const server = fakeServer();
    const deps = { ...server.deps, create: jest.fn(async () => { throw httpError(404); }) };

    await expect(uploadPhotoResumable(7, photo(), 'main', {}, deps)).rejects.toBeInstanceOf(LegacyUploadRequired);
    expect(server.sentChunks).toEqual([]);
  });

  it('treats the disk copy of a shot as the same upload after an app restart', async () => {
    const server = fakeServer();
    const ids: string[] = [];
    const deps = {
      ...server.deps,
      // The real id is a hash of the seed; echoing the seed shows what the id is built from.
      makeClientId: async (seed: string) => { ids.push(seed); return `id-${ids.length}-xxxxxxxx`; },
    };
    // First run: camera cache path. After the restart the same shot lives at another path.
    await uploadPhotoResumable(7, { ...photo(), uploadKey: 'ph-1' }, 'main', {}, deps);
    await uploadPhotoResumable(7, { uri: 'file:///documents/copy.jpg', name: 'a.jpg', mimeType: 'image/jpeg', uploadKey: 'ph-1' }, 'main', {}, deps);

    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).not.toContain('photo-');
    expect(ids[0]).not.toContain('copy.jpg');
  });

  it('reports a finished upload without sending anything again', async () => {
    const server = fakeServer();
    const file = photo();
    await uploadPhotoResumable(7, file, 'main', {}, server.deps);
    server.sentChunks.length = 0;

    await expect(uploadPhotoResumable(7, file, 'main', {}, server.deps)).resolves.toBe(555);
    expect(server.sentChunks).toEqual([]);
    expect(server.completedCount()).toBe(1);
  });
});
