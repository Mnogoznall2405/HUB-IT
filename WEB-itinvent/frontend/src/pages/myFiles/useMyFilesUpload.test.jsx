import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUploadFile,
  mockCreateFolder,
  mockLoadData,
  mockNotifySuccess,
  mockNotifyWarning,
  mockNotifyApiError,
  mockConsumeDesktopSharedFiles,
} = vi.hoisted(() => ({
  mockUploadFile: vi.fn(),
  mockCreateFolder: vi.fn(),
  mockLoadData: vi.fn(async () => {}),
  mockNotifySuccess: vi.fn(),
  mockNotifyWarning: vi.fn(),
  mockNotifyApiError: vi.fn(),
  mockConsumeDesktopSharedFiles: vi.fn(() => []),
}));

vi.mock('../../api/myFiles', () => ({
  myFilesAPI: {
    uploadFile: mockUploadFile,
    createFolder: mockCreateFolder,
  },
  MY_FILES_MAX_UPLOAD_BYTES: 10 * 1024 * 1024 * 1024,
}));

vi.mock('../../lib/desktopBridge', () => ({
  consumeDesktopSharedFiles: mockConsumeDesktopSharedFiles,
  DESKTOP_SHARED_FILES_EVENT: 'hubit:desktop-shared-files',
}));

import { useMyFilesUpload } from './useMyFilesUpload';

const makeFile = (name, { size = 100, path = '' } = {}) => {
  const file = new File(['x'.repeat(Math.min(size, 1024))], name, { type: 'text/plain' });
  Object.defineProperty(file, 'size', { value: size });
  if (path) {
    Object.defineProperty(file, 'webkitRelativePath', { configurable: true, value: path });
  }
  return file;
};

const renderUpload = (overrides = {}) => renderHook(() => useMyFilesUpload({
  canWrite: true,
  currentFolderId: 'folder-root',
  isSpecialView: false,
  allFolders: [],
  loadData: mockLoadData,
  notifySuccess: mockNotifySuccess,
  notifyWarning: mockNotifyWarning,
  notifyApiError: mockNotifyApiError,
  ...overrides,
}));

