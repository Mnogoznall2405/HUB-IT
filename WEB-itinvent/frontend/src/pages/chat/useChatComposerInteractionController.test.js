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

  describe('ArrowUp in an empty composer', () => {
    const thread = [
      { id: 'm1', kind: 'text', is_own: true, body: 'старое своё' },
      { id: 'm2', kind: 'text', is_own: true, body: 'последнее своё текстовое' },
      { id: 'm3', kind: 'file', is_own: true, body: '', attachments: [{ id: 'a1' }] },
      { id: 'm4', kind: 'text', is_own: true, body: 'удалённое', is_deleted: true },
      { id: 'm5', kind: 'text', is_own: false, body: 'чужое' },
      { id: 'tmp', kind: 'text', is_own: true, body: 'ещё отправляется', isOptimistic: true },
    ];

    const setup = (overrides = {}) => {
      const deps = {
        focusComposer: vi.fn(),
        handleComposerSend: vi.fn(),
        setEditingMessage: vi.fn(),
        setMessageText: vi.fn(),
        setReplyMessage: vi.fn(),
        messages: thread,
        ...overrides,
      };
      const { result } = renderHook(() => useChatComposerInteractionController(deps));
      const press = (eventOverrides = {}) => {
        const event = {
          key: 'ArrowUp',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          nativeEvent: { isComposing: false },
          currentTarget: { value: '', selectionStart: 0, selectionEnd: 0 },
          preventDefault: vi.fn(),
          ...eventOverrides,
        };
        act(() => { result.current.handleComposerKeyDown(event); });
        return event;
      };
      return { deps, press };
    };

    it('starts editing the last own editable message the same way as the menu «Изменить»', () => {
      const { deps, press } = setup();
      const event = press();

      expect(event.preventDefault).toHaveBeenCalled();
      expect(deps.setEditingMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2' }));
      expect(deps.setMessageText).toHaveBeenCalledWith('последнее своё текстовое');
      expect(deps.setReplyMessage).toHaveBeenCalledWith(null);
      expect(deps.focusComposer).toHaveBeenCalled();
      expect(deps.handleComposerSend).not.toHaveBeenCalled();
    });

    it.each([
      ['text in the field', {}, { currentTarget: { value: 'черновик', selectionStart: 0, selectionEnd: 0 } }],
      ['caret not at the start', {}, { currentTarget: { value: ' ', selectionStart: 1, selectionEnd: 1 } }],
      ['shift modifier', {}, { shiftKey: true }],
      ['alt modifier', {}, { altKey: true }],
      ['IME composition', {}, { nativeEvent: { isComposing: true } }],
      ['reply mode', { replyMessage: { id: 'm5' } }, {}],
      ['already editing', { editingMessage: { id: 'm1' } }, {}],
      ['emoji picker open', { emojiPickerOpen: true }, {}],
      ['message selection mode', { selectedMessageCount: 2 }, {}],
      ['mobile layout', { isMobile: true }, {}],
      ['newer history not loaded', { messagesHasNewer: true }, {}],
      ['no editable own messages', { messages: thread.slice(2) }, {}],
    ])('keeps the native ArrowUp behaviour with %s', (_label, depsOverrides, eventOverrides) => {
      const { deps, press } = setup(depsOverrides);
      const event = press(eventOverrides);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(deps.setEditingMessage).not.toHaveBeenCalled();
      expect(deps.setMessageText).not.toHaveBeenCalled();
    });
  });
});
