import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetPublicFile,
  mockGetPublicPreviewMeta,
  mockDownloadPublicFile,
  mockBuildPublicDownloadUrl,
  mockBuildPublicPreviewContentUrl,
} = vi.hoisted(() => ({
  mockGetPublicFile: vi.fn(),
  mockGetPublicPreviewMeta: vi.fn(),
  mockDownloadPublicFile: vi.fn(),
  mockBuildPublicDownloadUrl: vi.fn(),
  mockBuildPublicPreviewContentUrl: vi.fn(),
}));

vi.mock('../api/myFiles', () => ({
  myFilesAPI: {
    getPublicFile: mockGetPublicFile,
    getPublicPreviewMeta: mockGetPublicPreviewMeta,
    downloadPublicFile: mockDownloadPublicFile,
    buildPublicDownloadUrl: mockBuildPublicDownloadUrl,
    buildPublicPreviewContentUrl: mockBuildPublicPreviewContentUrl,
  },
}));

vi.mock('../components/mail/MailPdfPreviewSurface', () => ({
  default: ({ objectUrl, filename }) => (
    <div data-testid="pdf-preview">{filename}:{objectUrl}</div>
  ),
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T10:00:00+00:00'));
    mockGetPublicFile.mockReset();
    mockGetPublicPreviewMeta.mockReset();
    mockDownloadPublicFile.mockReset();
    mockBuildPublicDownloadUrl.mockReset();
    mockBuildPublicPreviewContentUrl.mockReset();
    mockGetPublicFile.mockResolvedValue({
      file_name: 'public.txt',
      size_bytes: 11,
      mime_type: 'text/plain',
      expires_at: '2026-06-13T10:00:00+00:00',
      preview_kind: 'unsupported',
      preview_available: false,
      preview_max_bytes: 26214400,
    });
    mockGetPublicPreviewMeta.mockResolvedValue({
      preview_kind: 'office_pdf',
      source_kind: 'word',
      source_filename: 'public.docx',
      pdf_filename: 'public.pdf',
      page_count: 2,
      sheets: [],
      preview_url: '/api/v1/my-files/public/public-token/preview/content',
    });
    mockDownloadPublicFile.mockResolvedValue(new Blob(['hello world'], { type: 'text/plain' }));
    mockBuildPublicDownloadUrl.mockReturnValue('/api/v1/my-files/public/public-token/download');
    mockBuildPublicPreviewContentUrl.mockReturnValue('/api/v1/my-files/public/public-token/preview/content');
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads public file metadata without auth context', async () => {
    renderPublicPage();

    expect(await screen.findByText('public.txt')).toBeInTheDocument();
    expect(mockGetPublicFile).toHaveBeenCalledWith('public-token');
  });

  it('shows expiration countdown timer', async () => {
    renderPublicPage();

    expect(await screen.findByText(/Доступно ещё 5 д\./)).toBeInTheDocument();
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

  it('loads office preview metadata and renders pdf preview surface', async () => {
    mockGetPublicFile.mockResolvedValue({
      file_name: 'report.docx',
      size_bytes: 2048,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      expires_at: '2026-06-13T10:00:00+00:00',
      preview_kind: 'office_pdf',
      preview_available: true,
      preview_max_bytes: 26214400,
    });

    renderPublicPage();

    expect(await screen.findByText('report.docx')).toBeInTheDocument();
    expect(mockGetPublicPreviewMeta).toHaveBeenCalledWith('public-token');
    expect(await screen.findByTestId('pdf-preview')).toHaveTextContent(
      'report.docx:/api/v1/my-files/public/public-token/preview/content',
    );
  });
});
