import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDelete, mockGet, mockPost, mockPut } = vi.hoisted(() => ({
  mockDelete: vi.fn(),
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockPut: vi.fn(),
}));

vi.mock('./client', () => ({
  default: {
    get: mockGet,
    post: mockPost,
    put: mockPut,
    delete: mockDelete,
  },
  API_V1_BASE: '/api/v1',
}));

import {
  formatMyFilesUploadLimitLabel,
  myFilesAPI,
  MY_FILES_MAX_UPLOAD_BYTES,
  myFilesRetentionOptions,
} from './myFiles';

describe('myFilesAPI', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPut.mockReset();
    mockDelete.mockReset();
    mockGet.mockResolvedValue({ data: { file_name: 'public.txt' } });
    mockPost.mockImplementation((url) => Promise.resolve({
      data: url.endsWith('/complete')
        ? { id: 'queued-file', status: 'queued' }
        : {
          file_id: 'reserved-file',
          chunk_size_bytes: 8,
          uploaded_bytes: 0,
        },
    }));
    mockPut.mockImplementation((_url, chunk, options) => Promise.resolve({
      data: {
        file_id: 'reserved-file',
        uploaded_bytes: Number(options?.params?.offset || 0) + Number(chunk?.size || 0),
      },
    }));
    mockDelete.mockResolvedValue({ data: null });
  });

  it('uploads a file in parallel chunks and completes the session', async () => {
    const file = new File(['column_a,column_b\n1,2\n'], 'report.csv', { type: 'text/csv' });
    const onUploadProgress = vi.fn();

    await expect(myFilesAPI.uploadFile({
      file,
      retentionDays: 30,
      onUploadProgress,
    })).resolves.toEqual({ id: 'queued-file', status: 'queued' });

    expect(mockPost).toHaveBeenCalledWith(
      '/my-files/upload-sessions',
      {
        file_name: 'report.csv',
        file_size: file.size,
        retention_days: 30,
        mime_type: 'text/csv',
        folder_id: null,
      },
      { signal: undefined },
    );
    expect(mockPut).toHaveBeenCalledTimes(Math.ceil(file.size / 8));
    expect(mockPut.mock.calls.map((call) => call[2].params.offset)).toEqual([0, 8, 16]);
    expect(mockPut.mock.calls[0][2]).toEqual(expect.objectContaining({
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: 300_000,
    }));
    expect(mockPost).toHaveBeenLastCalledWith(
      '/my-files/upload-sessions/reserved-file/complete',
      null,
      { signal: undefined, timeout: 120_000 },
    );
    expect(onUploadProgress).toHaveBeenLastCalledWith({ loaded: file.size, total: file.size });
  });

  it('recovers when a chunk was stored but its response was lost', async () => {
    const file = new File(['retry-safe'], 'retry.bin', { type: 'application/octet-stream' });
    mockPost.mockResolvedValueOnce({
      data: { file_id: 'reserved-file', chunk_size_bytes: 16, uploaded_bytes: 0 },
    });
    mockPut.mockRejectedValueOnce(new Error('network response lost'));
    mockGet.mockResolvedValueOnce({
      data: { file_id: 'reserved-file', uploaded_bytes: file.size },
    });

    await expect(myFilesAPI.uploadFile({ file })).resolves.toEqual({ id: 'queued-file', status: 'queued' });

    expect(mockGet).toHaveBeenCalledWith(
      '/my-files/upload-sessions/reserved-file',
      { signal: undefined },
    );
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('keeps retriable-failure sessions alive for resume instead of cancelling', async () => {
    vi.useFakeTimers();
    const file = new File(['fail-me'], 'fail.bin', { type: 'application/octet-stream' });
    mockPost.mockResolvedValueOnce({
      data: { file_id: 'reserved-file', chunk_size_bytes: 16, uploaded_bytes: 0 },
    });
    const networkError = Object.assign(new Error('timeout of 300000ms exceeded'), {
      response: { status: 504, data: { detail: 'Gateway timeout while writing chunk' } },
    });
    mockPut.mockRejectedValue(networkError);
    mockGet.mockRejectedValue(new Error('session status unavailable'));

    try {
      const pending = myFilesAPI.uploadFile({ file });
      const expectation = expect(pending).rejects.toBe(networkError);
      await vi.runAllTimersAsync();
      await expectation;

      expect(mockPut.mock.calls.length).toBeGreaterThan(1);
      expect(mockDelete).not.toHaveBeenCalled();
      const saved = JSON.parse(window.localStorage.getItem('hubit-my-files-uploads') || '{}');
      const resumeKey = `fail.bin|${file.size}||${file.lastModified}`;
      expect(saved[resumeKey]).toEqual(expect.objectContaining({ fileId: 'reserved-file' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes a persisted session instead of creating a new one', async () => {
    const file = new File(['resume-me'], 'resume.bin', { type: 'application/octet-stream' });
    window.localStorage.setItem('hubit-my-files-uploads', JSON.stringify({
      [`resume.bin|${file.size}||${file.lastModified}`]: { fileId: 'reserved-file', savedAt: Date.now() },
    }));
    mockGet.mockResolvedValueOnce({
      data: { file_id: 'reserved-file', chunk_size_bytes: 8, uploaded_bytes: 0, file_size_bytes: file.size },
    });

    await expect(myFilesAPI.uploadFile({ file })).resolves.toEqual({ id: 'queued-file', status: 'queued' });

    expect(mockPost).not.toHaveBeenCalledWith('/my-files/upload-sessions', expect.anything(), expect.anything());
    expect(mockPut).toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem('hubit-my-files-uploads') || '{}')).toEqual({});
  });

  it('does not retry permanent client errors while still aborting with the real reason', async () => {
    const file = new File(['fail-me'], 'fail.bin', { type: 'application/octet-stream' });
    mockPost.mockResolvedValueOnce({
      data: { file_id: 'reserved-file', chunk_size_bytes: 16, uploaded_bytes: 0 },
    });
    const quotaError = Object.assign(new Error('Request failed with status code 413'), {
      response: { status: 413, data: { detail: 'Quota exceeded' } },
    });
    mockPut.mockRejectedValue(quotaError);

    await expect(myFilesAPI.uploadFile({ file })).rejects.toBe(quotaError);

    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith(
      '/my-files/upload-sessions/reserved-file',
      {
        params: { reason: 'Quota exceeded' },
        signal: undefined,
      },
    );
  });

  it('keeps at most four chunks in flight', async () => {
    const file = new File(['x'.repeat(80)], 'big.bin', { type: 'application/octet-stream' });
    mockPost.mockResolvedValueOnce({
      data: { file_id: 'reserved-file', chunk_size_bytes: 8, uploaded_bytes: 0 },
    });
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers = [];
    mockPut.mockImplementation(() => new Promise((resolve) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      resolvers.push(() => {
        inFlight -= 1;
        resolve({ data: {} });
      });
    }));

    const pending = myFilesAPI.uploadFile({ file });
    for (let guard = 0; guard < 100 && (resolvers.length > 0 || mockPut.mock.calls.length < 10); guard += 1) {
      resolvers.splice(0).forEach((resolve) => resolve());
      await Promise.resolve();
    }
    await pending;

    expect(mockPut).toHaveBeenCalledTimes(10);
    expect(maxInFlight).toBe(4);
    expect(mockPost).toHaveBeenLastCalledWith(
      '/my-files/upload-sessions/reserved-file/complete',
      null,
      { signal: undefined, timeout: 120_000 },
    );
  });

  it('retries a bare HTTP 400 without backend detail', async () => {
    vi.useFakeTimers();
    const file = new File(['fail-me'], 'fail.bin', { type: 'application/octet-stream' });
    mockPost.mockResolvedValueOnce({
      data: { file_id: 'reserved-file', chunk_size_bytes: 16, uploaded_bytes: 0 },
    });
    const droppedBody = Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: {} },
    });
    mockPut.mockRejectedValueOnce(droppedBody);
    mockGet.mockResolvedValue({
      data: { file_id: 'reserved-file', uploaded_bytes: 0, ranges: [] },
    });

    try {
      const pending = myFilesAPI.uploadFile({ file });
      const expectation = expect(pending).resolves.toEqual({ id: 'queued-file', status: 'queued' });
      await vi.runAllTimersAsync();
      await expectation;

      expect(mockPut).toHaveBeenCalledTimes(2);
      expect(mockDelete).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a backend HTTP 400 that carries a detail', async () => {
    const file = new File(['fail-me'], 'fail.bin', { type: 'application/octet-stream' });
    mockPost.mockResolvedValueOnce({
      data: { file_id: 'reserved-file', chunk_size_bytes: 16, uploaded_bytes: 0 },
    });
    const backendError = Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { detail: 'Upload chunk is empty' } },
    });
    mockPut.mockRejectedValue(backendError);
    mockGet.mockResolvedValue({
      data: { file_id: 'reserved-file', uploaded_bytes: 0, ranges: [] },
    });

    await expect(myFilesAPI.uploadFile({ file })).rejects.toBe(backendError);

    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith(
      '/my-files/upload-sessions/reserved-file',
      {
        params: { reason: 'Upload chunk is empty' },
        signal: undefined,
      },
    );
  });

  it('triggers a native download through a temporary anchor', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    try {
      expect(myFilesAPI.triggerNativeDownload('https://example.com/dl')).toBe(true);

      const anchor = appendSpy.mock.calls
        .map(([node]) => node)
        .find((node) => node?.tagName === 'A');
      expect(anchor).toBeTruthy();
      expect(anchor.getAttribute('href')).toBe('https://example.com/dl');
      expect(anchor.getAttribute('download')).toBe('');
      expect(anchor.getAttribute('rel')).toBe('noopener');
      expect(click).toHaveBeenCalledTimes(1);
      expect(anchor.isConnected).toBe(false);
      expect(document.querySelector('iframe')).toBeNull();
    } finally {
      click.mockRestore();
      appendSpy.mockRestore();
    }
  });

  it('offers thirty-day retention', () => {
    expect(myFilesRetentionOptions).toContain(30);
  });

  it('uses the IIS uint32 maximum instead of the former one-gigabyte limit', () => {
    expect(MY_FILES_MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024 * 1024);
    expect(formatMyFilesUploadLimitLabel()).toBe('до 10 ГБ на файл, 50 ГБ всего');
  });

  it('loads a public shared file without triggering the login redirect', async () => {
    await expect(myFilesAPI.getPublicFile('public-token')).resolves.toEqual({ file_name: 'public.txt' });

    expect(mockGet).toHaveBeenCalledWith('/my-files/public/public-token', {
      suppressAuthRequired: true,
    });
  });
});
