import { describe, expect, it, vi } from 'vitest';

import { LegacyUploadRequired, RETRY_DELAYS_MS, uploadPhotoResumable } from './resumablePhotoUpload';

const CHUNK = 4;
const SIZE = 10; // 3 куска: 4 + 4 + 2

const networkError = () => Object.assign(new Error('Network Error'), { isAxiosError: true });
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

// Минимальный «сервер»: помнит принятые куски между вызовами, как настоящий.
function fakeServer() {
  const received = new Set();
  const sentChunks = [];
  const createdIds = [];
  let completed = 0;
  const failures = [];
  const maybeFail = () => {
    const error = failures.shift()?.();
    if (error) throw error;
  };
  const state = () => ({
    upload_id: 'u1',
    status: completed ? 'complete' : 'uploading',
    size: SIZE,
    chunk_size: CHUNK,
    total_chunks: 3,
    received: [...received].sort(),
    file_no: completed ? 555 : null,
  });
  const api = {
    create: vi.fn(async (_itemId, payload) => { createdIds.push(payload.client_id); return state(); }),
    putChunk: vi.fn(async (_id, index) => { maybeFail(); received.add(index); sentChunks.push(index); return state(); }),
    complete: vi.fn(async () => {
      maybeFail();
      completed += 1;
      return { file_no: 555, item_id: 7, file_name: 'a.jpg' };
    }),
  };
  const deps = {
    api,
    shrink: async (file) => file,
    sleep: vi.fn(async () => undefined),
    waitOnline: async () => undefined,
  };
  return { deps, failures, sentChunks, received, createdIds, completedCount: () => completed };
}

let counter = 0;
const photo = () => {
  counter += 1;
  return new File([new Uint8Array(SIZE)], `photo-${counter}.jpg`, { type: 'image/jpeg', lastModified: 1_700_000_000_000 + counter });
};

describe('uploadPhotoResumable', () => {
  it('survives a dropped connection mid-upload without resending accepted chunks', async () => {
    const server = fakeServer();
    server.failures.push(() => null, () => networkError(), () => networkError());

    const result = await uploadPhotoResumable(7, photo(), { dbId: 'main' }, server.deps);

    expect(result.file_no).toBe(555);
    expect(server.sentChunks).toEqual([0, 1, 2]);
    expect(server.completedCount()).toBe(1);
    expect(server.deps.sleep).toHaveBeenCalledTimes(2);
  });

  it('after giving up, selecting the same file again sends only what the server lacks', async () => {
    const server = fakeServer();
    const file = photo();
    server.failures.push(() => null, ...RETRY_DELAYS_MS.map(() => () => networkError()), () => networkError());

    await expect(uploadPhotoResumable(7, file, {}, server.deps)).rejects.toThrow('Network Error');
    expect([...server.received]).toEqual([0]);

    server.failures.length = 0;
    const result = await uploadPhotoResumable(7, file, {}, server.deps);
    expect(result.file_no).toBe(555);
    expect(server.sentChunks).toEqual([0, 1, 2]); // chunk 0 left the browser exactly once
    expect(server.createdIds[0]).toBe(server.createdIds[1]); // same file → same upload session
    expect(server.completedCount()).toBe(1);
  });

  it('does not retry a permanent rejection', async () => {
    const server = fakeServer();
    server.failures.push(() => httpError(400));

    await expect(uploadPhotoResumable(7, photo(), {}, server.deps)).rejects.toMatchObject({ response: { status: 400 } });
    expect(server.deps.sleep).not.toHaveBeenCalled();
    expect(server.completedCount()).toBe(0);
  });

  it('retries while the server is still assembling (409) and finishes once', async () => {
    const server = fakeServer();
    server.failures.push(() => null, () => null, () => null, () => httpError(409));

    const result = await uploadPhotoResumable(7, photo(), {}, server.deps);
    expect(result.file_no).toBe(555);
    expect(server.completedCount()).toBe(1);
  });

  it('asks for a new upload id when the server says this id belongs to a differently sized file', async () => {
    const server = fakeServer();
    server.deps.api.create
      .mockRejectedValueOnce(httpError(409));

    const result = await uploadPhotoResumable(7, photo(), {}, server.deps);
    expect(result.file_no).toBe(555);
    const ids = server.deps.api.create.mock.calls.map((call) => call[1].client_id);
    expect(ids[1]).toBe(`${ids[0]}-r1`);
  });

  it('signals a whole-file fallback for a server without resumable support', async () => {
    const server = fakeServer();
    server.deps.api.create.mockRejectedValueOnce(httpError(404));

    await expect(uploadPhotoResumable(7, photo(), {}, server.deps)).rejects.toBeInstanceOf(LegacyUploadRequired);
    expect(server.sentChunks).toEqual([]);
  });
});
