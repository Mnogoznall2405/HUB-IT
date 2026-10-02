import { act, render } from '@testing-library/react-native';
import { useMemo, useRef } from 'react';
import { View, type ListRenderItemInfo } from 'react-native';
import type { ChatConversationSummary, ChatMessage } from '../../api/types';
import type { ChatAttachmentTransfer } from '../../components/chat/ChatDocumentAttachment';
import {
  chatMessageMotionKey,
  type ChatMessageEnterKind,
} from '../../components/chat/ChatMessageEnterMotion';
import { useThreadRender } from './useThreadRender';

const mockBubbleRender = jest.fn();

jest.mock('../../components/chat/SwipeableChatBubble', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    SwipeableChatBubble: (props: { message: ChatMessage; album?: unknown }) => {
      mockBubbleRender(props.message.id);
      return React.createElement(View, null,
        props.album ? React.createElement(View, { testID: 'chat-media-album' }) : null,
        React.createElement(Text, null, props.message.body_text));
    },
  };
});

jest.mock('../../native/haptics', () => ({
  hapticSelection: jest.fn(async () => undefined),
}));

const textMessage = (id: string, body: string, createdAt: string, sender = 2): ChatMessage => ({
  id,
  conversation_id: 'conversation-1',
  sender_user_id: sender,
  sender: { id: sender, username: `user-${sender}`, full_name: `Участник ${sender}` },
  body_text: body,
  created_at: createdAt,
});

const photoMessage = (id: string, createdAt: string, sender = 2): ChatMessage => ({
  ...textMessage(id, '', createdAt, sender),
  attachments: [{
    id: `att-${id}`,
    kind: 'image',
    media_kind: 'image',
    mime_type: 'image/jpeg',
    file_name: `${id}.jpg`,
    url: `https://cdn.example/${id}.jpg`,
    preview_url: `https://cdn.example/${id}-preview.jpg`,
  }],
});

const noop = () => undefined;
const noopAsync = async () => undefined;

function RenderHarness({
  messages,
  conversation = null,
  motions,
}: {
  messages: ChatMessage[];
  conversation?: ChatConversationSummary | null;
  motions?: Map<string, ChatMessageEnterKind>;
}) {
  const attachmentTransfersRef = useRef<Record<string, ChatAttachmentTransfer>>({});
  const fallbackMotionsRef = useRef(new Map<string, ChatMessageEnterKind>());
  const messageEnterMotionsRef = useRef(motions ?? fallbackMotionsRef.current);
  const styles = useMemo(() => ({}), []);
  const { renderMessage } = useThreadRender({
    conversation,
    userId: 1,
    canWrite: true,
    canCompose: true,
    offlineMode: false,
    reduceMotion: true,
    messages,
    unreadBoundaryId: null,
    selectedMessageIds: [],
    highlightedMessageId: null,
    attachmentTransfersRef,
    messageEnterMotionsRef,
    setActionMessage: noop,
    setActionAnchor: noop,
    focusMessageById: noopAsync,
    openAttachment: noop,
    openAttachmentActions: noop,
    openForward: noopAsync,
    openPersonProfile: noop,
    openTask: noop,
    votePoll: noopAsync,
    closePoll: noopAsync,
    runAiAction: noopAsync,
    cancelAttachmentTransfer: noop,
    retryAttachmentTransfer: noop,
    startReply: noop,
    startSelection: noop,
    toggleReaction: noopAsync,
    toggleSelection: noop,
    showReactionUsers: noop,
    styles,
  });
  return (
    <View>
      {messages.map((item, index) => (
        <View key={chatMessageMotionKey(item)}>
          {renderMessage({ item, index } as unknown as ListRenderItemInfo<ChatMessage>)}
        </View>
      ))}
    </View>
  );
}

beforeEach(() => {
  mockBubbleRender.mockClear();
});

