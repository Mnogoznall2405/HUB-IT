import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import useChatComposerInteractionController from './useChatComposerInteractionController';

describe('useChatComposerInteractionController', () => {
  it('handleComposerKeyDown sends on Enter without shift', () => {
    const handleComposerSend = vi.fn();
    const { result } = renderHook(() => useChatComposerInteractionController({
      focusComposer: vi.fn(),
      handleComposerSend,
      setEditingMessage: vi.fn(),
      setMessageText: vi.fn(),
      setReplyMessage: vi.fn(),
    }));

    const event = {
      key: 'Enter',
      shiftKey: false,
      repeat: false,
      nativeEvent: { isComposing: false },
      preventDefault: vi.fn(),
    };

    act(() => {
      result.current.handleComposerKeyDown(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(handleComposerSend).toHaveBeenCalled();
  });

  it('clearReplyMessage clears reply and focuses composer', () => {
    const focusComposer = vi.fn();
    const setReplyMessage = vi.fn();
    const { result } = renderHook(() => useChatComposerInteractionController({
      focusComposer,
      handleComposerSend: vi.fn(),
      setEditingMessage: vi.fn(),
      setMessageText: vi.fn(),
      setReplyMessage,
    }));

    act(() => {
      result.current.clearReplyMessage();
    });

    expect(setReplyMessage).toHaveBeenCalledWith(null);
    expect(focusComposer).toHaveBeenCalled();
  });
});
