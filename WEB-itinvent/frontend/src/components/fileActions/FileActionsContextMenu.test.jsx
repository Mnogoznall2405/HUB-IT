import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMocks = vi.hoisted(() => ({
  native: false,
  capabilities: new Set(),
  requestAction: vi.fn(),
}));

vi.mock('../../lib/platform', () => ({
  isNativeShellRuntime: () => bridgeMocks.native,
}));

vi.mock('../../lib/desktopBridge', () => ({
  isDesktopCapabilityAvailable: (capability) => bridgeMocks.capabilities.has(capability),
  requestDesktopDownloadedFileAction: bridgeMocks.requestAction,
}));

import FileActionsContextMenu, {
  canOpenInDesktopApplication,
  canPrintInDesktopApplication,
  getFileActionsAnchorPosition,
  isFileActionsKeyboardShortcut,
} from './FileActionsContextMenu';

describe('FileActionsContextMenu', () => {
  beforeEach(() => {
    bridgeMocks.native = false;
    bridgeMocks.capabilities.clear();
    bridgeMocks.requestAction.mockReset();
    bridgeMocks.requestAction.mockResolvedValue({ accepted: true, status: 'accepted' });
  });

  it('shows only download in a regular browser', () => {
    render(
      <FileActionsContextMenu
        open
        anchorPosition={{ left: 10, top: 10 }}
        fileName="report.docx"
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.getByRole('menuitem', { name: 'Скачать' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Открыть' })).not.toBeInTheDocument();
  });

  it('opens a supported document through the Desktop bridge before downloading it', async () => {
    bridgeMocks.native = true;
    const onClose = vi.fn();
    const onDownload = vi.fn();
    render(
      <FileActionsContextMenu
        open
        anchorPosition={{ left: 10, top: 10 }}
        fileName="report.xlsx"
        onClose={onClose}
        onDownload={onDownload}
      />,
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Открыть' }));

    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bridgeMocks.requestAction).toHaveBeenCalledWith('open', 'report.xlsx', '');
  });

  it('keeps the menu open and explains when another open request is busy', async () => {
    bridgeMocks.native = true;
    bridgeMocks.requestAction.mockResolvedValue({ accepted: false, status: 'busy' });
    const onClose = vi.fn();
    const onDownload = vi.fn();
    render(
      <FileActionsContextMenu
        open
        anchorPosition={{ left: 10, top: 10 }}
        fileName="report.pdf"
        onClose={onClose}
        onDownload={onDownload}
      />,
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Открыть' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Дождитесь завершения текущей загрузки');
    expect(onDownload).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not offer unsupported files to the Windows application handler', () => {
    bridgeMocks.native = true;
    render(
      <FileActionsContextMenu
        open
        anchorPosition={{ left: 10, top: 10 }}
        fileName="archive.zip"
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.queryByRole('menuitem', { name: 'Открыть' })).not.toBeInTheDocument();
    expect(canOpenInDesktopApplication('document.PDF')).toBe(true);
    expect(canOpenInDesktopApplication('archive.zip')).toBe(false);
  });

  it('shows the complete Outlook-style action set in a capable desktop host', async () => {
    bridgeMocks.native = true;
    bridgeMocks.capabilities.add('file-actions-v2');
    const onPreview = vi.fn();
    const onDownload = vi.fn();
    const onSaveAll = vi.fn();
    render(
      <FileActionsContextMenu
        open
        anchorPosition={{ left: 10, top: 10 }}
        fileName="report.pdf"
        onClose={vi.fn()}
        onPreview={onPreview}
        onDownload={onDownload}
        onSaveAll={onSaveAll}
      />,
    );

    expect(screen.getByRole('menuitem', { name: 'Просмотр' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Открыть' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Сохранить как' })).toBeVisible();

    // «Копировать» — единственный пункт группы «Организовать», поэтому поднят на верхний уровень.
    expect(screen.getByRole('menuitem', { name: 'Копировать' })).toBeVisible();

    // Печать и массовое сохранение живут в группе «Дополнительно».
    fireEvent.click(screen.getByTestId('file-action-group-more'));
    expect(screen.getByRole('menuitem', { name: 'Быстрая печать' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Сохранить все вложения…' })).toBeVisible();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Быстрая печать' }));
    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));
    expect(bridgeMocks.requestAction).toHaveBeenCalledWith('print', 'report.pdf', '');
  });

  it('closes the open flyout when the pointer settles on a plain menu row', async () => {
    render(
      <FileActionsContextMenu
        open
        anchorPosition={{ left: 10, top: 10 }}
        fileName="report.pdf"
        onClose={vi.fn()}
        onDownload={vi.fn()}
        onRename={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('file-action-group-organize'));
    expect(screen.getByRole('menuitem', { name: 'Переименовать' })).toBeVisible();

    // A quick pass over «Удалить» on the way into the flyout does not close it…
    fireEvent.mouseEnter(screen.getByTestId('file-action-delete'));
    expect(screen.getByRole('menuitem', { name: 'Переименовать' })).toBeVisible();
    fireEvent.mouseLeave(screen.getByTestId('file-action-delete'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.getByRole('menuitem', { name: 'Переименовать' })).toBeVisible();

    // …but lingering on the plain row past the intent delay collapses the flyout.
    fireEvent.mouseEnter(screen.getByTestId('file-action-delete'));
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Переименовать' })).not.toBeInTheDocument());
    expect(screen.getByRole('menuitem', { name: 'Удалить' })).toBeVisible();
  });

  it('routes every action to its own handler, inside groups too', async () => {
    const handlers = {
      onPreview: vi.fn(),
      onEditOnline: vi.fn(),
      onDownload: vi.fn(),
      onCollaborators: vi.fn(),
      onShare: vi.fn(),
      onRevokeShare: vi.fn(),
      onToggleFavorite: vi.fn(),
      onRename: vi.fn(),
      onMove: vi.fn(),
      onCopyTo: vi.fn(),
      onSelectAll: vi.fn(),
      onDetails: vi.fn(),
      onVersions: vi.fn(),
      onAudit: vi.fn(),
      onExportPdf: vi.fn(),
      onDelete: vi.fn(),
    };
    // Simpler and more reliable: verify each item once per fresh render.
    const cases = [
      ['file-action-preview', 'onPreview'],
      ['file-action-edit-online', 'onEditOnline'],
      ['file-action-download', 'onDownload'],
      ['file-action-collaborators', 'onCollaborators', 'file-action-group-share'],
      ['file-action-share', 'onShare', 'file-action-group-share'],
      ['file-action-revoke-share', 'onRevokeShare', 'file-action-group-share'],
      ['file-action-favorite', 'onToggleFavorite', 'file-action-group-organize'],
      ['file-action-rename', 'onRename', 'file-action-group-organize'],
      ['file-action-move', 'onMove', 'file-action-group-organize'],
      ['file-action-copy-to', 'onCopyTo', 'file-action-group-organize'],
      ['file-action-select-all', 'onSelectAll', 'file-action-group-organize'],
      ['file-action-details', 'onDetails', 'file-action-group-more'],
      ['file-action-versions', 'onVersions', 'file-action-group-more'],
      ['file-action-audit', 'onAudit', 'file-action-group-more'],
      ['file-action-export-pdf', 'onExportPdf', 'file-action-group-more'],
      ['file-action-delete', 'onDelete'],
    ];
    for (const [testId, expectedKey, groupId] of cases) {
      const { unmount } = render(
        <FileActionsContextMenu
          open
          anchorPosition={{ left: 10, top: 10 }}
          fileName="report.pdf"
          isShared
          onClose={vi.fn()}
          {...handlers}
        />,
      );
      if (groupId) {
        fireEvent.click(screen.getByTestId(groupId));
        expect(await screen.findByTestId(testId)).toBeVisible();
      }
      fireEvent.click(screen.getByTestId(testId));
      await waitFor(() => expect(handlers[expectedKey]).toHaveBeenCalledTimes(1));
      Object.values(handlers).forEach((fn) => fn.mockClear());
      unmount();
    }
  });

  it('keeps the caller-provided delete label (mail attachments)', () => {
    const onDelete = vi.fn();
    render(
      <FileActionsContextMenu
        open
        anchorPosition={{ left: 10, top: 10 }}
        fileName="scan.pdf"
        onClose={vi.fn()}
        onDelete={onDelete}
        deleteLabel="Удалить вложение"
      />,
    );
    const item = screen.getByRole('menuitem', { name: 'Удалить вложение' });
    expect(item).toBeVisible();
    fireEvent.click(item);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('supports pointer and keyboard context-menu anchors', () => {
    expect(getFileActionsAnchorPosition({ clientX: 120, clientY: 80 })).toEqual({ left: 120, top: 80 });
    expect(isFileActionsKeyboardShortcut({ key: 'ContextMenu' })).toBe(true);
    expect(isFileActionsKeyboardShortcut({ key: 'F10', shiftKey: true })).toBe(true);
    expect(isFileActionsKeyboardShortcut({ key: 'F10', shiftKey: false })).toBe(false);
  });

  it('never offers print for photos even when photo opening is allowed', () => {
    bridgeMocks.native = true;
    bridgeMocks.capabilities.add('file-actions-v2');
    bridgeMocks.capabilities.add('file-actions-v4');
    render(
      <FileActionsContextMenu
        open
        anchorPosition={{ left: 10, top: 10 }}
        fileName="photo.jpg"
        allowPhotoOpen
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.getByRole('menuitem', { name: 'Открыть' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Печать' })).not.toBeInTheDocument();
  });

  it('hides photo opening without the chat opt-in even on a v4 shell', () => {
    bridgeMocks.native = true;
    bridgeMocks.capabilities.add('file-actions-v2');
    bridgeMocks.capabilities.add('file-actions-v4');
    render(
      <FileActionsContextMenu
        open
        anchorPosition={{ left: 10, top: 10 }}
        fileName="photo.jpg"
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.queryByRole('menuitem', { name: 'Открыть' })).not.toBeInTheDocument();
  });

  it('hides photo opening when the shell lacks file-actions-v4', () => {
    bridgeMocks.native = true;
    bridgeMocks.capabilities.add('file-actions-v2');
    bridgeMocks.capabilities.add('file-actions-v3');
    render(
      <FileActionsContextMenu
        open
        anchorPosition={{ left: 10, top: 10 }}
        fileName="photo.jpg"
        allowPhotoOpen
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.queryByRole('menuitem', { name: 'Открыть' })).not.toBeInTheDocument();
  });

  it('passes the download reference to the bridge for exact binding', async () => {
    bridgeMocks.native = true;
    bridgeMocks.capabilities.add('file-actions-v2');
    bridgeMocks.capabilities.add('file-actions-v4');
    render(
      <FileActionsContextMenu
        open
        anchorPosition={{ left: 10, top: 10 }}
        fileName="report.docx"
        downloadRef="/api/v1/chat/attachments/some-uuid/download"
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Открыть' }));
    await waitFor(() => expect(bridgeMocks.requestAction).toHaveBeenCalled());
    expect(bridgeMocks.requestAction).toHaveBeenCalledWith(
      'open',
      'report.docx',
      '/api/v1/chat/attachments/some-uuid/download',
    );
  });
});

describe('desktop text-file open policy', () => {
  it.each(['notes.txt', 'app.log', 'readme.md', 'config.json', 'settings.yaml', 'query.sql'])(
    'allows opening %s in the Windows application',
    (fileName) => {
      expect(canOpenInDesktopApplication(fileName)).toBe(true);
    },
  );

  it.each(['script.ps1', 'job.bat', 'tool.cmd', 'run.sh', 'page.js'])(
    'never opens script-like %s in the Windows application',
    (fileName) => {
      expect(canOpenInDesktopApplication(fileName, { allowPhotos: true })).toBe(false);
    },
  );

  it('keeps text files out of the print channel', () => {
    expect(canPrintInDesktopApplication('notes.txt')).toBe(false);
    expect(canPrintInDesktopApplication('report.docx')).toBe(true);
  });
});
