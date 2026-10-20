// Reproduce races and transitions through real hooks and UI actions.
// The transport delay is controlled; message/edit/read/pin state belongs to the app.
import React, { useRef, useState } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useChatComposerSending from './useChatComposerSending';
import useChatSelectedMessageActions from './useChatSelectedMessageActions';
import useChatMessageMenuActions from './useChatMessageMenuActions';
import useChatSocketEvents from './useChatSocketEvents';
import useChatScheduledMessages from './useChatScheduledMessages';
import useChatReactionAndPinController from '../../pages/chat/useChatReactionAndPinController';
import useChatThreadInteractionController from '../../pages/chat/useChatThreadInteractionController';
import { buildOptimisticTextMessage } from '../../pages/chat/chatOptimisticMessages';
import { chatAPI } from '../../api/client';
import { chatScheduledAPI } from '../../api/chatScheduled';
import { chatSocket, CHAT_SOCKET_CONVERSATION_UPDATED_EVENT, CHAT_SOCKET_AI_RUN_UPDATED_EVENT } from '../../lib/chatSocket';

vi.mock('../../api/client', () => ({ chatAPI: {
  sendMessage: vi.fn(), editChatMessage: vi.fn(), setPinnedMessage: vi.fn(),
} }));
vi.mock('../../api/chatScheduled', () => ({ chatScheduledAPI: { list: vi.fn(), create: vi.fn() } }));
vi.mock('../../api/chatConfig', () => ({ getChatConfigCached: async () => ({ scheduled_messages_enabled: true }) }));
vi.mock('../../lib/chatFeature', () => ({ CHAT_WS_ENABLED: true, CHAT_FEATURE_ENABLED: true }));
vi.mock('../../lib/chatSocket', async importOriginal => {
  const original = await importOriginal();
  return { ...original, chatSocket: { isOpen: () => false, getConnectionState: () => 'connected' } };
});
vi.mock('../feedback/ConfirmDialogProvider', () => ({ useConfirmDialog: () => ({ confirm: vi.fn() }) }));

beforeEach(() => {
  vi.resetAllMocks();
  chatAPI.sendMessage.mockImplementation(async (conversationId, body, options) => ({
    id: `server-${options.client_message_id}`, conversation_id: conversationId, body,
    client_message_id: options.client_message_id, is_own: true,
  }));
  chatAPI.editChatMessage.mockResolvedValue({ id: 'own-old', conversation_id: 'A' });
});
afterEach(() => vi.restoreAllMocks());
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

function ComposerProbe({ drain, initiallyEditing = false }) {
  const [conversationId, setConversationId] = useState('A');
  const [text, setText] = useState('send from A');
  const [editingMessage, setEditingMessage] = useState(initiallyEditing ? { id: 'own-old', conversation_id: 'A', body: 'old' } : null);
  const [replyMessage, setReplyMessage] = useState(null);
  const [selected, setSelected] = useState([{ id: 'other-message', conversation_id: 'A', body: 'question' }]);
  const activeConversationIdRef = useRef(conversationId); activeConversationIdRef.current = conversationId;
  const latestMessageTextRef = useRef(text); latestMessageTextRef.current = text;
  const sequence = useRef(0);
  const api = useChatComposerSending({
    activeConversation: { id: conversationId, kind: 'direct' }, activeConversationId: conversationId, activeConversationIdRef,
    applyOutgoingThreadMessage: vi.fn(), ensureLatestThreadWindow: () => drain?.promise,
    buildReplyPreview: message => message, cancelPendingInitialAnchor: vi.fn(),
    createOptimisticTextMessage: values => buildOptimisticTextMessage({ ...values, user: { id: 1 }, seq: ++sequence.current }),
    draftWriteTimeoutRef: useRef(null), failedThreadMessagesRef: useRef(new Map()), editingMessage,
    flushDraftToStorage: vi.fn(), focusComposer: vi.fn(), latestMessageTextRef, logChatDebug: vi.fn(),
    mergeMessageIntoThread: vi.fn(), notifyApiError: vi.fn(), readSelectedDatabaseId: () => '', removeThreadMessage: vi.fn(),
    replyMessage, setEditingMessage, setMessageText: setText, setOptimisticAiQueuedStatus: vi.fn(), setReplyMessage,
    socketStatusRef: useRef('disconnected'), userId: 1,
  });
  const selectedActions = useChatSelectedMessageActions({
    activeConversationIdRef, clearSelectedMessages: () => setSelected([]), conversationKind: 'direct',
    viewerMemberRole: 'member', focusComposer: vi.fn(), selectedMessages: selected, setReplyMessage, setEditingMessage,
  });
  return <>
    <input aria-label="draft" value={text} onChange={e => setText(e.target.value)} />
    <button onClick={api.handleComposerSend}>Send</button>
    <button onClick={() => { setConversationId('B'); setText('valuable draft in B'); }}>Switch to B</button>
    <button onClick={selectedActions.replyToSelectedMessage}>Reply selected</button>
    <output aria-label="reply">{replyMessage?.id || ''}</output>
  </>;
}