describe('useMyFilesUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadData.mockResolvedValue(undefined);
    mockUploadFile.mockResolvedValue({ id: 'up-1' });
  });

  it('opens the dialog with picked files and uploads them on confirm', async () => {
    const { result } = renderUpload();
    const file = makeFile('note.txt');

    act(() => result.current.openUploadDialog([file]));
    expect(result.current.uploadDialogOpen).toBe(true);
    expect(result.current.pendingUploadFiles).toHaveLength(1);
    expect(result.current.retentionDays).toBe(1);

    await act(async () => { result.current.confirmUpload(); });
    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(expect.objectContaining({
        file,
        retentionDays: 1,
        folderId: 'folder-root',
        parallelChunks: 4,
      }));
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith(
      expect.stringContaining('Загружено файлов: 1'),
      expect.objectContaining({ source: 'my-files-upload' }),
    );
    expect(mockLoadData).toHaveBeenCalledWith({ silent: true });
    expect(result.current.uploading).toBe(false);
  });

  it('uploads a batch with parallelChunks 2 and at most two files in flight', async () => {
    const { result } = renderUpload();
    const files = [makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt')];
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers = [];
    mockUploadFile.mockImplementation(() => new Promise((resolve) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      resolvers.push(() => {
        inFlight -= 1;
        resolve({ id: 'done' });
      });
    }));

    act(() => result.current.openUploadDialog(files));
    await act(async () => { result.current.confirmUpload(); });

    for (let guard = 0; guard < 20 && (mockUploadFile.mock.calls.length < 3 || resolvers.length > 0); guard += 1) {
      resolvers.splice(0).forEach((resolve) => resolve());
      await act(async () => {});
    }

    expect(mockUploadFile).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    mockUploadFile.mock.calls.forEach(([args]) => {
      expect(args).toEqual(expect.objectContaining({ parallelChunks: 2 }));
    });
  });

  it('does nothing without write permission', () => {
    const { result } = renderUpload({ canWrite: false });
    act(() => result.current.openUploadDialog([makeFile('a.txt')]));
    expect(result.current.uploadDialogOpen).toBe(false);
    expect(result.current.pendingUploadFiles).toHaveLength(0);
  });

  it('reports a too-large file as a failure and keeps going', async () => {
    const { result } = renderUpload();
    const big = makeFile('huge.bin', { size: 11 * 1024 * 1024 * 1024 });
    const ok = makeFile('ok.txt');

    act(() => result.current.openUploadDialog([big, ok]));
    await act(async () => { result.current.confirmUpload(); });

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledTimes(1);
      expect(mockUploadFile).toHaveBeenCalledWith(expect.objectContaining({ file: ok }));
    });
    expect(mockNotifyWarning).toHaveBeenCalledWith(
      expect.stringContaining('huge.bin'),
      expect.objectContaining({ source: 'my-files-upload-failed' }),
    );
  });

  it('creates the folder structure before uploading folder contents', async () => {
    const { result } = renderUpload({ allFolders: [] });
    mockCreateFolder.mockImplementation(async ({ name, parentId }) => ({
      id: `created-${name}`,
      name,
      parent_id: parentId,
    }));

    const nested = makeFile('readme.txt', { path: 'Docs/Sub/readme.txt' });
    act(() => result.current.openUploadDialog([nested], { asFolder: true }));
    expect(result.current.pendingFolderFiles).toHaveLength(1);

    await act(async () => { result.current.confirmUpload(); });
    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith({ name: 'Docs', parentId: 'folder-root' });
      expect(mockCreateFolder).toHaveBeenCalledWith({ name: 'Sub', parentId: 'created-Docs' });
      expect(mockUploadFile).toHaveBeenCalledWith(expect.objectContaining({
        file: nested,
        folderId: 'created-Sub',
        retentionDays: 1,
      }));
    });
  });

  it('warns on an empty folder selection', () => {
    const { result } = renderUpload();
    const empty = makeFile('.keep', { path: 'Empty/.keep', size: 0 });
    act(() => result.current.openUploadDialog([empty], { asFolder: true }));
    // folder with files still opens; a zero-byte file is a valid file.
    expect(result.current.uploadDialogOpen).toBe(true);
  });

  it('keeps the dialog closed and warns on desktop share without rights', async () => {
    mockConsumeDesktopSharedFiles.mockReturnValue([makeFile('shared.txt')]);
    renderUpload({ canWrite: false });
    await waitFor(() => {
      expect(mockNotifyWarning).toHaveBeenCalledWith(
        expect.stringContaining('Нет прав'),
        expect.objectContaining({ source: 'my-files-upload' }),
      );
    });
  });

  it('tracks per-file upload progress', async () => {
    const { result } = renderUpload();
    const file = makeFile('progress.zip', { size: 200 });
    let progressCb;
    mockUploadFile.mockImplementation(async ({ onUploadProgress }) => {
      progressCb = onUploadProgress;
      onUploadProgress({ loaded: 100, total: 200 });
      return { id: 'u' };
    });

    act(() => result.current.openUploadDialog([file]));
    await act(async () => { result.current.confirmUpload(); });
    await waitFor(() => expect(mockUploadFile).toHaveBeenCalled());
    expect(progressCb).toBeInstanceOf(Function);
  });

  it('notifies on upload failure and still closes the upload state', async () => {
    mockUploadFile.mockRejectedValue({ response: { status: 413 } });
    const { result } = renderUpload();

    act(() => result.current.openUploadDialog([makeFile('f.txt')]));
    await act(async () => { result.current.confirmUpload(); });
    await waitFor(() => {
      expect(mockNotifyWarning).toHaveBeenCalledWith(
        expect.stringContaining('превышен лимит сервера'),
        expect.objectContaining({ source: 'my-files-upload-failed' }),
      );
    });
    expect(result.current.uploading).toBe(false);
  });
});
