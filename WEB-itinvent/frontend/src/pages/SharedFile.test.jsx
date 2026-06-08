import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const futureExpiresAt = () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();

describe('SharedFile page', () => {
  beforeEach(() => {
    mockGetPublicFile.mockReset();
    mockGetPublicPreviewMeta.mockReset();
    mockDownloadPublicFile.mockReset();
    mockBuildPublicDownloadUrl.mockReset();
    mockBuildPublicPreviewContentUrl.mockReset();
    mockGetPublicFile.mockResolvedValue({
      file_name: 'public.txt',
      size_bytes: 11,
      mime_type: 'text/plain',
      expires_at: futureExpiresAt(),
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
    vi.restoreAllMocks();
  });

  it('loads public file metadata without auth context', async () => {
    renderPublicPage();

    expect(await screen.findByText('public.txt')).toBeInTheDocument();
    expect(mockGetPublicFile).toHaveBeenCalledWith('public-token');
  });

  it('shows expiration countdown timer', async () => {
    renderPublicPage();

    expect(await screen.findByText(/Доступно ещё/)).toBeInTheDocument();
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

  it('shows office teaser first and loads pdf preview only after clicking view', async () => {
    mockGetPublicPreviewMeta.mockResolvedValue({
      preview_kind: 'office_pdf',
      source_kind: 'word',
      source_filename: 'report.docx',
      pdf_filename: 'report.pdf',
      page_count: 2,
      sheets: [],
      preview_url: '/api/v1/my-files/public/public-token/preview/content',
    });
    mockGetPublicFile.mockResolvedValue({
      file_name: 'report.docx',
      size_bytes: 2048,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      expires_at: futureExpiresAt(),
      preview_kind: 'office_pdf',
      preview_available: true,
      preview_max_bytes: 26214400,
    });

    renderPublicPage();

    expect(await screen.findByText('report.docx')).toBeInTheDocument();
    expect(screen.getByText(/наведите курсор и нажмите «просмотреть»/i)).toBeInTheDocument();
    expect(mockGetPublicPreviewMeta).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pdf-preview')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /просмотреть/i }));

    await waitFor(() => expect(mockGetPublicPreviewMeta).toHaveBeenCalledWith('public-token'));
    expect(await screen.findByTestId('pdf-preview')).toHaveTextContent(
      'report.docx:/api/v1/my-files/public/public-token/preview/content',
    );
  });

  it('keeps shared download usable when full preview rendering fails', async () => {
    mockGetPublicFile.mockResolvedValue({
      file_name: 'table.xlsx',
      size_bytes: 2048,
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      expires_at: futureExpiresAt(),
      preview_kind: 'office_pdf',
      preview_available: true,
      preview_max_bytes: 26214400,
    });
    mockGetPublicPreviewMeta.mockRejectedValue({
      response: { status: 500, data: { detail: 'My files request failed' } },
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('download failed')));

    renderPublicPage();

    expect(await screen.findByText('table.xlsx')).toBeInTheDocument();
    expect(mockGetPublicPreviewMeta).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /Скачать/ })).toHaveAttribute(
      'href',
      '/api/v1/my-files/public/public-token/download',
    );

    fireEvent.click(screen.getByRole('button', { name: /просмотреть/i }));

    expect(await screen.findByTestId('shared-file-fallback')).toHaveTextContent(
      'Предпросмотр не удалось подготовить',
    );
  });
});