it('P1: repeated Send during history loading must create only one message', async () => {
  const drain = deferred(); render(<ComposerProbe drain={drain} />);
  fireEvent.click(screen.getByText('Send')); fireEvent.click(screen.getByText('Send'));
  await act(async () => { drain.resolve(); });
  await waitFor(() => expect(chatAPI.sendMessage.mock.calls.length).toBeGreaterThan(0));
  expect(chatAPI.sendMessage).toHaveBeenCalledTimes(1);
});

it('P1: finishing a send in A must preserve the newly opened B draft', async () => {
  const drain = deferred(); render(<ComposerProbe drain={drain} />);
  fireEvent.click(screen.getByText('Send')); fireEvent.click(screen.getByText('Switch to B'));
  expect(screen.getByLabelText('draft')).toHaveValue('valuable draft in B');
  await act(async () => { drain.resolve(); });
  expect(screen.getByLabelText('draft')).toHaveValue('valuable draft in B');
});

it('P1: replying to a selected message must exit previous message editing', async () => {
  render(<ComposerProbe initiallyEditing />);
  fireEvent.click(screen.getByText('Reply selected'));
  expect(screen.getByLabelText('reply')).toHaveTextContent('other-message');
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'answer to question' } });
  fireEvent.click(screen.getByText('Send'));
  await waitFor(() => expect(chatAPI.sendMessage.mock.calls.length + chatAPI.editChatMessage.mock.calls.length).toBeGreaterThan(0));
  expect(chatAPI.editChatMessage).not.toHaveBeenCalled();
  expect(chatAPI.sendMessage).toHaveBeenCalledWith('A', 'answer to question', expect.objectContaining({ reply_to_message_id: 'other-message' }));
});

function SocketProbe({ nearBottom = true } = {}) {
  const [conversation, setConversation] = useState({ id: 'A', unread_count: 2 });
  const [typingUsers, setTypingUsers] = useState([]);
  useChatSocketEvents({
    activeConversation: { id: 'A', kind: 'direct' }, activeConversationIdRef: useRef('A'),
    aiRunStartedAtByConversationRef: useRef({}), applyMessageReadDelta: vi.fn(), buildActiveThreadPollLoadOptions: () => ({}),
    conversationsLoadingRef: useRef(false), hasPendingInitialAnchorForConversation: () => false,
    hasPersistedThreadMessageEquivalent: () => false, lastConversationsLoadAtRef: useRef(0),
    latestActiveThreadSocketMessageRef: useRef(null), loadConversations: vi.fn(), loadMessages: vi.fn(), loadMessagesRef: useRef(vi.fn()),
    logChatDebug: vi.fn(), logChatDebugRef: useRef(vi.fn()), markConversationReadLiveRef: useRef(vi.fn()), markSocketActivity: vi.fn(),
    mergeAiStatusPayload: (current, payload, id) => ({ ...current, [id]: payload }), mergeMessageIntoThread: vi.fn(),
    messagesHasNewerRef: useRef(false), messagesLoadingRef: useRef(false), messagesRef: useRef([]),
    promoteConversationToTop: vi.fn(), queueAutoScroll: vi.fn(), setAiStatusByConversation: vi.fn(), setMessages: vi.fn(),
    setSocketStatus: vi.fn(), setTypingUsers, setViewerLastReadAt: vi.fn(), setViewerLastReadMessageId: vi.fn(),
    shouldSkipActiveThreadRevalidate: () => true, skippedInitialSnapshotRefreshRef: useRef(true), skippedInitialSocketRefreshRef: useRef(true),
    socketStatusRef: useRef('connected'), syncConversationPreview: vi.fn(), threadNearBottomRef: useRef(nearBottom),
    typingParticipantsTimeoutsRef: useRef(new Map()), updatePresenceInCollections: vi.fn(), upsertConversation: setConversation, userId: 1,
  });
  return <><output aria-label="unread">{conversation.unread_count}</output><output aria-label="typing">{typingUsers.join(', ')}</output></>;
}

