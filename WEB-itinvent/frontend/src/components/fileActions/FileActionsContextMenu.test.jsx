import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMocks = vi.hoisted(() => ({
  native: false,
  requestOpen: vi.fn(),
}));

vi.mock('../../lib/platform', () => ({
  isNativeShellRuntime: () => bridgeMocks.native,
}));

vi.mock('../../lib/desktopBridge', () => ({
  requestDesktopOpenDownloadedFile: bridgeMocks.requestOpen,
}));

import FileActionsContextMenu, {
  canOpenInDesktopApplication,
  getFileActionsAnchorPosition,
  isFileActionsKeyboardShortcut,
} from './FileActionsContextMenu';

describe('FileActionsContextMenu', () => {
  beforeEach(() => {
    bridgeMocks.native = false;
    bridgeMocks.requestOpen.mockReset();
    bridgeMocks.requestOpen.mockReturnValue(true);
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
    expect(screen.queryByRole('menuitem', { name: 'Открыть в приложении' })).not.toBeInTheDocument();
  });

  it('opens a supported document through the Desktop bridge before downloading it', () => {
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

    fireEvent.click(screen.getByRole('menuitem', { name: 'Открыть в приложении' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bridgeMocks.requestOpen).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledTimes(1);
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

    expect(screen.queryByRole('menuitem', { name: 'Открыть в приложении' })).not.toBeInTheDocument();
    expect(canOpenInDesktopApplication('document.PDF')).toBe(true);
    expect(canOpenInDesktopApplication('archive.zip')).toBe(false);
  });

  it('supports pointer and keyboard context-menu anchors', () => {
    expect(getFileActionsAnchorPosition({ clientX: 120, clientY: 80 })).toEqual({ left: 120, top: 80 });
    expect(isFileActionsKeyboardShortcut({ key: 'ContextMenu' })).toBe(true);
    expect(isFileActionsKeyboardShortcut({ key: 'F10', shiftKey: true })).toBe(true);
    expect(isFileActionsKeyboardShortcut({ key: 'F10', shiftKey: false })).toBe(false);
  });
});
