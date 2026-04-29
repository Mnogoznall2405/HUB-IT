import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useChatMessageMenuActions from './useChatMessageMenuActions';

function Harness({
  activeConversationIdRef = { current: 'conv-active' },
  clipboardWriteText = vi.fn().mockResolvedValue(undefined),
  persistPinnedMessage = vi.fn(),
  pinnedMessage = null,
  setMessageMenuAnchor = vi.fn(),
  setMessageMenuMessage = vi.fn(),
  setSelectedMessageIds = vi.fn(),
}) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteText },
  });

  const actions = useChatMessageMenuActions({
    activeConversationIdRef,
    buildPinnedMessagePayload: (message) => ({ id: message?.id, preview: message?.body || '' }),
    focusComposer: vi.fn(),
    loadChatDialogsModule: vi.fn(),
    notifyInfo: vi.fn(),
    notifySuccess: vi.fn(),
    notifyWarning: vi.fn(),
    openMediaViewer: vi.fn(),
    openMessageReads: vi.fn(),
    openTaskFromChat: vi.fn(),
    persistPinnedMessage,
    pinnedMessage,
    setComposerMenuAnchor: vi.fn(),
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setReplyMessage: vi.fn(),
    setSelectedMessageIds,
    setThreadMenuAnchor: vi.fn(),
  });

  return (
    <>
      <button type="button" onClick={() => actions.handleCopyMessageLink({ id: 'msg-1' })}>copy link</button>
      <button type="button" onClick={() => actions.handleTogglePinMessageFromMenu({ id: 'msg-2', body: 'Pinned' })}>pin</button>
      <button type="button" onClick={() => actions.startMessageSelection({ id: 'msg-3' })}>select</button>
      <button
        type="button"
        onClick={() => actions.openMessageMenu(
          { id: 'msg-4' },
          { anchorPosition: { top: 12.4, left: 98.8 } },
        )}
      >
        open menu
      </button>
    </>
  );
}

describe('useChatMessageMenuActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies stable message links with the active conversation fallback', async () => {
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);

    render(<Harness clipboardWriteText={clipboardWriteText} />);

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith('http://localhost:3000/chat?conversation=conv-active&message=msg-1');
    });
  });

  it('pins, unpins, selects, and opens menu anchors without page state in Chat.jsx', () => {
    const persistPinnedMessage = vi.fn();
    const setSelectedMessageIds = vi.fn();
    const setMessageMenuAnchor = vi.fn();
    const setMessageMenuMessage = vi.fn();

    const { rerender } = render(
      <Harness
        persistPinnedMessage={persistPinnedMessage}
        setMessageMenuAnchor={setMessageMenuAnchor}
        setMessageMenuMessage={setMessageMenuMessage}
        setSelectedMessageIds={setSelectedMessageIds}
      />,
    );

    fireEvent.click(document.querySelectorAll('button')[1]);
    expect(persistPinnedMessage).toHaveBeenCalledWith({ id: 'msg-2', preview: 'Pinned' });

    rerender(
      <Harness
        persistPinnedMessage={persistPinnedMessage}
        pinnedMessage={{ id: 'msg-2' }}
        setMessageMenuAnchor={setMessageMenuAnchor}
        setMessageMenuMessage={setMessageMenuMessage}
        setSelectedMessageIds={setSelectedMessageIds}
      />,
    );
    fireEvent.click(document.querySelectorAll('button')[1]);
    expect(persistPinnedMessage).toHaveBeenCalledWith(null);

    fireEvent.click(document.querySelectorAll('button')[2]);
    expect(setSelectedMessageIds).toHaveBeenCalledWith(expect.any(Function));

    fireEvent.click(document.querySelectorAll('button')[3]);
    expect(setMessageMenuMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-4' }));
    expect(setMessageMenuAnchor).toHaveBeenCalledWith(expect.objectContaining({
      anchorPosition: { top: 12, left: 99 },
      anchorReference: 'anchorPosition',
    }));
  });
});