it('P2: an unfocused open conversation must keep server unread count', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(false); render(<SocketProbe />);
  act(() => window.dispatchEvent(new CustomEvent(CHAT_SOCKET_CONVERSATION_UPDATED_EVENT, { detail: { payload: {
    reason: 'message_created', conversation: { id: 'A', unread_count: 2, viewer_last_read_seq: 10, last_message_seq: 12 },
  } } })));
  expect(screen.getByLabelText('unread')).toHaveTextContent('2');
});

it('P2: an AI run in B must not show a typing indicator in direct conversation A', () => {
  render(<SocketProbe />);
  act(() => window.dispatchEvent(new CustomEvent(CHAT_SOCKET_AI_RUN_UPDATED_EVENT, { detail: { conversation_id: 'B', payload: {
    conversation_id: 'B', status: 'running', run_id: 'run-B', bot_title: 'HUB Assistant',
  } } })));
  expect(screen.getByLabelText('typing')).toBeEmptyDOMElement();
});

function ScheduledProbe() {
  const [conversationId, setConversationId] = useState('A');
  const scheduled = useChatScheduledMessages({ conversationId });
  return <><button onClick={scheduled.reload}>Reload scheduled</button>
    <button onClick={() => setConversationId('B')}>Switch scheduled to B</button>
    <button onClick={() => scheduled.schedule('planned', '2030-01-01T00:00:00Z')}>Schedule</button>
    <output aria-label="schedule count">{scheduled.items.length}</output>
    <output aria-label="scheduled IDs">{scheduled.items.map(item => item.id).join(',')}</output>
    {scheduled.error ? <div role="alert">{scheduled.error}</div> : null}
  </>;
}
it('P2: failed scheduled-list loading must not pretend there are no scheduled messages', async () => {
  chatScheduledAPI.list.mockResolvedValueOnce([{ id: 'scheduled-1', status: 'scheduled' }]);
  render(<ScheduledProbe />);
  await waitFor(() => expect(screen.getByLabelText('schedule count')).toHaveTextContent('1'));
  chatScheduledAPI.list.mockRejectedValueOnce(new Error('503'));
  fireEvent.click(screen.getByText('Reload scheduled'));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByLabelText('schedule count')).toHaveTextContent('1');
  expect(screen.getByRole('alert')).toBeVisible();
});

function UnpinProbe() {
  const [conversationId, setConversationId] = useState('A');
  const [pin, setPin] = useState({ id: 'pinned-1' });
  const [notice, setNotice] = useState('');
  const activeConversationIdRef = useRef(conversationId); activeConversationIdRef.current = conversationId;
  const pinnedMessageMutationRef = useRef(0);
  const api = useChatReactionAndPinController({ activeConversationIdRef, pinnedMessageMutationRef,
    notifyApiError: (_error, message) => setNotice(message), notifyInfo: vi.fn(),
    persistPinnedMessage: setPin, pinnedMessage: pin, revealMessage: vi.fn(), setMessages: vi.fn() });
  const menu = useChatMessageMenuActions({ activeConversationIdRef, pinnedMessageMutationRef,
    buildPinnedMessagePayload: message => ({ id: message.id, preview: message.body }),
    persistPinnedMessage: setPin, pinnedMessage: pin, notifyWarning: setNotice,
    setMessageMenuAnchor: vi.fn(), setMessageMenuMessage: vi.fn(),
  });
  return <><output aria-label="pin">{pin?.id || ''}</output><button onClick={api.handleUnpinPinnedMessage}>Unpin</button>
    <button onClick={() => menu.handleTogglePinMessageFromMenu({ id: 'pinned-2', body: 'next pin' })}>Pin next</button>
    <button onClick={() => { setConversationId('B'); setPin({ id: 'pin-in-B' }); }}>Switch pin to B</button>
    {notice ? <div role="alert">{notice}</div> : null}
  </>;
}
it('P2: rejected unpin must restore the actually pinned message', async () => {
  chatAPI.setPinnedMessage.mockRejectedValueOnce(new Error('403'));
  render(<UnpinProbe />); fireEvent.click(screen.getByText('Unpin'));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByLabelText('pin')).toHaveTextContent('pinned-1');
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось открепить сообщение.');
});

