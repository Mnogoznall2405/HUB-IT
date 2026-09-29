import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetPublicFolder,
  mockCreateGrant,
  mockBuildGrantUrl,
  mockTriggerNativeDownload,
} = vi.hoisted(() => ({
  mockGetPublicFolder: vi.fn(),
  mockCreateGrant: vi.fn(),
  mockBuildGrantUrl: vi.fn(),
  mockTriggerNativeDownload: vi.fn(),
}));

vi.mock('../api/myFiles', () => ({
  myFilesAPI: {
    getPublicFolder: mockGetPublicFolder,
    createPublicFolderDownloadGrant: mockCreateGrant,
    buildDownloadGrantUrl: mockBuildGrantUrl,
    triggerNativeDownload: mockTriggerNativeDownload,
    buildPublicFolderPreviewUrl: vi.fn(() => '/preview'),
  },
}));

import SharedFolder from './SharedFolder';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/shared-folders/tok-1']}>
      <Routes>
        <Route path="/shared-folders/:token" element={<SharedFolder />} />
      </Routes>
    </MemoryRouter>,
  );
}

const folderPayload = {
  folder_name: 'Документы',
  items: [
    { id: 'f1', file_name: 'a.txt', size_bytes: 10, relative_path: 'a.txt', preview_available: false },
  ],
};

describe('SharedFolder page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicFolder.mockResolvedValue(folderPayload);
    mockCreateGrant.mockResolvedValue({ download_path: '/grant/abc' });
    mockBuildGrantUrl.mockReturnValue('https://hub/grant/abc');
    mockTriggerNativeDownload.mockReturnValue(true);
  });

  it('keeps the file list visible when a download fails', async () => {
    mockCreateGrant.mockRejectedValue({ response: { status: 429 } });
    renderPage();
    await screen.findByText('a.txt');

    fireEvent.click(screen.getByTestId('shared-folder-download-f1'));

    expect(await screen.findByText(/Слишком много запросов/i)).toBeInTheDocument();
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByTestId('shared-folder-file-f1')).toBeInTheDocument();
  });

  it('triggers a grant-based download for a file', async () => {
    renderPage();
    await screen.findByText('a.txt');

    fireEvent.click(screen.getByTestId('shared-folder-download-f1'));

    expect(await screen.findByText('a.txt')).toBeInTheDocument();
    expect(mockCreateGrant).toHaveBeenCalledWith('tok-1', 'f1');
    expect(mockTriggerNativeDownload).toHaveBeenCalledWith('https://hub/grant/abc');
  });
});
