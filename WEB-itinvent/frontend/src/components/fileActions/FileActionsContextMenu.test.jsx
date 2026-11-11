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
    expect(bridgeMocks.requestAction).toHaveBeenCalledWith('open');
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
    expect(screen.getByRole('menuitem', { name: 'Быстрая печать' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Сохранить как' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Сохранить все вложения…' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Копировать' })).toBeVisible();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Быстрая печать' }));
    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));
    expect(bridgeMocks.requestAction).toHaveBeenCalledWith('print');
  });

  it('supports pointer and keyboard context-menu anchors', () => {
    expect(getFileActionsAnchorPosition({ clientX: 120, clientY: 80 })).toEqual({ left: 120, top: 80 });
    expect(isFileActionsKeyboardShortcut({ key: 'ContextMenu' })).toBe(true);
    expect(isFileActionsKeyboardShortcut({ key: 'F10', shiftKey: true })).toBe(true);
    expect(isFileActionsKeyboardShortcut({ key: 'F10', shiftKey: false })).toBe(false);
  });
});