it('CONTROL: a single send after the history drain creates one message', async () => {
  const drain = deferred(); render(<ComposerProbe drain={drain} />);
  fireEvent.click(screen.getByText('Send'));
  await act(async () => { drain.resolve(); });
  fireEvent.click(screen.getByText('Send'));
  expect(chatAPI.sendMessage).toHaveBeenCalledTimes(1);
});

it('CONTROL: selected reply without a previous edit sends a new reply', async () => {
  render(<ComposerProbe />); fireEvent.click(screen.getByText('Reply selected'));
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'answer' } });
  fireEvent.click(screen.getByText('Send'));
  await act(async () => { await Promise.resolve(); });
  expect(chatAPI.editChatMessage).not.toHaveBeenCalled();
  expect(chatAPI.sendMessage).toHaveBeenCalledWith('A', 'answer', expect.objectContaining({ reply_to_message_id: 'other-message' }));
});

it('CONTROL: when away from the bottom the server unread count is preserved', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(false); render(<SocketProbe nearBottom={false} />);
  act(() => window.dispatchEvent(new CustomEvent(CHAT_SOCKET_CONVERSATION_UPDATED_EVENT, { detail: { payload: {
    reason: 'message_created', conversation: { id: 'A', unread_count: 2, viewer_last_read_seq: 10, last_message_seq: 12 },
  } } })));
  expect(screen.getByLabelText('unread')).toHaveTextContent('2');
});

it('preserves newly typed text while the earlier draft waits for history', async () => {
  const drain = deferred(); render(<ComposerProbe drain={drain} />);
  fireEvent.click(screen.getByText('Send'));
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'next draft' } });
  await act(async () => { drain.resolve(); });
  expect(screen.getByLabelText('draft')).toHaveValue('next draft');
  expect(chatAPI.sendMessage).toHaveBeenCalledWith('A', 'send from A', expect.any(Object));
  fireEvent.click(screen.getByText('Send'));
  await act(async () => { await Promise.resolve(); });
  expect(chatAPI.sendMessage).toHaveBeenLastCalledWith('A', 'next draft', expect.any(Object));
});

it('leaves the draft retryable when history loading fails before sending', async () => {
  const drain = deferred(); render(<ComposerProbe drain={drain} />);
  fireEvent.click(screen.getByText('Send'));
  await act(async () => { drain.reject(new Error('history timeout')); });
  expect(screen.getByLabelText('draft')).toHaveValue('send from A');
  expect(chatAPI.sendMessage).not.toHaveBeenCalled();
});

it('ignores a background AI completion when the active AI run is still typing', () => {
  render(<SocketProbe />);
  act(() => {
    for (const [id, status] of [['A', 'running'], ['B', 'completed']]) {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_AI_RUN_UPDATED_EVENT, { detail: { conversation_id: id, payload: {
        conversation_id: id, status, run_id: `run-${id}`, bot_title: 'HUB Assistant',
      } } }));
    }
  });
  expect(screen.getByLabelText('typing')).toHaveTextContent('HUB Assistant');
});

it('keeps the original pin until a replacement is confirmed and preserves it on rejection', async () => {
  const replacement = deferred(); chatAPI.setPinnedMessage.mockReturnValueOnce(replacement.promise);
  render(<UnpinProbe />); fireEvent.click(screen.getByText('Pin next'));
  expect(screen.getByLabelText('pin')).toHaveTextContent('pinned-1');
  await act(async () => { replacement.reject(new Error('503')); });
  expect(screen.getByLabelText('pin')).toHaveTextContent('pinned-1');
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось закрепить сообщение на сервере.');
});

it('a delayed pin response never replaces the pin of a different conversation', async () => {
  const replacement = deferred(); chatAPI.setPinnedMessage.mockReturnValueOnce(replacement.promise);
  render(<UnpinProbe />); fireEvent.click(screen.getByText('Pin next'));
  fireEvent.click(screen.getByText('Switch pin to B'));
  await act(async () => { replacement.resolve({ pinned_message: { id: 'pinned-2' } }); });
  expect(screen.getByLabelText('pin')).toHaveTextContent('pin-in-B');
});

