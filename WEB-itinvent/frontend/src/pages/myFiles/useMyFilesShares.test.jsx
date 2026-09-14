import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateShare,
  mockRevokeShare,
  mockCreateFolderShare,
  mockRevokeFolderShare,
  mockBuildPublicUrl,
  mockBuildPublicFolderUrl,
  mockLoadData,
  mockNotifySuccess,
  mockNotifyWarning,
  mockNotifyApiError,
} = vi.hoisted(() => ({
  mockCreateShare: vi.fn(),
  mockRevokeShare: vi.fn(),
  mockCreateFolderShare: vi.fn(),
  mockRevokeFolderShare: vi.fn(),
  mockBuildPublicUrl: vi.fn((token) => `https://hub/s/${token}`),
  mockBuildPublicFolderUrl: vi.fn((token) => `https://hub/f/${token}`),
  mockLoadData: vi.fn(async () => {}),
  mockNotifySuccess: vi.fn(),
  mockNotifyWarning: vi.fn(),
  mockNotifyApiError: vi.fn(),
}));

vi.mock('../../api/myFiles', () => ({
  myFilesAPI: {
    createShare: mockCreateShare,
    revokeShare: mockRevokeShare,
    createFolderShare: mockCreateFolderShare,
    revokeFolderShare: mockRevokeFolderShare,
    buildPublicUrl: mockBuildPublicUrl,
    buildPublicFolderUrl: mockBuildPublicFolderUrl,
  },
}));

import { useMyFilesShares } from './useMyFilesShares';

const renderShares = (overrides = {}) => renderHook(() => useMyFilesShares({
  loadData: mockLoadData,
  notifySuccess: mockNotifySuccess,
  notifyWarning: mockNotifyWarning,
  notifyApiError: mockNotifyApiError,
  ...overrides,
}));

const file = { id: 'f1', download_file_name: 'report.pdf', original_file_name: 'report.pdf' };

describe('useMyFilesShares', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateShare.mockResolvedValue({ token: 'tok-1', expires_at: '2099-01-01' });
    mockCreateFolderShare.mockResolvedValue({ token: 'tok-2' });
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  });

  it('creates a share, copies the link and opens the dialog', async () => {
    const { result } = renderShares();
    await act(async () => { await result.current.shareFile(file); });

    expect(mockCreateShare).toHaveBeenCalledWith('f1', { rotate: false });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://hub/s/tok-1');
    expect(result.current.shareDialog).toMatchObject({
      open: true,
      fileId: 'f1',
      url: 'https://hub/s/tok-1',
      linkCopied: true,
      fileName: 'report.pdf',
    });
    expect(mockLoadData).toHaveBeenCalledWith({ silent: true });
  });

  it('warns when the clipboard is unavailable but still opens the dialog', async () => {
    navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));
    const { result } = renderShares();
    await act(async () => { await result.current.shareFile(file); });

    expect(result.current.shareDialog.open).toBe(true);
    expect(result.current.shareDialog.linkCopied).toBe(false);
    expect(mockNotifyWarning).toHaveBeenCalledWith(
      expect.stringContaining('Скопируйте'),
      expect.objectContaining({ source: 'my-files-share' }),
    );
  });

  it('shows the rotate toast only on rotation', async () => {
    const { result } = renderShares();
    await act(async () => { await result.current.shareFile(file, { rotate: true }); });
    expect(mockCreateShare).toHaveBeenCalledWith('f1', { rotate: true });
    expect(mockNotifySuccess).toHaveBeenCalledWith(
      expect.stringContaining('новая публичная ссылка'),
      expect.objectContaining({ source: 'my-files-share-rotate' }),
    );
  });

  it('revokes a share and refreshes the list', async () => {
    const { result } = renderShares();
    await act(async () => { await result.current.revokeShare(file); });
    expect(mockRevokeShare).toHaveBeenCalledWith('f1');
    expect(mockLoadData).toHaveBeenCalledWith({ silent: true });
    expect(mockNotifySuccess).toHaveBeenCalledWith(
      expect.stringContaining('отключена'),
      expect.objectContaining({ source: 'my-files-share' }),
    );
  });

  it('reports share creation errors via api error notify', async () => {
    mockCreateShare.mockRejectedValue({ response: { data: { detail: 'denied' } } });
    const { result } = renderShares();
    await act(async () => { await result.current.shareFile(file); });
    expect(mockNotifyApiError).toHaveBeenCalled();
    expect(result.current.shareDialog.open).toBe(false);
  });

  it('creates and revokes a folder share', async () => {
    const { result } = renderShares();
    await act(async () => { await result.current.shareFolder({ id: 'd1', name: 'Документы' }); });
    expect(mockCreateFolderShare).toHaveBeenCalledWith('d1', { rotate: false });
    expect(result.current.folderShareDialog).toMatchObject({
      open: true,
      folderId: 'd1',
      url: 'https://hub/f/tok-2',
      folderName: 'Документы',
    });

    await act(async () => { await result.current.revokeFolderShare('d1'); });
    expect(mockRevokeFolderShare).toHaveBeenCalledWith('d1');
    expect(result.current.folderShareDialog.open).toBe(false);
  });
});
