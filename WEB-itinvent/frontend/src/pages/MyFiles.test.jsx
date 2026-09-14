import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListFiles,
  mockListFolders,
  mockCreateFolder,
  mockUpdateFolder,
  mockDeleteFolder,
  mockUpdateFile,
  mockGetQuota,
  mockUploadFile,
  mockDownloadFile,
  mockCreateDownloadGrant,
  mockBuildDownloadGrantUrl,
  mockTriggerNativeDownload,
  mockGetPreviewMeta,
  mockDownloadPreviewContent,
  mockDownloadPreviewSource,
  mockCreateShare,
  mockRevokeShare,
  mockDeleteFile,
  mockBuildPublicUrl,
  mockListTrash,
  mockRestoreFile,
  mockRestoreFolder,
  mockPurgeFile,
  mockPurgeFolder,
  mockEmptyTrash,
  mockNotifySuccess,
  mockNotifyWarning,
  mockNotifyApiError,
  mockPackFolderFilesToZip,
  mockCollectDataTransferFiles,
} = vi.hoisted(() => ({
  mockListFiles: vi.fn(),
  mockListFolders: vi.fn(),
  mockCreateFolder: vi.fn(),
  mockUpdateFolder: vi.fn(),
  mockDeleteFolder: vi.fn(),
  mockUpdateFile: vi.fn(),
  mockGetQuota: vi.fn(),
  mockUploadFile: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockCreateDownloadGrant: vi.fn(),
  mockBuildDownloadGrantUrl: vi.fn(),
  mockTriggerNativeDownload: vi.fn(),
  mockGetPreviewMeta: vi.fn(),
  mockDownloadPreviewContent: vi.fn(),
  mockDownloadPreviewSource: vi.fn(),
  mockCreateShare: vi.fn(),
  mockRevokeShare: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockBuildPublicUrl: vi.fn(),
  mockListTrash: vi.fn(),
  mockRestoreFile: vi.fn(),
  mockRestoreFolder: vi.fn(),
  mockPurgeFile: vi.fn(),
  mockPurgeFolder: vi.fn(),
  mockEmptyTrash: vi.fn(),
  mockNotifySuccess: vi.fn(),
  mockNotifyWarning: vi.fn(),
  mockNotifyApiError: vi.fn(),
  mockPackFolderFilesToZip: vi.fn(),
  mockCollectDataTransferFiles: vi.fn(),
}));

vi.mock('../lib/myFilesFolderZip', async () => {
  const actual = await vi.importActual('../lib/myFilesFolderZip');
  return {
    ...actual,
    packFolderFilesToZip: mockPackFolderFilesToZip,
    collectDataTransferFiles: mockCollectDataTransferFiles,
  };
});

