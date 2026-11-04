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
  mockCollectDataTransferFiles,
  mockListLibraries,
  mockCopyFile,
  mockOfficeStatus,
  mockCreateBlank,
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
  mockCollectDataTransferFiles: vi.fn(),
  mockListLibraries: vi.fn(),
  mockCopyFile: vi.fn(),
  mockOfficeStatus: vi.fn(),
  mockCreateBlank: vi.fn(),
}));

vi.mock('../lib/myFilesFolderZip', async () => {
  const actual = await vi.importActual('../lib/myFilesFolderZip');
  return {
    ...actual,
    collectDataTransferFiles: mockCollectDataTransferFiles,
  };
});

vi.mock('../api/myFiles', () => ({
  myFilesRetentionOptions: [1, 3, 7, 10, 30],
  MY_FILES_MAX_UPLOAD_BYTES: 400 * 1024 * 1024 * 1024,
  formatMyFilesRetentionLabel: (days) => (Number(days) === 0 ? 'Навсегда' : `${days} дн.`),
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
    copyFile: mockCopyFile,
  },
}));

vi.mock('../api/myFilesLibraries', () => ({
  myFilesLibrariesAPI: {
    list: mockListLibraries,
  },
}));

vi.mock('../components/myFiles/MyFilesLibraryDialog', () => ({
  default: ({ open, library }) => (open ? <div data-testid="library-dialog">{library ? library.name : 'новая'}</div> : null),
}));

vi.mock('../api/myFilesOffice', () => ({
  myFilesOfficeAPI: {
    getStatus: mockOfficeStatus,
    createBlank: mockCreateBlank,
  },
}));

