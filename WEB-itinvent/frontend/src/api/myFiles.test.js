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

  it('uploads a file in sequential chunks and completes the session', async () => {
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
      },
      { signal: undefined },
    );
    expect(mockPut).toHaveBeenCalledTimes(Math.ceil(file.size / 8));
    expect(mockPut.mock.calls.map((call) => call[2].params.offset)).toEqual([0, 8, 16]);
    expect(mockPut.mock.calls[0][2]).toEqual(expect.objectContaining({
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: 115_000,
    }));
    expect(mockPost).toHaveBeenLastCalledWith(
      '/my-files/upload-sessions/reserved-file/complete',
      null,
      { signal: undefined },
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

  it('offers thirty-day retention', () => {
    expect(myFilesRetentionOptions).toContain(30);
  });

  it('uses the IIS uint32 maximum instead of the former one-gigabyte limit', () => {
    expect(MY_FILES_MAX_UPLOAD_BYTES).toBe((2 ** 32) - 1);
    expect(formatMyFilesUploadLimitLabel()).toBe('до 4 ГБ на файл, 5 ГБ всего');
  });

  it('loads a public shared file without triggering the login redirect', async () => {
    await expect(myFilesAPI.getPublicFile('public-token')).resolves.toEqual({ file_name: 'public.txt' });

    expect(mockGet).toHaveBeenCalledWith('/my-files/public/public-token', {
      suppressAuthRequired: true,
    });
  });
});
