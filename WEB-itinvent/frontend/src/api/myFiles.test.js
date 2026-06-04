import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPost } = vi.hoisted(() => ({
  mockPost: vi.fn(),
}));

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: mockPost,
    delete: vi.fn(),
  },
  API_V1_BASE: '/api/v1',
}));

import { myFilesAPI, myFilesRetentionOptions } from './myFiles';

describe('myFilesAPI', () => {
  beforeEach(() => {
    mockPost.mockReset();
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
});