vi.mock('../components/myFiles/MyFilesOfficeEditorDialog', () => ({
  default: ({ open, file }) => (open ? <div data-testid="office-editor">{file?.original_file_name}</div> : null),
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
    user: { id: 7, username: 'files-test' },
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

function renderPage(entry = '/') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ThemeProvider theme={theme}>
        <MyFiles />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

import MyFiles from './MyFiles';

describe('MyFiles page', () => {
  it('does not start another polling request while the previous one is pending', async () => {
    const timeoutSpy = vi.spyOn(window, 'setTimeout');
    try {
      mockListFiles.mockResolvedValue({ items: [{ ...readyFile, status: 'processing' }] });
      renderPage();
      await screen.findByText('report.txt');
      await waitFor(() => expect(timeoutSpy.mock.calls.some((call) => call[1] === 4000)).toBe(true));
      const poll = timeoutSpy.mock.calls.find((call) => call[1] === 4000)[0];
      let finish;
      mockListFiles.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      act(() => { poll(); poll(); });
      expect(mockListFiles).toHaveBeenCalledTimes(2);
      await act(async () => finish({ items: [readyFile] }));
    } finally {
      timeoutSpy.mockRestore();
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
    localStorage.setItem('user', JSON.stringify({ id: 7, username: 'files-test' }));
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
    mockListLibraries.mockReset();
    mockCopyFile.mockReset();
    mockCreateBlank.mockReset();
    mockOfficeStatus.mockReset();
    mockOfficeStatus.mockResolvedValue({ enabled: false, editable_extensions: [] });
    mockListLibraries.mockResolvedValue({ items: [], can_manage: false });
    mockListTrash.mockResolvedValue({ items: [], folders: [] });
    mockListFiles.mockResolvedValue({ items: [] });
    mockListFolders.mockResolvedValue({ items: [] });
    mockGetQuota.mockResolvedValue({ used_bytes: 0, limit_bytes: 5 * 1024 * 1024 * 1024, remaining_bytes: 5 * 1024 * 1024 * 1024 });
    mockUploadFile.mockResolvedValue({ id: 'queued-file', status: 'queued' });
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

  it('marks files with co-editing and lists the ones shared with me as read-only rows', async () => {
    mockListFiles.mockResolvedValue({
      items: [
        { ...readyFile, id: 'mine-1', original_file_name: 'plan.docx', collaborators_count: 3 },
        { ...readyFile, id: 'plain-1', original_file_name: 'notes.txt' },
      ],
    });
    const { unmount } = renderPage();

    await screen.findByText('plan.docx');
    expect(screen.getByTestId('my-files-coedit-mine-1')).toHaveTextContent('совместно');
    expect(screen.queryByTestId('my-files-coedit-plain-1')).not.toBeInTheDocument();
    unmount();

    mockListFiles.mockResolvedValue({
      items: [{ ...readyFile, id: 'theirs-1', original_file_name: 'budget.xlsx', shared_with_me: true, my_role: 'comment', owner_username: 'ivanov' }],
    });
    renderPage('/?view=shared');

    await screen.findByText('budget.xlsx');
    expect(mockListFiles).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'shared' }));
    expect(screen.getByTestId('my-files-coedit-theirs-1')).toHaveTextContent('комментарии');
    expect(screen.queryByLabelText('Выбрать файл budget.xlsx')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-files-delete-theirs-1')).not.toBeInTheDocument();
  });

  it('opens a folder shared with me, browses it read-only and returns through the path', async () => {
    const sharedFolder = {
      id: 'sf-1', name: 'Проект', parent_id: null, file_count: 2, shared_with_me: true, my_role: 'comment', owner_username: 'ivanov',
    };
    mockListFiles.mockImplementation(async ({ folderId }) => (folderId
      ? {
        items: [{ ...readyFile, id: 'in-1', original_file_name: 'plan.docx', shared_with_me: true, my_role: 'comment', owner_username: 'ivanov' }],
        folders: [],
        breadcrumbs: [sharedFolder],
        folder: sharedFolder,
      }
      : { items: [], folders: [sharedFolder], breadcrumbs: [], folder: null }));
    renderPage('/?view=shared');

    await screen.findByText('Проект');
    expect(screen.getByTestId('my-files-coedit-sf-1')).toHaveTextContent('комментарии');
    expect(screen.queryByLabelText('Выбрать папку Проект')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Удалить папку Проект')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('my-files-folder-sf-1'));

    await screen.findByText('plan.docx');
    expect(mockListFiles).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'shared', folderId: 'sf-1' }));
    expect(screen.queryByText('Загрузить файлы')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-files-delete-in-1')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('my-files-breadcrumbs')).getByText('Доступно мне'));

    await screen.findByText('Проект');
    expect(mockListFiles).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'shared', folderId: null }));
  });

  const GIB = 1024 ** 3;
  const bookkeeping = {
    id: 'lib-1', name: 'Бухгалтерия', quota_bytes: 10 * GIB, used_bytes: 2 * GIB, files_count: 3, members_count: 4, my_role: 'edit',
  };

  it('browses a shared library, uploads into it and shows its own limit', async () => {
    mockListLibraries.mockResolvedValue({ items: [bookkeeping], can_manage: false });
    mockListFiles.mockImplementation(async ({ libraryId }) => (libraryId
      ? { items: [{ ...readyFile, id: 'lib-file', original_file_name: 'balance.xlsx', my_role: 'edit' }], folders: [], library: { id: 'lib-1', name: 'Бухгалтерия', my_role: 'edit' } }
      : { items: [] }));
    renderPage();

    fireEvent.click(await screen.findByTestId('my-files-library-lib-1'));

    await screen.findByText('balance.xlsx');
    expect(mockListFiles).toHaveBeenLastCalledWith(expect.objectContaining({ libraryId: 'lib-1' }));
    expect(mockListFolders).toHaveBeenLastCalledWith({ libraryId: 'lib-1' });
    expect(screen.getByRole('heading', { name: 'Бухгалтерия' })).toBeInTheDocument();
    expect(screen.getByTestId('my-files-library-role')).toHaveTextContent('Правка');
    expect(screen.getByTestId('my-files-quota')).toHaveTextContent('Общая папка');
    expect(screen.getByTestId('my-files-quota')).toHaveTextContent('10');
    // Personal-only controls disappear: favourites, the trash of someone else's files, library settings.
    expect(screen.queryByTestId('my-files-favorite-lib-file')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-files-library-trash')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-files-library-settings')).not.toBeInTheDocument();

    const file = new File(['payload'], 'report.docx', { type: 'application/octet-stream' });
    fireEvent.change(screen.getByTestId('my-files-input'), { target: { files: [file] } });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('my-files-library-upload-notice')).toHaveTextContent('бессрочно');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }));

    await waitFor(() => expect(mockUploadFile).toHaveBeenCalledWith(expect.objectContaining({ file, libraryId: 'lib-1' })));
  });

  it('keeps a view-only library member from changing anything', async () => {
    mockListLibraries.mockResolvedValue({ items: [{ ...bookkeeping, my_role: 'view' }], can_manage: false });
    mockListFiles.mockResolvedValue({
      items: [{ ...readyFile, id: 'lib-file', original_file_name: 'balance.xlsx', my_role: 'view' }],
      folders: [],
      library: { id: 'lib-1', name: 'Бухгалтерия', my_role: 'view' },
    });
    renderPage('/?library=lib-1');

    await screen.findByText('balance.xlsx');
    expect(screen.getByTestId('my-files-library-role')).toHaveTextContent('Просмотр');
    expect(screen.getByTestId('my-files-create-button')).toBeDisabled();
    expect(screen.getByTestId('my-files-delete-lib-file')).toBeDisabled();
    expect(screen.queryByText('Загрузить файлы')).not.toBeInTheDocument();
  });

  it('lets a library manager open the library trash and administrators set the library up', async () => {
    mockListLibraries.mockResolvedValue({ items: [{ ...bookkeeping, my_role: 'manage' }], can_manage: true });
    mockListFiles.mockResolvedValue({
      items: [], folders: [], library: { id: 'lib-1', name: 'Бухгалтерия', my_role: 'manage' },
    });
    mockListTrash.mockResolvedValue({
      items: [{ ...readyFile, id: 'gone-1', original_file_name: 'old.xlsx', deleted_at: '2026-06-04T09:00:00+00:00' }],
      folders: [],
    });
    renderPage('/?library=lib-1');

    fireEvent.click(await screen.findByTestId('my-files-library-trash'));

    await screen.findByText('old.xlsx');
    expect(mockListTrash).toHaveBeenLastCalledWith({ libraryId: 'lib-1' });
    expect(screen.getByRole('heading', { name: 'Корзина — Бухгалтерия' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('my-files-empty-trash'));
    fireEvent.click(await screen.findByRole('button', { name: 'Очистить' }));
    await waitFor(() => expect(mockEmptyTrash).toHaveBeenCalledWith({ libraryId: 'lib-1' }));

    fireEvent.click(screen.getByTestId('my-files-library-lib-1'));
    fireEvent.click(await screen.findByTestId('my-files-library-settings'));
    expect(screen.getByTestId('library-dialog')).toHaveTextContent('Бухгалтерия');
  });

  it('opens the create dialog from the sidebar for administrators and hides the section from others', async () => {
    mockListLibraries.mockResolvedValue({ items: [], can_manage: true });
    const { unmount } = renderPage();

    fireEvent.click(await screen.findByTestId('my-files-library-add'));
    expect(screen.getByTestId('library-dialog')).toHaveTextContent('новая');
    unmount();

    mockListLibraries.mockResolvedValue({ items: [], can_manage: false });
    renderPage();
    await screen.findByRole('heading', { name: 'Мой диск' });
    expect(screen.queryByTestId('my-files-libraries')).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByTestId('my-files-bulk-delete'));
    fireEvent.click(await screen.findByTestId('my-files-confirm-action'));
    await waitFor(() => {
      expect(mockDeleteFolder).toHaveBeenCalledWith('folder-1');
      expect(mockDeleteFile).toHaveBeenCalledWith('file-1');
    });
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

    fireEvent.click(screen.getByTestId('my-files-purge-file-dead'));
    fireEvent.click(await screen.findByTestId('my-files-confirm-action'));
    await waitFor(() => expect(mockPurgeFile).toHaveBeenCalledWith('file-dead'));
  });

  it('moves a folder into another folder via drag and drop', async () => {
    const folders = [
      { id: 'folder-1', name: 'Документы', parent_id: null },
      { id: 'folder-2', name: 'Архив', parent_id: null },
    ];
    mockListFiles.mockResolvedValue({ items: [readyFile], folders, breadcrumbs: [], folder: null });
    mockListFolders.mockResolvedValue({ items: folders });
    mockUpdateFolder.mockResolvedValue({ id: 'folder-2', parent_id: 'folder-1' });
    renderPage();
    await screen.findByText('report.txt');

    fireEvent.drop(screen.getByTestId('my-files-folder-folder-1'), {
      dataTransfer: {
        types: ['application/x-hubit-folder'],
        getData: (type) => (type === 'application/x-hubit-folder' ? 'folder-2' : ''),
        files: [],
        items: [],
      },
    });
    await waitFor(() => expect(mockUpdateFolder).toHaveBeenCalledWith('folder-2', { parentId: 'folder-1' }));
  });

  it('rejects dropping a folder into its own subtree', async () => {
    const folders = [
      { id: 'folder-1', name: 'Документы', parent_id: null },
      { id: 'folder-2', name: 'Вложенная', parent_id: 'folder-1' },
    ];
    mockListFiles.mockResolvedValue({ items: [], folders, breadcrumbs: [], folder: null });
    mockListFolders.mockResolvedValue({ items: folders });
    renderPage();
    await screen.findByText('Документы');

    fireEvent.drop(screen.getByTestId('my-files-folder-folder-2'), {
      dataTransfer: {
        types: ['application/x-hubit-folder'],
        getData: (type) => (type === 'application/x-hubit-folder' ? 'folder-1' : ''),
        files: [],
        items: [],
      },
    });
    await waitFor(() => {
      expect(mockNotifyWarning).toHaveBeenCalledWith(
        expect.stringContaining('внутрь самой себя'),
        expect.objectContaining({ source: 'my-files-move' }),
      );
    });
    expect(mockUpdateFolder).not.toHaveBeenCalled();
  });

  it('creates a blank document from the create menu and opens it in an editor tab once it is ready', async () => {
    mockOfficeStatus.mockResolvedValue({ enabled: true, editable_extensions: ['.docx', '.xlsx', '.pptx'] });
    const created = {
      ...readyFile, id: 'new-1', original_file_name: 'Новый документ.docx', download_file_name: 'Новый документ.docx', status: 'queued',
    };
    mockCreateBlank.mockResolvedValue(created);
    mockListFiles.mockResolvedValueOnce({ items: [] });
    mockListFiles.mockResolvedValue({ items: [{ ...created, status: 'ready' }] });
    const openTab = vi.spyOn(window, 'open').mockReturnValue({});
    renderPage();
    await waitFor(() => expect(mockOfficeStatus).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('my-files-create-button'));
    fireEvent.click(await screen.findByTestId('my-files-create-docx'));

    await waitFor(() => expect(mockCreateBlank).toHaveBeenCalledWith({ kind: 'docx', folderId: null, libraryId: null }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith('/my-files/edit/new-1', '_blank'));
    openTab.mockRestore();
  });

  it('falls back to the editor window when the browser blocks the new tab', async () => {
    mockOfficeStatus.mockResolvedValue({ enabled: true, editable_extensions: ['.docx'] });
    mockListFiles.mockResolvedValue({
      items: [{
        ...readyFile, id: 'shared-doc', original_file_name: 'plan.docx', download_file_name: 'plan.docx', collaborators_count: 2,
      }],
    });
    const openTab = vi.spyOn(window, 'open').mockReturnValue(null);
    renderPage();
    await waitFor(() => expect(mockOfficeStatus).toHaveBeenCalled());

    fireEvent.click(await screen.findByTestId('my-files-card-shared-doc'));

    expect(await screen.findByTestId('office-editor')).toHaveTextContent('plan.docx');
    expect(openTab).toHaveBeenCalled();
    openTab.mockRestore();
  });

  it('opens a shared document online in a new tab instead of a preview or a local application', async () => {
    mockOfficeStatus.mockResolvedValue({ enabled: true, editable_extensions: ['.docx', '.xlsx'] });
    mockListFiles.mockResolvedValue({
      items: [
        {
          ...readyFile, id: 'shared-doc', original_file_name: 'plan.docx', download_file_name: 'plan.docx', collaborators_count: 2,
        },
        {
          ...readyFile, id: 'private-doc', original_file_name: 'private.docx', download_file_name: 'private.docx',
        },
      ],
    });
    const openTab = vi.spyOn(window, 'open').mockReturnValue({});
    renderPage();
    await screen.findByText('plan.docx');
    await waitFor(() => expect(mockOfficeStatus).toHaveBeenCalled());
    await screen.findByTestId('my-files-coedit-shared-doc');

    fireEvent.click(screen.getByTestId('my-files-card-shared-doc'));

    expect(openTab).toHaveBeenCalledWith('/my-files/edit/shared-doc', '_blank');
    expect(mockGetPreviewMeta).not.toHaveBeenCalled();

    openTab.mockClear();
    fireEvent.click(screen.getByTestId('my-files-card-private-doc'));
    expect(openTab).not.toHaveBeenCalled();
    openTab.mockRestore();
  });

  it('offers new documents only when online editing is enabled', async () => {
    renderPage();
    await screen.findByTestId('my-files-create-button');

    fireEvent.click(screen.getByTestId('my-files-create-button'));

    await screen.findByTestId('my-files-create-folder-button');
    expect(screen.queryByTestId('my-files-create-docx')).not.toBeInTheDocument();
  });

  it('narrows the list with the type and date filters', async () => {
    const stamp = new Date().toISOString();
    mockListFiles.mockResolvedValue({
      items: [
        { ...readyFile, id: 'f-doc', original_file_name: 'letter.docx', download_file_name: 'letter.docx', updated_at: stamp },
        { ...readyFile, id: 'f-sheet', original_file_name: 'budget.xlsx', download_file_name: 'budget.xlsx', updated_at: stamp },
        { ...readyFile, id: 'f-old', original_file_name: 'old.xlsx', download_file_name: 'old.xlsx', updated_at: '2020-01-01T00:00:00+00:00' },
      ],
      folders: [{ id: 'folder-1', name: 'Архив 2020', parent_id: null }],
    });
    renderPage();
    await screen.findByText('letter.docx');

    fireEvent.click(screen.getByTestId('my-files-filter-type'));
    fireEvent.click(await screen.findByTestId('my-files-filter-option-sheet'));

    expect(screen.queryByText('letter.docx')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-files-folder-folder-1')).not.toBeInTheDocument();
    expect(screen.getByText('budget.xlsx')).toBeInTheDocument();
    expect(screen.getByText('old.xlsx')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('my-files-filter-date'));
    fireEvent.click(await screen.findByTestId('my-files-filter-option-today'));

    expect(screen.getByText('budget.xlsx')).toBeInTheDocument();
    expect(screen.queryByText('old.xlsx')).not.toBeInTheDocument();
  });

  it('copies a file into a library where the user may edit', async () => {
    mockListLibraries.mockResolvedValue({
      items: [bookkeeping, { ...bookkeeping, id: 'lib-2', name: 'Архив для чтения', my_role: 'view' }],
      can_manage: false,
    });
    mockListFiles.mockResolvedValue({ items: [readyFile] });
    mockCopyFile.mockResolvedValue({ ...readyFile, id: 'copy-1' });
    renderPage();
    await screen.findByText('report.txt');

    fireEvent.contextMenu(screen.getByTestId('my-files-card-file-1'));
    fireEvent.click(await screen.findByTestId('file-action-copy-to'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[0]);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Мой диск', 'Бухгалтерия']);
    fireEvent.click(options[1]);
    fireEvent.click(within(dialog).getByTestId('my-files-copy-submit'));

    await waitFor(() => expect(mockCopyFile).toHaveBeenCalledWith('file-1', { folderId: null, libraryId: 'lib-1' }));
    expect(mockListFolders).toHaveBeenCalledWith(expect.objectContaining({ libraryId: 'lib-1' }));
    await waitFor(() => expect(mockNotifySuccess).toHaveBeenCalledWith('Копия создана.', expect.anything()));
  });

  it('gates recent files of a library by the role in that library', async () => {
    mockListLibraries.mockResolvedValue({ items: [{ ...bookkeeping, my_role: 'view' }], can_manage: false });
    mockListFiles.mockResolvedValue({
      items: [
        { ...readyFile, id: 'mine-1', original_file_name: 'mine.txt' },
        {
          ...readyFile, id: 'lib-1-file', original_file_name: 'balance.xlsx', library_id: 'lib-1', library_name: 'Бухгалтерия', my_role: 'view',
        },
      ],
      folders: [],
    });
    renderPage('/?view=recent');
    await screen.findByText('balance.xlsx');

    expect(screen.getByTestId('my-files-delete-mine-1')).toBeEnabled();
    expect(screen.getByTestId('my-files-delete-lib-1-file')).toBeDisabled();
    expect(screen.getByTestId('my-files-favorite-mine-1')).toBeInTheDocument();
    expect(screen.queryByTestId('my-files-favorite-lib-1-file')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('my-files-card-lib-1-file')).getByText('Бухгалтерия')).toBeInTheDocument();
  });

});