vi.mock('../api/myFiles', () => ({
  myFilesRetentionOptions: [1, 3, 7, 10, 30],
  MY_FILES_MAX_UPLOAD_BYTES: 10 * 1024 * 1024 * 1024,
  formatMyFilesUploadLimitLabel: () => 'до 10 ГБ на файл, 50 ГБ всего',
  myFilesAPI: {
    listFiles: mockListFiles,
    listFolders: mockListFolders,
    createFolder: mockCreateFolder,
    updateFolder: mockUpdateFolder,
    deleteFolder: mockDeleteFolder,
    updateFile: mockUpdateFile,
    getQuota: mockGetQuota,
    uploadFile: mockUploadFile,
    downloadFile: mockDownloadFile,
    createDownloadGrant: mockCreateDownloadGrant,
    buildDownloadGrantUrl: mockBuildDownloadGrantUrl,
    triggerNativeDownload: mockTriggerNativeDownload,
    getPreviewMeta: mockGetPreviewMeta,
    downloadPreviewContent: mockDownloadPreviewContent,
    downloadPreviewSource: mockDownloadPreviewSource,
    createShare: mockCreateShare,
    revokeShare: mockRevokeShare,
    deleteFile: mockDeleteFile,
    buildPublicUrl: mockBuildPublicUrl,
    listTrash: mockListTrash,
    restoreFile: mockRestoreFile,
    restoreFolder: mockRestoreFolder,
    purgeFile: mockPurgeFile,
    purgeFolder: mockPurgeFolder,
    emptyTrash: mockEmptyTrash,
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

vi.mock('../components/documentPreview/DocumentPreviewDialog', () => ({
  default: ({ open, title, kind, onClose }) => (
    open ? <div data-testid="document-preview-dialog">{title}:{kind}<button onClick={onClose}>Close preview</button></div> : null
  ),
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
  it('does not start another polling request while the previous one is pending', async () => {
    const intervalSpy = vi.spyOn(window, 'setInterval');
    try {
      mockListFiles.mockResolvedValue({ items: [{ ...readyFile, status: 'processing' }] });
      renderPage();
      await screen.findByText('report.txt');
      await waitFor(() => expect(intervalSpy.mock.calls.some((call) => call[1] === 4000)).toBe(true));
      const poll = intervalSpy.mock.calls.find((call) => call[1] === 4000)[0];
      let finish;
      mockListFiles.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      act(() => { poll(); poll(); });
      expect(mockListFiles).toHaveBeenCalledTimes(2);
      await act(async () => finish({ items: [readyFile] }));
    } finally {
      intervalSpy.mockRestore();
    }
  });
  it('does not reopen a closed preview after its download finishes', async () => {
    let resolveDownload;
    mockDownloadPreviewContent.mockImplementationOnce(() => new Promise((resolve) => { resolveDownload = resolve; }));
    mockListFiles.mockResolvedValue({ items: [{ ...readyFile, id: 'pdf-1', download_file_name: 'report.pdf',
      mime_type: 'application/pdf', download_mime_type: 'application/pdf', preview_kind: 'pdf', preview_available: true, preview_status: 'ready' }] });
    renderPage();
    fireEvent.click(await screen.findByTestId('my-files-preview-pdf-1'));
    await waitFor(() => expect(resolveDownload).toBeTypeOf('function'));
    fireEvent.click(screen.getByText('Close preview'));
    await act(async () => resolveDownload({ data: new Blob(['pdf'], { type: 'application/pdf' }), headers: {} }));
    expect(screen.queryByTestId('document-preview-dialog')).not.toBeInTheDocument();
  });
  beforeEach(() => {
    mockListFiles.mockReset();
    mockGetQuota.mockReset();
    mockUploadFile.mockReset();
    mockDownloadFile.mockReset();
    mockCreateDownloadGrant.mockReset();
    mockBuildDownloadGrantUrl.mockReset();
    mockTriggerNativeDownload.mockReset();
    mockGetPreviewMeta.mockReset();
    mockDownloadPreviewContent.mockReset();
    mockDownloadPreviewSource.mockReset();
    mockCreateShare.mockReset();
    mockRevokeShare.mockReset();
    mockDeleteFile.mockReset();
    mockBuildPublicUrl.mockReset();
    mockNotifySuccess.mockReset();
    mockNotifyWarning.mockReset();
    mockNotifyApiError.mockReset();
    mockPackFolderFilesToZip.mockReset();
    mockCollectDataTransferFiles.mockReset();
    mockListFolders.mockReset();
    mockCreateFolder.mockReset();
    mockUpdateFolder.mockReset();
    mockDeleteFolder.mockReset();
    mockUpdateFile.mockReset();
    mockListTrash.mockReset();
    mockRestoreFile.mockReset();
    mockRestoreFolder.mockReset();
    mockPurgeFile.mockReset();
    mockPurgeFolder.mockReset();
    mockEmptyTrash.mockReset();
    mockListTrash.mockResolvedValue({ items: [], folders: [] });
    mockListFiles.mockResolvedValue({ items: [] });
    mockListFolders.mockResolvedValue({ items: [] });
    mockGetQuota.mockResolvedValue({ used_bytes: 0, limit_bytes: 5 * 1024 * 1024 * 1024, remaining_bytes: 5 * 1024 * 1024 * 1024 });
    mockUploadFile.mockResolvedValue({ id: 'queued-file', status: 'queued' });
    mockPackFolderFilesToZip.mockImplementation(async (files, options = {}) => {
      options.onProgress?.(1);
      return new File(['zip-bytes'], options.archiveName || 'Docs.zip', { type: 'application/zip' });
    });
    mockCollectDataTransferFiles.mockImplementation(async (dataTransfer) => ({
      files: Array.from(dataTransfer?.files || []),
      asFolder: false,
    }));
    mockCreateDownloadGrant.mockResolvedValue({
      download_path: '/my-files/download-grant/test-token',
      expires_in_seconds: 120,
    });
    mockBuildDownloadGrantUrl.mockReturnValue('http://localhost/api/v1/my-files/download-grant/test-token');
    mockTriggerNativeDownload.mockReturnValue(true);
    mockGetPreviewMeta.mockResolvedValue({
      preview_kind: 'pdf',
      source_kind: '',
      source_filename: 'report.pdf',
      pdf_filename: 'report.pdf',
      page_count: 1,
      sheets: [],
      preview_url: '/api/v1/my-files/file-1/preview/content',
    });
    mockDownloadPreviewContent.mockResolvedValue({
      data: new Blob(['pdf'], { type: 'application/pdf' }),
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="report.pdf"',
      },
    });
    mockDownloadPreviewSource.mockResolvedValue({
      data: new Blob(['source'], { type: 'application/octet-stream' }),
      headers: {},
    });
    mockCreateShare.mockResolvedValue({ token: 'public-token', expires_at: readyFile.expires_at });
    mockBuildPublicUrl.mockReturnValue('http://localhost/shared-files/public-token');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:my-file-preview'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('shows retention notice and uploads with default one-day retention', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Мой диск' });
    expect(screen.getByText(/Файлы хранятся до 30 дней/)).toBeInTheDocument();

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

  it('allows a file larger than the former one-gigabyte limit', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Мой диск' });

    const file = new File(['small-test-payload'], 'archive.bin', { type: 'application/octet-stream' });
    Object.defineProperty(file, 'size', { configurable: true, value: (1024 ** 3) + 1 });
    fireEvent.change(screen.getByTestId('my-files-input'), { target: { files: [file] } });

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }));

    await waitFor(() => expect(mockUploadFile).toHaveBeenCalledWith(expect.objectContaining({ file })));
    expect(mockNotifyWarning).not.toHaveBeenCalledWith(expect.stringContaining('1 ГБ'), expect.anything());
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
    expect(screen.getByTestId('my-files-share-copied-alert')).toHaveTextContent('Скопировано');
  });

  it('downloads a ready file directly from its right-click menu', async () => {
    mockListFiles.mockResolvedValue({ items: [readyFile] });
    renderPage();

    const card = await screen.findByTestId('my-files-card-file-1');
    fireEvent.contextMenu(card, { clientX: 120, clientY: 80 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Скачать' }));

    await waitFor(() => expect(mockCreateDownloadGrant).toHaveBeenCalledWith('file-1'));
    expect(mockTriggerNativeDownload).toHaveBeenCalledWith(
      'http://localhost/api/v1/my-files/download-grant/test-token',
    );
  });

  it('treats a dropped folder as a real folder upload', async () => {
    const nested = new File(['hello'], 'readme.txt', { type: 'text/plain' });
    Object.defineProperty(nested, 'webkitRelativePath', {
      configurable: true,
      value: 'Docs/readme.txt',
    });
    mockCollectDataTransferFiles.mockResolvedValue({
      files: [nested],
      asFolder: true,
    });

    renderPage();
    await screen.findByRole('heading', { name: 'Мой диск' });

    fireEvent.drop(screen.getByTestId('my-files-drop-zone'), {
      dataTransfer: { files: [], items: [], dropEffect: 'copy' },
      preventDefault: () => {},
    });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('my-files-folder-structure-notice')).toHaveTextContent('Docs');
    expect(mockCollectDataTransferFiles).toHaveBeenCalled();
  });

  it('creates a real folder structure before uploading folder contents', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Мой диск' });
    expect(screen.getByTestId('my-files-folder-input')).toBeInTheDocument();

    const nested = new File(['hello'], 'readme.txt', { type: 'text/plain' });
    Object.defineProperty(nested, 'webkitRelativePath', {
      configurable: true,
      value: 'Docs/Sub/readme.txt',
    });
    mockCreateFolder.mockImplementation(async ({ name, parentId }) => ({
      id: `created-${name}`,
      name,
      parent_id: parentId,
    }));
    fireEvent.change(screen.getByTestId('my-files-folder-input'), { target: { files: [nested] } });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('my-files-folder-structure-notice')).toHaveTextContent('Docs');
    expect(mockUploadFile).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить папку' }));

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith({ name: 'Docs', parentId: null });
      expect(mockCreateFolder).toHaveBeenCalledWith({ name: 'Sub', parentId: 'created-Docs' });
      expect(mockUploadFile).toHaveBeenCalledWith(expect.objectContaining({
        file: nested,
        folderId: 'created-Sub',
        retentionDays: 1,
        onUploadProgress: expect.any(Function),
      }));
    });
    expect(mockPackFolderFilesToZip).not.toHaveBeenCalled();
  });

  it('opens a private document preview for a ready supported file', async () => {
    mockListFiles.mockResolvedValue({
      items: [{
        ...readyFile,
        id: 'pdf-1',
        original_file_name: 'report.pdf',
        download_file_name: 'report.pdf',
        mime_type: 'application/pdf',
        download_mime_type: 'application/pdf',
        preview_kind: 'pdf',
        preview_available: true,
        preview_status: 'ready',
        preview_max_bytes: 26214400,
      }],
    });

    renderPage();

    await screen.findByText('report.pdf');
    fireEvent.click(screen.getByTestId('my-files-preview-pdf-1'));

    await waitFor(() => expect(mockGetPreviewMeta).toHaveBeenCalledWith('pdf-1'));
    expect(mockDownloadPreviewContent).toHaveBeenCalledWith('pdf-1');
    expect(mockCreateShare).not.toHaveBeenCalled();
    expect(await screen.findByTestId('document-preview-dialog')).toHaveTextContent('report.pdf:pdf');
  });

  it('renders folders and navigates into them', async () => {
    mockListFiles.mockResolvedValue({
      items: [readyFile],
      folders: [{ id: 'folder-1', name: 'Документы', parent_id: null }],
      breadcrumbs: [],
      folder: null,
    });
    mockListFolders.mockResolvedValue({ items: [{ id: 'folder-1', name: 'Документы', parent_id: null }] });
    renderPage();

    const folderCard = await screen.findByTestId('my-files-folder-folder-1');
    expect(folderCard).toHaveTextContent('Документы');

    mockListFiles.mockResolvedValue({
      items: [],
      folders: [],
      breadcrumbs: [{ id: 'folder-1', name: 'Документы', parent_id: null }],
      folder: { id: 'folder-1', name: 'Документы', parent_id: null },
    });
    fireEvent.click(folderCard);

    await waitFor(() => expect(mockListFiles).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'folder-1' })));
    expect(await screen.findByTestId('my-files-breadcrumbs')).toHaveTextContent('Мой диск');
  });

  it('creates a folder via dialog', async () => {
    mockListFiles.mockResolvedValue({ items: [], folders: [], breadcrumbs: [], folder: null });
    mockCreateFolder.mockResolvedValue({ id: 'folder-new', name: 'Новая папка', parent_id: null });
    renderPage();

    fireEvent.click(await screen.findByTestId('my-files-create-button'));
    fireEvent.click(await screen.findByTestId('my-files-create-folder-button'));
    const input = await screen.findByTestId('my-files-folder-name-input');
    fireEvent.change(input, { target: { value: 'Новая папка' } });
    fireEvent.click(screen.getByTestId('my-files-create-folder-confirm'));

    await waitFor(() => expect(mockCreateFolder).toHaveBeenCalledWith({ name: 'Новая папка', parentId: null }));
  });

  it('renames a file via context menu', async () => {
    mockListFiles.mockResolvedValue({ items: [readyFile], folders: [], breadcrumbs: [], folder: null });
    mockUpdateFile.mockResolvedValue({ ...readyFile, original_file_name: 'renamed.txt' });
    renderPage();

    const card = await screen.findByTestId('my-files-card-file-1');
    fireEvent.contextMenu(card);
    fireEvent.click(await screen.findByTestId('file-action-rename'));

    const input = await screen.findByTestId('my-files-rename-input');
    fireEvent.change(input, { target: { value: 'renamed.txt' } });
    fireEvent.click(screen.getByTestId('my-files-rename-confirm'));

    await waitFor(() => expect(mockUpdateFile).toHaveBeenCalledWith('file-1', { name: 'renamed.txt' }));
  });

  it('moves a file to a folder via context menu', async () => {
    mockListFiles.mockResolvedValue({ items: [readyFile], folders: [], breadcrumbs: [], folder: null });
    mockListFolders.mockResolvedValue({ items: [{ id: 'folder-7', name: 'Архив', parent_id: null }] });
    mockUpdateFile.mockResolvedValue({ ...readyFile, folder_id: 'folder-7' });
    renderPage();

    const card = await screen.findByTestId('my-files-card-file-1');
    fireEvent.contextMenu(card);
    fireEvent.click(await screen.findByTestId('file-action-move'));

    const select = await screen.findByRole('combobox');
    fireEvent.mouseDown(select);
    const option = await screen.findByRole('option', { name: 'Архив' });
    fireEvent.click(option);
    fireEvent.click(screen.getByTestId('my-files-move-confirm'));

    await waitFor(() => expect(mockUpdateFile).toHaveBeenCalledWith('file-1', { folderId: 'folder-7' }));
  });

  it('filters rows by search query', async () => {
    mockListFiles.mockResolvedValue({
      items: [readyFile, { ...readyFile, id: 'file-2', original_file_name: 'photo.png', download_file_name: 'photo.png' }],
      folders: [{ id: 'folder-1', name: 'Документы', parent_id: null }],
      breadcrumbs: [],
      folder: null,
    });
    renderPage();
    await screen.findByText('report.txt');

    fireEvent.change(screen.getByTestId('my-files-search-input'), { target: { value: 'photo' } });

    expect(screen.queryByText('report.txt')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-files-folder-folder-1')).not.toBeInTheDocument();
    expect(await screen.findByText('photo.png')).toBeInTheDocument();
  });

  it('sorts rows by size when the size column is clicked', async () => {
    mockListFiles.mockResolvedValue({
      items: [
        { ...readyFile, id: 'file-small', original_file_name: 'small.txt', original_size_bytes: 10 },
        { ...readyFile, id: 'file-big', original_file_name: 'big.txt', original_size_bytes: 9999 },
      ],
      folders: [],
      breadcrumbs: [],
      folder: null,
    });
    renderPage();
    await screen.findByText('small.txt');

    fireEvent.click(screen.getByTestId('my-files-sort-size'));

    const cards = screen.getAllByTestId(/^my-files-card-/);
    expect(cards[0]).toHaveAttribute('data-testid', 'my-files-card-file-small');
    expect(cards[1]).toHaveAttribute('data-testid', 'my-files-card-file-big');
  });

  it('selects all rows and bulk-deletes them', async () => {
    mockListFiles.mockResolvedValue({
      items: [readyFile],
      folders: [{ id: 'folder-1', name: 'Документы', parent_id: null }],
      breadcrumbs: [],
      folder: null,
    });
    renderPage();
    await screen.findByText('report.txt');

    fireEvent.click(screen.getByTestId('my-files-select-all'));
    const bar = await screen.findByTestId('my-files-selection-bar');
    expect(bar).toHaveTextContent('Выбрано: 2');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      fireEvent.click(screen.getByTestId('my-files-bulk-delete'));
      await waitFor(() => {
        expect(mockDeleteFolder).toHaveBeenCalledWith('folder-1');
        expect(mockDeleteFile).toHaveBeenCalledWith('file-1');
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('bulk-moves selected rows to a chosen folder', async () => {
    mockListFiles.mockResolvedValue({
      items: [readyFile],
      folders: [],
      breadcrumbs: [],
      folder: null,
    });
    mockListFolders.mockResolvedValue({ items: [{ id: 'folder-7', name: 'Архив', parent_id: null }] });
    mockUpdateFile.mockResolvedValue({ ...readyFile, folder_id: 'folder-7' });
    renderPage();
    await screen.findByText('report.txt');

    fireEvent.click(screen.getByTestId('my-files-select-all'));
    fireEvent.click(await screen.findByTestId('my-files-bulk-move'));

    const select = await screen.findByRole('combobox');
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByRole('option', { name: 'Архив' }));
    fireEvent.click(screen.getByTestId('my-files-move-confirm'));

    await waitFor(() => expect(mockUpdateFile).toHaveBeenCalledWith('file-1', { folderId: 'folder-7' }));
  });

  it('switches to grid view and shows folder file counts', async () => {
    mockListFiles.mockResolvedValue({
      items: [readyFile],
      folders: [{ id: 'folder-1', name: 'Документы', parent_id: null, file_count: 3 }],
      breadcrumbs: [],
      folder: null,
    });
    renderPage();
    await screen.findByText('report.txt');

    fireEvent.click(screen.getByTestId('my-files-view-toggle'));

    const grid = await screen.findByTestId('my-files-grid');
    expect(within(grid).getByText('Документы')).toBeInTheDocument();
    expect(within(grid).getByText('3 шт.')).toBeInTheDocument();
    expect(within(grid).getByText('report.txt')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('my-files-view-list'));
    await waitFor(() => expect(screen.queryByTestId('my-files-grid')).not.toBeInTheDocument());
  });

  it('shows trash entries and restores a file', async () => {
    mockListTrash.mockResolvedValue({
      items: [{ ...readyFile, id: 'file-dead' }],
      folders: [{ id: 'folder-dead', name: 'Старое' }],
    });
    render(
      <MemoryRouter initialEntries={['/?view=trash']}>
        <ThemeProvider theme={theme}>
          <MyFiles />
        </ThemeProvider>
      </MemoryRouter>,
    );

    await screen.findByText('report.txt');
    expect(screen.getByText('Старое')).toBeInTheDocument();
    expect(mockListTrash).toHaveBeenCalled();
    expect(screen.getAllByText('Корзина').length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByTestId('my-files-restore-file-dead'));
    await waitFor(() => expect(mockRestoreFile).toHaveBeenCalledWith('file-dead'));
  });

  it('purges a trashed file after confirmation', async () => {
    mockListTrash.mockResolvedValue({ items: [{ ...readyFile, id: 'file-dead' }], folders: [] });
    render(
      <MemoryRouter initialEntries={['/?view=trash']}>
        <ThemeProvider theme={theme}>
          <MyFiles />
        </ThemeProvider>
      </MemoryRouter>,
    );
    await screen.findByText('report.txt');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      fireEvent.click(screen.getByTestId('my-files-purge-file-dead'));
      await waitFor(() => expect(mockPurgeFile).toHaveBeenCalledWith('file-dead'));
    } finally {
      confirmSpy.mockRestore();
    }
  });

});