it('the menu and header share ordering so an older pin response cannot undo a newer unpin', async () => {
  const replacement = deferred(); const removal = deferred();
  chatAPI.setPinnedMessage.mockReturnValueOnce(replacement.promise).mockReturnValueOnce(removal.promise);
  render(<UnpinProbe />); fireEvent.click(screen.getByText('Pin next')); fireEvent.click(screen.getByText('Unpin'));
  await act(async () => { removal.resolve({ pinned_message: null }); });
  expect(screen.getByLabelText('pin')).toBeEmptyDOMElement();
  await act(async () => { replacement.resolve({ pinned_message: { id: 'pinned-2' } }); });
  expect(screen.getByLabelText('pin')).toBeEmptyDOMElement();
});

it('a failed scheduled operation in A does not clear or show errors in B', async () => {
  const creation = deferred(); chatScheduledAPI.create.mockReturnValueOnce(creation.promise);
  chatScheduledAPI.list.mockImplementation(async id => [{ id: `scheduled-${id}`, status: 'scheduled' }]);
  render(<ScheduledProbe />);
  await waitFor(() => expect(screen.getByLabelText('scheduled IDs')).toHaveTextContent('scheduled-A'));
  fireEvent.click(screen.getByText('Schedule')); fireEvent.click(screen.getByText('Switch scheduled to B'));
  await waitFor(() => expect(screen.getByLabelText('scheduled IDs')).toHaveTextContent('scheduled-B'));
  await act(async () => { creation.reject(new Error('503')); });
  expect(screen.getByLabelText('scheduled IDs')).toHaveTextContent('scheduled-B');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('automatically retries scheduled-list errors and clears the stale-state warning on recovery', async () => {
  vi.useFakeTimers();
  try {
    chatScheduledAPI.list.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce([{ id: 'recovered', status: 'failed' }]);
    render(<ScheduledProbe />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить отложенные сообщения.');
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(screen.getByLabelText('scheduled IDs')).toHaveTextContent('recovered');
    expect(screen.queryByRole('alert')).toBeNull();
  } finally { vi.useRealTimers(); }
});

it('a successful scheduled action from the old conversation cannot clear the new composer', async () => {
  const creation = deferred(); chatScheduledAPI.create.mockReturnValueOnce(creation.promise);
  chatScheduledAPI.list.mockImplementation(async id => [{ id: `scheduled-${id}`, status: 'failed' }]);
  const { result, rerender } = renderHook(({ id }) => useChatScheduledMessages({ conversationId: id }), { initialProps: { id: 'A' } });
  await waitFor(() => expect(result.current.items[0]?.id).toBe('scheduled-A'));
  let action;
  act(() => { action = result.current.schedule('text in A', '2030-01-01T00:00:00Z'); });
  rerender({ id: 'B' });
  await waitFor(() => expect(result.current.items[0]?.id).toBe('scheduled-B'));
  let completion;
  await act(async () => { creation.resolve({ id: 'created-in-A' }); completion = await action; });
  expect(completion).toBeNull();
  expect(result.current.items[0]?.id).toBe('scheduled-B');
});

it('finishing an old history load does not scroll the newly opened conversation', async () => {
  const history = deferred(); const activeConversationIdRef = { current: 'A' };
  const scrollThreadBottomIntoView = vi.fn();
  const { result } = renderHook(() => useChatThreadInteractionController({
    activeConversationIdRef, cancelPendingInitialAnchor: vi.fn(), loadMessages: () => history.promise,
    logChatDebug: vi.fn(), messagesHasNewerRef: { current: true }, queueAutoScroll: vi.fn(),
    scrollThreadBottomIntoView, setShowJumpToLatest: vi.fn(),
    showJumpToLatestRef: { current: true }, threadNearBottomRef: { current: false },
  }));
  let loading;
  act(() => { loading = result.current.ensureLatestThreadWindow(); });
  activeConversationIdRef.current = 'B';
  await act(async () => { history.resolve([]); await loading; });
  expect(scrollThreadBottomIntoView).not.toHaveBeenCalled();
});
