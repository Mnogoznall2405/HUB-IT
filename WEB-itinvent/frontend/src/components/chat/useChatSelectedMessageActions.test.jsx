import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import useChatSelectedMessageActions from './useChatSelectedMessageActions';

vi.mock('../../api/client', () => ({
  chatAPI: {
    deleteChatMessage: vi.fn(),
  },
}));

function Harness({
  selectedMessages,
  clipboardWriteText,
  setForwardOpen,
  setReplyMessage,
  clearSelectedMessages = vi.fn(),
  mergeMessageIntoThread = vi.fn(),
}) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteText },
  });

  const actions = useChatSelectedMessageActions({
    activeConversationIdRef: { current: 'c1' },
    clearSelectedMessages,
    conversationKind: 'direct',
    focusComposer: vi.fn(),
    loadChatDialogsModule: vi.fn(),
    mergeMessageIntoThread,
    normalizeForwardMessageQueue: (messages) => messages,
    notifyApiError: vi.fn(),
    notifySuccess: vi.fn(),
    notifyWarning: vi.fn(),
    selectedMessages,
    setComposerMenuAnchor: vi.fn(),
    setForwardConversationQuery: vi.fn(),
    setForwardMessages: vi.fn(),
    setForwardOpen,
    setMessageMenuAnchor: vi.fn(),
    setMessageMenuMessage: vi.fn(),
    setReplyMessage,
    setThreadMenuAnchor: vi.fn(),
  });

  return (
    <>
      <button type="button" onClick={actions.copySelectedMessages}>copy</button>
      <button type="button" onClick={actions.openForwardSelectedMessages}>forward</button>
      <button type="button" onClick={actions.replyToSelectedMessage}>reply</button>
      <button type="button" onClick={actions.deleteSelectedMessages}>delete</button>
    </>
  );
}

describe('useChatSelectedMessageActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies selected message previews and opens forward dialog', async () => {
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    const setForwardOpen = vi.fn();
    const setReplyMessage = vi.fn();
    const selectedMessages = [
      { id: 'm1', body: 'First' },
      { id: 'm2', body: 'Second' },
    ];

    render(
      <Harness
        selectedMessages={selectedMessages}
        clipboardWriteText={clipboardWriteText}
        setForwardOpen={setForwardOpen}
        setReplyMessage={setReplyMessage}
      />,
    );

    fireEvent.click(document.querySelector('button'));
    await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith('First\n\nSecond'));

    fireEvent.click(document.querySelectorAll('button')[1]);
    expect(setForwardOpen).toHaveBeenCalledWith(true);
    expect(setReplyMessage).not.toHaveBeenCalled();
  });

  it('deletes selected own messages through chatAPI and clears selection', async () => {
    const clearSelectedMessages = vi.fn();
    const mergeMessageIntoThread = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    chatAPI.deleteChatMessage.mockResolvedValue({ id: 'm1', is_deleted: true });

    render(
      <Harness
        selectedMessages={[{ id: 'm1', conversation_id: 'c1', is_own: true, body: 'Hi' }]}
        clipboardWriteText={vi.fn()}
        setForwardOpen={vi.fn()}
        setReplyMessage={vi.fn()}
        clearSelectedMessages={clearSelectedMessages}
        mergeMessageIntoThread={mergeMessageIntoThread}
      />,
    );

    fireEvent.click(document.querySelectorAll('button')[3]);

    await waitFor(() => {
      expect(chatAPI.deleteChatMessage).toHaveBeenCalledWith('c1', 'm1');
      expect(mergeMessageIntoThread).toHaveBeenCalledWith({ id: 'm1', is_deleted: true });
      expect(clearSelectedMessages).toHaveBeenCalledTimes(1);
    });

    confirmSpy.mockRestore();
  });
});
