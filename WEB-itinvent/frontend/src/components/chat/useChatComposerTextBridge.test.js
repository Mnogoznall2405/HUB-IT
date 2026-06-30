import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useChatComposerTextBridge from './useChatComposerTextBridge';

describe('useChatComposerTextBridge', () => {
  it('exposes stable bridge with subscribe/getSnapshot for composer isolation', () => {
    let messageText = 'hello';
    const setMessageText = vi.fn((next) => {
      messageText = next;
    });

    const { result, rerender } = renderHook(
      ({ text }) => useChatComposerTextBridge({
        messageText: text,
        setMessageText,
        onComposerKeyDown: vi.fn(),
        onComposerSelectionSync: vi.fn(),
      }),
      { initialProps: { text: messageText } },
    );

    const bridge = result.current;
    expect(bridge.getSnapshot()).toBe('hello');
    expect(typeof bridge.subscribe).toBe('function');
    expect(typeof bridge.setMessageText).toBe('function');

    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);

    act(() => {
      bridge.setMessageText('world');
    });

    expect(setMessageText).toHaveBeenCalledWith('world');
    expect(listener).toHaveBeenCalled();
    expect(bridge.getSnapshot()).toBe('world');

    rerender({ text: 'world' });
    expect(result.current).toBe(bridge);

    unsubscribe();
  });
});
