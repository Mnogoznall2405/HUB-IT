import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useChatMessageMenuActions from './useChatMessageMenuActions';

vi.mock('../../api/client', () => ({
  chatAPI: {
    pinMessage: vi.fn(),
    unpinMessage: vi.fn(),
  },
}));

import { chatAPI } from '../../api/client';

function Harness({
  activeConversationIdRef = { current: 'conv-active' },
  clipboardWriteText = vi.fn().mockResolvedValue(undefined),
  notifyInfo = vi.fn(),
  notifyWarning = vi.fn(),
  applyPinnedMessages = vi.fn(),
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
    notifyInfo,
    notifySuccess: vi.fn(),
    notifyWarning,
    openMediaViewer: vi.fn(),
    openMessageReads: vi.fn(),
    openTaskFromChat: vi.fn(),
    applyPinnedMessages,
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
      <button type="button" onClick={() => actions.handleCopyMessage({ id: 'msg-5', kind: 'text', body: 'Текст' })}>copy text</button>
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

  it('confirms a copied message with a short toast and reports clipboard failures instead', async () => {
    const notifyInfo = vi.fn();
    const notifyWarning = vi.fn();
    const ok = render(<Harness notifyInfo={notifyInfo} notifyWarning={notifyWarning} />);
    fireEvent.click(ok.getByRole('button', { name: 'copy text' }));
    await waitFor(() => expect(notifyInfo).toHaveBeenCalledWith('Скопировано', expect.any(Object)));
    expect(notifyWarning).not.toHaveBeenCalled();
    ok.unmount();

    notifyInfo.mockClear();
    const denied = render(
      <Harness
        clipboardWriteText={vi.fn().mockRejectedValue(new Error('NotAllowedError'))}
        notifyInfo={notifyInfo}
        notifyWarning={notifyWarning}
      />,
    );
    fireEvent.click(denied.getByRole('button', { name: 'copy text' }));
    await waitFor(() => expect(notifyWarning).toHaveBeenCalledWith('Не удалось скопировать сообщение.'));
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it('commits pinning after the server response, then unpins and opens selection/menu anchors', async () => {
    const applyPinnedMessages = vi.fn();
    const setSelectedMessageIds = vi.fn();
    const setMessageMenuAnchor = vi.fn();
    const setMessageMenuMessage = vi.fn();
    let finishPin;
    chatAPI.pinMessage.mockImplementationOnce(() => new Promise(resolve => { finishPin = resolve; }));
    chatAPI.unpinMessage.mockResolvedValueOnce({ items: [] });

    const { rerender } = render(
      <Harness
        applyPinnedMessages={applyPinnedMessages}
        setMessageMenuAnchor={setMessageMenuAnchor}
        setMessageMenuMessage={setMessageMenuMessage}
        setSelectedMessageIds={setSelectedMessageIds}
      />,
    );

    fireEvent.click(document.querySelectorAll('button')[1]);
    expect(applyPinnedMessages).not.toHaveBeenCalled();
    await act(async () => { finishPin({ items: [{ id: 'msg-2' }] }); });
    expect(applyPinnedMessages).toHaveBeenCalledWith([{ id: 'msg-2' }]);
    expect(chatAPI.pinMessage).toHaveBeenCalledWith('conv-active', 'msg-2');

    rerender(
      <Harness
        applyPinnedMessages={applyPinnedMessages}
        pinnedMessage={{ id: 'msg-2' }}
        setMessageMenuAnchor={setMessageMenuAnchor}
        setMessageMenuMessage={setMessageMenuMessage}
        setSelectedMessageIds={setSelectedMessageIds}
      />,
    );
    fireEvent.click(document.querySelectorAll('button')[1]);
    await waitFor(() => expect(applyPinnedMessages).toHaveBeenLastCalledWith([]));
    expect(chatAPI.unpinMessage).toHaveBeenCalledWith('conv-active', 'msg-2');

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
