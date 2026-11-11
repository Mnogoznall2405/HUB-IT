import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useMailKeyboardShortcuts from './useMailKeyboardShortcuts';

function press(key, target) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  (target || window).dispatchEvent(event);
  return event;
}

describe('useMailKeyboardShortcuts', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('opens compose and ignores the same key while typing', () => {
    const openCompose = vi.fn();
    renderHook(() => useMailKeyboardShortcuts({ openCompose }));

    act(() => {
      press('c');
    });
    expect(openCompose).toHaveBeenCalledTimes(1);

    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      press('c', input);
    });
    expect(openCompose).toHaveBeenCalledTimes(1);
  });

  it('refreshes on R and closes shortcuts help on Escape', () => {
    const invalidateMailClientCache = vi.fn();
    const refreshList = vi.fn();
    const refreshFolderSummary = vi.fn();
    const setShortcutsOpen = vi.fn();
    renderHook(() => useMailKeyboardShortcuts({
      invalidateMailClientCache,
      refreshList,
      refreshFolderSummary,
      shortcutsOpen: true,
      setShortcutsOpen,
    }));

    act(() => {
      press('R');
      press('Escape');
    });

    expect(invalidateMailClientCache).toHaveBeenCalledTimes(1);
    expect(refreshList).toHaveBeenCalledWith({ force: true });
    expect(refreshFolderSummary).toHaveBeenCalledTimes(1);
    expect(setShortcutsOpen).toHaveBeenCalledWith(false);
  });

  it('moves selection with arrows only inside the message list', () => {
    const selectAdjacentMessage = vi.fn();
    renderHook(() => useMailKeyboardShortcuts({ selectAdjacentMessage }));

    act(() => {
      press('ArrowDown');
    });
    expect(selectAdjacentMessage).not.toHaveBeenCalled();

    const list = document.createElement('div');
    list.setAttribute('data-mail-message-list', 'true');
    const row = document.createElement('button');
    list.appendChild(row);
    document.body.appendChild(list);
    act(() => {
      press('ArrowDown', row);
    });
    expect(selectAdjacentMessage).toHaveBeenCalledWith(1);
  });
});
