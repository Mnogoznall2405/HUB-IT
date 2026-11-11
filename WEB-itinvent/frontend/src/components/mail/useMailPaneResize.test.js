import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailPaneResize from './useMailPaneResize';

describe('useMailPaneResize', () => {
  it('clamps live CSS updates and persists only on commit', () => {
    const setProperty = vi.fn();
    const persistMailPaneSize = vi.fn();
    const desktopMailAreaRef = { current: { style: { setProperty } } };

    const { result } = renderHook(() => useMailPaneResize({
      desktopMailAreaRef,
      persistMailPaneSize,
    }));

    result.current.handleFolderPaneResize(80);
    result.current.handleMessageListResize(900, { commit: true });
    result.current.handleBottomListResize(50, { commit: true });

    expect(setProperty).toHaveBeenNthCalledWith(1, '--mail-folder-pane-width', '180px');
    expect(setProperty).toHaveBeenNthCalledWith(2, '--mail-message-list-width', '720px');
    expect(setProperty).toHaveBeenNthCalledWith(3, '--mail-bottom-list-percent', '50%');
    expect(persistMailPaneSize).toHaveBeenCalledTimes(2);
    expect(persistMailPaneSize).toHaveBeenNthCalledWith(1, 'message_list_width', 720);
    expect(persistMailPaneSize).toHaveBeenNthCalledWith(2, 'bottom_list_percent', 50);
  });
});