// T12: buildChatMediaAlbumMap returns fresh album objects for every rebuild;
// the render hook must keep album prop identity stable so album rows skip
// rerenders caused by unrelated messages.
it('does not rerender album rows when an unrelated message changes', async () => {
  const photoA = photoMessage('m-album-1', '2026-08-23T08:00:00Z');
  const photoB = photoMessage('m-album-2', '2026-08-23T08:01:00Z');
  const tail = textMessage('m-tail', 'Хвост', '2026-08-23T08:02:00Z');
  // Newest-first window: tail text + a two-photo album (m-album-1 is head).
  const view = await render(
    <RenderHarness messages={[tail, photoB, photoA]} />,
  );

  // Sanity: the album head renders the grid bubble, the collapsed member does not.
  expect(view.getByTestId('chat-media-album')).toBeTruthy();
  expect(mockBubbleRender.mock.calls.map(([id]) => id).sort()).toEqual(['m-album-1', 'm-tail']);

  mockBubbleRender.mockClear();
  const editedTail = { ...tail, body_text: 'Хвост (изменено)' };
  await act(async () => {
    view.rerender(<RenderHarness messages={[editedTail, photoB, photoA]} />);
  });

  // Only the edited row rerenders; both album members keep memo identity.
  expect(mockBubbleRender.mock.calls.map(([id]) => id)).toEqual(['m-tail']);
});

it('rerenders album rows when album content actually changes', async () => {
  const photoA = photoMessage('m-album-1', '2026-08-23T08:00:00Z');
  const photoB = photoMessage('m-album-2', '2026-08-23T08:01:00Z');
  const tail = textMessage('m-tail', 'Хвост', '2026-08-23T08:02:00Z');
  const view = await render(
    <RenderHarness messages={[tail, photoB, photoA]} />,
  );
  expect(view.getByTestId('chat-media-album')).toBeTruthy();

  mockBubbleRender.mockClear();
  // A captioned member changes the album caption → new album object → rerender.
  const captionedB = { ...photoB, body_text: 'Подпись альбома' };
  await act(async () => {
    view.rerender(<RenderHarness messages={[tail, captionedB, photoA]} />);
  });
  expect(mockBubbleRender.mock.calls.map(([id]) => id)).toContain('m-album-1');
});

// T15: enter-motion entries for rows that left the window before mounting
// must not replay a stale animation when the message re-enters the window.
it('prunes enter motions for messages that left the window before mounting', async () => {
  const motions = new Map<string, ChatMessageEnterKind>();
  const m1 = textMessage('m-1', 'Первое', '2026-08-23T08:00:00Z');
  const m2 = textMessage('m-2', 'Второе', '2026-08-23T08:01:00Z');
  const m3 = textMessage('m-3', 'Третье', '2026-08-23T08:02:00Z');

  const view = await render(<RenderHarness messages={[m1]} motions={motions} />);

  // A realtime insert recorded an enter motion, but the window was replaced
  // before that row ever mounted.
  motions.set(chatMessageMotionKey(m2), 'incoming');
  await act(async () => {
    view.rerender(<RenderHarness messages={[m3]} motions={motions} />);
  });
  expect(motions.has(chatMessageMotionKey(m2))).toBe(false);

  await act(async () => {
    view.rerender(<RenderHarness messages={[m3, m2]} motions={motions} />);
  });
  expect(view.queryByTestId('chat-message-enter-incoming')).toBeNull();
});

it('keeps the enter motion for a message that joins the current window', async () => {
  const motions = new Map<string, ChatMessageEnterKind>();
  const m1 = textMessage('m-1', 'Первое', '2026-08-23T08:00:00Z');
  const m2 = textMessage('m-2', 'Второе', '2026-08-23T08:01:00Z');

  const view = await render(<RenderHarness messages={[m1]} motions={motions} />);
  motions.set(chatMessageMotionKey(m2), 'incoming');
  await act(async () => {
    view.rerender(<RenderHarness messages={[m2, m1]} motions={motions} />);
  });
  expect(view.getByTestId('chat-message-enter-incoming')).toBeTruthy();
});
