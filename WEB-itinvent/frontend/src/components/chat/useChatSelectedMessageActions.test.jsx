import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useChatSelectedMessageActions from './useChatSelectedMessageActions';

function Harness({ selectedMessages, clipboardWriteText, setForwardOpen, setReplyMessage }) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteText },
  });

  const actions = useChatSelectedMessageActions({
    clearSelectedMessages: vi.fn(),
    focusComposer: vi.fn(),
    loadChatDialogsModule: vi.fn(),
    normalizeForwardMessageQueue: (messages) => messages,
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
});
