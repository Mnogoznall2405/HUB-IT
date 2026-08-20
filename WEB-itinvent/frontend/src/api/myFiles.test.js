import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}));

vi.mock('./client', () => ({
  default: {
    get: mockGet,
    post: mockPost,
    delete: vi.fn(),
  },
  API_V1_BASE: '/api/v1',
}));

import { myFilesAPI, myFilesRetentionOptions } from './myFiles';

describe('myFilesAPI', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockGet.mockResolvedValue({ data: { file_name: 'public.txt' } });
    mockPost.mockResolvedValue({ data: { id: 'queued-file' } });
  });

  it('uploads a file as a raw binary body with metadata in query params', async () => {
    const file = new File(['column_a,column_b\n1,2\n'], 'report.csv', { type: 'text/csv' });
    const onUploadProgress = vi.fn();

    await myFilesAPI.uploadFile({
      file,
      retentionDays: 30,
      onUploadProgress,
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/my-files',
      file,
      expect.objectContaining({
        params: {
          file_name: 'report.csv',
          file_size: file.size,
          retention_days: 30,
        },
        headers: {
          'Content-Type': 'text/csv',
        },
        onUploadProgress,
        timeout: 0,
      }),
    );
  });

  it('offers thirty-day retention', () => {
    expect(myFilesRetentionOptions).toContain(30);
  });

  it('loads a public shared file without triggering the login redirect', async () => {
    await expect(myFilesAPI.getPublicFile('public-token')).resolves.toEqual({ file_name: 'public.txt' });

    expect(mockGet).toHaveBeenCalledWith('/my-files/public/public-token', {
      suppressAuthRequired: true,
    });
  });
});
