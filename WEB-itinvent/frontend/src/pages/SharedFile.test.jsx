import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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

const { mockGetPublicAccess } = vi.hoisted(() => ({ mockGetPublicAccess: vi.fn() }));

vi.mock('../api/myFilesOffice', () => ({
  myFilesOfficeAPI: { getPublicAccess: mockGetPublicAccess },
}));

vi.mock('../components/mail/MailPdfPreviewSurface', () => ({
  default: ({ objectUrl, filename }) => (
    <div data-testid="pdf-preview">{filename}:{objectUrl}</div>
  ),
}));

vi.mock('../components/documentPreview/DocumentPreviewDialog', () => ({
  default: ({
    open,
    title,
    kind,
    objectUrl,
    error,
    onClose,
  }) => (
    open ? (
      <div data-testid="document-preview-dialog">
        <button type="button" onClick={onClose}>close-preview</button>
        {title}:{kind}:{objectUrl}
        {error ? <div data-testid="document-preview-error">{error}</div> : null}
      </div>
    ) : null
  ),
}));

vi.mock('../lib/excelPreview', () => ({ parseExcelWorkbookFromBlob: vi.fn().mockResolvedValue({ sheets: [{ name: 'S1', rows: [] }] }) }));

import SharedFile from './SharedFile';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderPublicPage(token = 'public-token') {
  return render(
    <MemoryRouter initialEntries={[`/shared-files/${token}`]}>
      <Routes>
        <Route path="/shared-files/:token" element={<SharedFile />} />
        <Route path="/my-files" element={<LocationProbe />} />
        <Route path="/login" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const futureExpiresAt = () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();

describe('SharedFile page', () => {
  it('explains a temporary outage and retries without treating the link as expired', async () => {
    mockGetPublicFile.mockRejectedValueOnce({ response: { status: 503 } });
    renderPublicPage();
    expect(await screen.findByText('Не удалось связаться с сервером. Повторите загрузку через некоторое время.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
    await waitFor(() => expect(mockGetPublicFile).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('public.txt')).toBeInTheDocument();
  });
  beforeEach(() => {
    mockGetPublicAccess.mockReset();
    mockGetPublicAccess.mockResolvedValue({ signed_in: false, editable: false, collaborative: false, can_open: false, role: '', file_id: '' });
    window.sessionStorage.clear();
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

  it('lets a signed-in collaborator open the same link in the editor', async () => {
    mockGetPublicAccess.mockResolvedValue({ signed_in: true, editable: true, collaborative: true, can_open: true, role: 'comment', file_id: 'file-9' });
    renderPublicPage();

    expect(await screen.findByRole('link', { name: 'Скачать' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Комментировать' }));

    expect(await screen.findByTestId('location')).toHaveTextContent('/my-files?edit=file-9');
  });

  it('asks a guest to sign in before editing and returns to the same link afterwards', async () => {
    mockGetPublicAccess.mockResolvedValue({ signed_in: false, editable: true, collaborative: true, can_open: false, role: '', file_id: '' });
    renderPublicPage('guest-token');

    fireEvent.click(await screen.findByTestId('shared-file-login-to-edit'));

    expect(await screen.findByTestId('location')).toHaveTextContent('/login');
    expect(window.sessionStorage.getItem('hubit.auth.return-to')).toBe('/shared-files/guest-token');
  });

  it('keeps a plain link download-only for everybody else', async () => {
    mockGetPublicAccess.mockResolvedValue({ signed_in: true, editable: true, collaborative: true, can_open: false, role: '', file_id: '' });
    renderPublicPage();

    expect(await screen.findByRole('link', { name: 'Скачать' })).toBeInTheDocument();
    await waitFor(() => expect(mockGetPublicAccess).toHaveBeenCalledWith('public-token', expect.anything()));
    expect(screen.queryByTestId('shared-file-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('shared-file-login-to-edit')).not.toBeInTheDocument();
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
    expect(screen.getByText(/нажмите «просмотреть», чтобы открыть файл/i)).toBeInTheDocument();
    expect(mockGetPublicPreviewMeta).not.toHaveBeenCalled();
    expect(screen.queryByTestId('document-preview-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /просмотреть/i }));

    await waitFor(() => expect(mockGetPublicPreviewMeta).toHaveBeenCalledWith('public-token'));
    expect(await screen.findByTestId('document-preview-dialog')).toHaveTextContent(
      'report.docx:office_pdf:/api/v1/my-files/public/public-token/preview/content',
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

    expect(await screen.findByTestId('document-preview-error')).toHaveTextContent(
      'Предпросмотр не удалось подготовить',
    );
  });

  it('does not download the Excel workbook again after the full preview is closed', async () => {
    mockGetPublicFile.mockResolvedValue({
      file_name: 'table.xlsx',
      size_bytes: 2048,
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      expires_at: futureExpiresAt(),
      preview_kind: 'office_pdf',
      preview_available: true,
      preview_max_bytes: 26214400,
    });
    mockGetPublicPreviewMeta.mockResolvedValue({
      preview_kind: 'office_pdf', source_kind: 'excel', source_filename: 'table.xlsx', pdf_filename: 'table.pdf',
      page_count: 1, sheets: [], preview_url: '/preview',
    });
    mockBuildPublicDownloadUrl.mockReturnValue('/api/v1/my-files/public/public-token/download');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) });
    vi.stubGlobal('fetch', fetchMock);

    renderPublicPage();
    expect(await screen.findByText('table.xlsx')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole('button', { name: /просмотреть/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'close-preview' }));
    await waitFor(() => expect(screen.queryByTestId('document-preview-dialog')).not.toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
