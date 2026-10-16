import { describe, expect, it, vi } from 'vitest';

import { createMemoryStore, createPhotoUploadQueue, STATUS } from './photoUploadQueue';

// Очередь — конечный автомат поверх хранилища: поведение при обрыве, перезапуске вкладки и
// возврате связи через интерфейс страницы не воспроизвести, поэтому проверяем её напрямую.

const photo = (name) => new File([name], name, { type: 'image/jpeg', lastModified: 1 });
const networkError = () => Object.assign(new Error('Network Error'), { isAxiosError: true });
const refused = (detail) => ({ response: { status: 400, data: { detail } } });
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

function makeQueue(overrides = {}) {
  const timers = [];
  const queue = createPhotoUploadQueue({
    store: overrides.store || createMemoryStore(),
    upload: overrides.upload || vi.fn().mockResolvedValue({ file_no: 1 }),
    shrink: async (file) => file,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
    onlineNow: () => true,
    ...overrides,
  });
  return { queue, timers };
}

describe('photo upload queue', () => {
  it('sends shots one by one in the order they were taken and announces each one', async () => {
    const upload = vi.fn().mockResolvedValue({ file_no: 7 });
    const { queue } = makeQueue({ upload });
    queue.setUser(15);
    const uploaded = vi.fn();
    queue.onUploaded(uploaded);

    await queue.enqueue({ itemId: 10, dbId: 'main', userId: 15, files: [photo('a.jpg'), photo('b.jpg')] });
    await flush();

    expect(upload.mock.calls.map((call) => call[1].name)).toEqual(['a.jpg', 'b.jpg']);
    expect(upload.mock.calls[0][2].params).toEqual({ db_id: 'main' });
    expect(uploaded).toHaveBeenCalledTimes(2);
    expect(queue.getJobs()).toEqual([]);
  });

  it('keeps a shot that hit a dropped link and retries it on its own after a pause', async () => {
    const upload = vi.fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ file_no: 8 });
    const { queue, timers } = makeQueue({ upload });
    queue.setUser(15);

    await queue.enqueue({ itemId: 10, userId: 15, files: [photo('a.jpg')] });
    await flush();
    expect(queue.getJobs()[0].status).toBe(STATUS.WAITING);
    expect(timers).toHaveLength(1);

    timers[0].fn();
    await flush();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(queue.getJobs()).toEqual([]);
  });

  it('retries at once when the link comes back instead of waiting out the pause', async () => {
    const upload = vi.fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ file_no: 8 });
    const { queue } = makeQueue({ upload });
    queue.setUser(15);
    await queue.enqueue({ itemId: 10, userId: 15, files: [photo('a.jpg')] });
    await flush();

    queue.resume();
    await flush();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(queue.getJobs()).toEqual([]);
  });

  it('does not retry a refusal by itself and does not block the shots behind it', async () => {
    const upload = vi.fn()
      .mockRejectedValueOnce(refused('Файл не принят'))
      .mockResolvedValueOnce({ file_no: 9 });
    const { queue, timers } = makeQueue({ upload });
    queue.setUser(15);

    await queue.enqueue({ itemId: 10, userId: 15, files: [photo('a.jpg'), photo('b.jpg')] });
    await flush();

    const [left] = queue.getJobs();
    expect(left).toMatchObject({ fileName: 'a.jpg', status: STATUS.FAILED, error: 'Файл не принят' });
    expect(timers).toHaveLength(0);
    expect(upload).toHaveBeenCalledTimes(2);

    upload.mockResolvedValueOnce({ file_no: 10 });
    queue.retry(left.id);
    await flush();
    expect(queue.getJobs()).toEqual([]);
  });

  it('picks the unsent shots up after the tab was closed and reopened', async () => {
    const store = createMemoryStore();
    const closedTab = makeQueue({ store, upload: vi.fn().mockRejectedValue(networkError()) });
    closedTab.queue.setUser(15);
    await closedTab.queue.enqueue({ itemId: 10, dbId: 'main', userId: 15, files: [photo('a.jpg')] });
    await flush();

    const upload = vi.fn().mockResolvedValue({ file_no: 11 });
    const reopened = makeQueue({ store, upload });
    reopened.queue.setUser(15);
    await reopened.queue.restore();
    await flush();

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBe(10);
    expect(upload.mock.calls[0][1].name).toBe('a.jpg');
    expect(await store.getAll()).toEqual([]);
  });

  it("never sends another user's shots from a shared browser", async () => {
    const store = createMemoryStore();
    const first = makeQueue({ store, upload: vi.fn().mockRejectedValue(networkError()) });
    first.queue.setUser(15);
    await first.queue.enqueue({ itemId: 10, userId: 15, files: [photo('a.jpg')] });
    await flush();

    const upload = vi.fn().mockResolvedValue({ file_no: 12 });
    const second = makeQueue({ store, upload });
    second.queue.setUser(99);
    await second.queue.restore();
    await flush();

    expect(upload).not.toHaveBeenCalled();
    expect(second.queue.getJobs()).toEqual([]);
    expect(await store.getAll()).toHaveLength(1);
  });

  it('lets the user drop a shot that is not being sent', async () => {
    const store = createMemoryStore();
    const { queue } = makeQueue({ store, upload: vi.fn().mockRejectedValue(refused('нет')) });
    queue.setUser(15);
    await queue.enqueue({ itemId: 10, userId: 15, files: [photo('a.jpg')] });
    await flush();

    await queue.remove(queue.getJobs()[0].id);
    expect(queue.getJobs()).toEqual([]);
    expect(await store.getAll()).toEqual([]);
  });
});
