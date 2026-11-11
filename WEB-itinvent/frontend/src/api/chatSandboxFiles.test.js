import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { post, buildUrl } = vi.hoisted(() => ({ post: vi.fn(), buildUrl: vi.fn() }));
vi.mock('./client', () => ({ default: { post } }));
vi.mock('./myFiles', () => ({ myFilesAPI: { buildDownloadGrantUrl: buildUrl } }));
import { loadSandboxInputFile, SANDBOX_INPUT_MAX_BYTES } from './chatSandboxFiles';
const item = { id: 'owned-file', status: 'ready', original_size_bytes: 3, download_file_name: 'report.txt' };
describe('OpenCode storage input', () => {
  beforeEach(() => {
    post.mockResolvedValue({ data: { download_path: '/my-files/download-grant/one-time' } });
    buildUrl.mockReturnValue('/api/v1/my-files/download-grant/one-time');
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());
  it('uses an owner grant and returns a draft File without sending a message', async () => {
    const reader = { read: vi.fn().mockResolvedValueOnce({ value: new Uint8Array([1, 2, 3]) }).mockResolvedValueOnce({ done: true }), cancel: vi.fn().mockResolvedValue(), releaseLock: vi.fn() };
    fetch.mockResolvedValue({ ok: true, body: { getReader: () => reader } });
    const file = await loadSandboxInputFile(item);
    expect(file.name).toBe('report.txt');
    expect(file.size).toBe(3);
    expect(post).toHaveBeenLastCalledWith('/my-files/owned-file/download-grant', null, { signal: undefined });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/my-files/download-grant/one-time'), expect.objectContaining({ redirect: 'error', cache: 'no-store' }));
  });
  it('rejects unready files and external grant targets', async () => {
    await expect(loadSandboxInputFile({ ...item, status: 'processing' })).rejects.toThrow('не готов');
    buildUrl.mockReturnValue('https://external.invalid/my-files/download-grant/token');
    await expect(loadSandboxInputFile(item)).rejects.toThrow('адрес');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('enforces the streamed size even if metadata understates it', async () => {
    const reader = { read: vi.fn().mockResolvedValue({ value: { byteLength: SANDBOX_INPUT_MAX_BYTES + 1 } }), cancel: vi.fn().mockResolvedValue(), releaseLock: vi.fn() };
    fetch.mockResolvedValue({ ok: true, body: { getReader: () => reader } });
    await expect(loadSandboxInputFile(item)).rejects.toThrow('256');
    expect(reader.cancel).toHaveBeenCalled();
  });
});
