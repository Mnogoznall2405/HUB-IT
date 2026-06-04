import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListFiles,
  mockGetQuota,
  mockUploadFile,
  mockDownloadFile,
  mockCreateDownloadGrant,
  mockBuildDownloadGrantUrl,
  mockTriggerNativeDownload,
  mockCreateShare,
  mockRevokeShare,
  mockDeleteFile,
  mockBuildPublicUrl,
  mockNotifySuccess,
  mockNotifyWarning,
  mockNotifyApiError,
} = vi.hoisted(() => ({
  mockListFiles: vi.fn(),
  mockGetQuota: vi.fn(),
  mockUploadFile: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockCreateDownloadGrant: vi.fn(),
  mockBuildDownloadGrantUrl: vi.fn(),
  mockTriggerNativeDownload: vi.fn(),
  mockCreateShare: vi.fn(),
  mockRevokeShare: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockBuildPublicUrl: vi.fn(),
  mockNotifySuccess: vi.fn(),
  mockNotifyWarning: vi.fn(),
  mockNotifyApiError: vi.fn(),
}));

vi.mock('../api/myFiles', () => ({
  myFilesRetentionOptions: [1, 3, 7, 10, 30],
  MY_FILES_MAX_UPLOAD_BYTES: 1024 * 1024 * 1024,
  formatMyFilesUploadLimitLabel: () => '1 ГБ на файл, 5 ГБ всего',
  myFilesAPI: {
    listFiles: mockListFiles,
    getQuota: mockGetQuota,
    uploadFile: mockUploadFile,
    downloadFile: mockDownloadFile,
    createDownloadGrant: mockCreateDownloadGrant,
    buildDownloadGrantUrl: mockBuildDownloadGrantUrl,
    triggerNativeDownload: mockTriggerNativeDownload,
    createShare: mockCreateShare,
    revokeShare: mockRevokeShare,
    deleteFile: mockDeleteFile,
    buildPublicUrl: mockBuildPublicUrl,
  },
}));

vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifySuccess: mockNotifySuccess,
    notifyWarning: mockNotifyWarning,
    notifyApiError: mockNotifyApiError,
  }),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: () => true,
  }),
}));

const theme = createTheme();

const readyFile = {
  id: 'file-1',
  original_file_name: 'report.txt',
  download_file_name: 'report.txt',
  mime_type: 'text/plain',
  download_mime_type: 'text/plain',
  original_size_bytes: 1200,
  stored_size_bytes: 900,
  saved_size_bytes: 300,
  retention_days: 10,
  status: 'ready',
  storage_mode: 'stored',
  error_text: '',
  is_shared: false,
  created_at: '2026-06-03T09:00:00+00:00',
  updated_at: '2026-06-03T09:00:00+00:00',
  expires_at: '2026-06-13T09:00:00+00:00',
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <MyFiles />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

import MyFiles from './MyFiles';

describe('MyFiles page', () => {
  beforeEach(() => {
    mockListFiles.mockReset();
    mockGetQuota.mockReset();
    mockUploadFile.mockReset();
    mockDownloadFile.mockReset();
    mockCreateDownloadGrant.mockReset();
    mockBuildDownloadGrantUrl.mockReset();
    mockTriggerNativeDownload.mockReset();
    mockCreateShare.mockReset();
    mockRevokeShare.mockReset();
    mockDeleteFile.mockReset();
    mockBuildPublicUrl.mockReset();
    mockNotifySuccess.mockReset();
    mockNotifyWarning.mockReset();
    mockNotifyApiError.mockReset();
    mockListFiles.mockResolvedValue({ items: [] });
    mockGetQuota.mockResolvedValue({ used_bytes: 0, limit_bytes: 5 * 1024 * 1024 * 1024, remaining_bytes: 5 * 1024 * 1024 * 1024 });
    mockUploadFile.mockResolvedValue({ id: 'queued-file', status: 'queued' });
    mockCreateDownloadGrant.mockResolvedValue({
      download_path: '/my-files/download-grant/test-token',
      expires_in_seconds: 120,
    });
    mockBuildDownloadGrantUrl.mockReturnValue('http://localhost/api/v1/my-files/download-grant/test-token');
    mockTriggerNativeDownload.mockReturnValue(true);
    mockCreateShare.mockResolvedValue({ token: 'public-token', expires_at: readyFile.expires_at });
    mockBuildPublicUrl.mockReturnValue('http://localhost/shared-files/public-token');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('shows retention notice and uploads with default one-day retention', async () => {
    renderPage();

    await screen.findByText('Мои файлы');
    expect(screen.getByText(/Файлы хранятся в системе до 30 дней/)).toBeInTheDocument();

    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('my-files-input'), { target: { files: [file] } });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('hello.txt')).toBeInTheDocument();
    expect(within(dialog).getByText(/Файлы будут удалены по окончании выбранного срока хранения/)).toBeInTheDocument();
    expect(mockUploadFile).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }));

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(expect.objectContaining({
        file,
        retentionDays: 1,
        onUploadProgress: expect.any(Function),
      }));
    });
  });

  it('creates and displays a public share link for a ready file', async () => {
    mockListFiles.mockResolvedValue({ items: [readyFile] });

    renderPage();

    await screen.findByText('report.txt');
    expect(screen.getByTestId('my-files-card-file-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('my-files-share-file-1'));

    await waitFor(() => expect(mockCreateShare).toHaveBeenCalledWith('file-1', { rotate: false }));
    expect(mockBuildPublicUrl).toHaveBeenCalledWith('public-token');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost/shared-files/public-token');
    expect(await screen.findByTestId('my-files-share-url')).toHaveTextContent('http://localhost/shared-files/public-token');
    expect(screen.getByTestId('my-files-share-copied-alert')).toBeInTheDocument();
  });
});
