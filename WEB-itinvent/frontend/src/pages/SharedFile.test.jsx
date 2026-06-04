import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetPublicFile,
  mockDownloadPublicFile,
  mockBuildPublicDownloadUrl,
} = vi.hoisted(() => ({
  mockGetPublicFile: vi.fn(),
  mockDownloadPublicFile: vi.fn(),
  mockBuildPublicDownloadUrl: vi.fn(),
}));

vi.mock('../api/myFiles', () => ({
  myFilesAPI: {
    getPublicFile: mockGetPublicFile,
    downloadPublicFile: mockDownloadPublicFile,
    buildPublicDownloadUrl: mockBuildPublicDownloadUrl,
  },
}));

import SharedFile from './SharedFile';

function renderPublicPage(token = 'public-token') {
  return render(
    <MemoryRouter initialEntries={[`/shared-files/${token}`]}>
      <Routes>
        <Route path="/shared-files/:token" element={<SharedFile />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SharedFile page', () => {
  beforeEach(() => {
    mockGetPublicFile.mockReset();
    mockDownloadPublicFile.mockReset();
    mockBuildPublicDownloadUrl.mockReset();
    mockGetPublicFile.mockResolvedValue({
      file_name: 'public.txt',
      size_bytes: 11,
      mime_type: 'text/plain',
      expires_at: '2026-06-13T10:00:00+00:00',
    });
    mockDownloadPublicFile.mockResolvedValue(new Blob(['hello world'], { type: 'text/plain' }));
    mockBuildPublicDownloadUrl.mockReturnValue('/api/v1/my-files/public/public-token/download');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:public-file'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads public file metadata without auth context', async () => {
    renderPublicPage();

    expect(await screen.findByText('public.txt')).toBeInTheDocument();
    expect(mockGetPublicFile).toHaveBeenCalledWith('public-token');
  });

  it('shows rate-limit message when metadata request returns 429', async () => {
    mockGetPublicFile.mockRejectedValue({ response: { status: 429 } });
    renderPublicPage();

    expect(await screen.findByText(/Слишком много запросов/i)).toBeInTheDocument();
  });

  it('uses a direct browser download without loading the file through XHR', async () => {
    renderPublicPage();

    await screen.findByText('public.txt');
    const link = screen.getByRole('link', { name: /Скачать/ });

    expect(link).toHaveAttribute('href', '/api/v1/my-files/public/public-token/download');
    expect(mockBuildPublicDownloadUrl).toHaveBeenCalledWith('public-token');
    expect(mockDownloadPublicFile).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
