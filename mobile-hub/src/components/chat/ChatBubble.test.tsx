import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ChatBubble } from './ChatBubble';

describe('ChatBubble pending delivery', () => {
  const message = { id: 'pending:queued', conversation_id: 'c1', sender_user_id: 1, body_text: 'Проверка' };

  afterEach(() => jest.useRealTimers());

  it('keeps fast online queue and sending transitions free of waiting text', async () => {
    jest.useFakeTimers();
    const view = await render(<ChatBubble isOwn awaitingConnection message={{ ...message, local_status: 'failed' }} />);
    expect(view.queryByText('Ожидает подключения')).toBeNull();
    expect(view.queryByText('Убрать из очереди')).toBeNull();
    expect(view.getByTestId('chat-message-sending-clock')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(300); });
    await view.rerender(<ChatBubble isOwn message={{ ...message, local_status: 'sending' }} />);
    await act(async () => { jest.advanceTimersByTime(300); });
    await view.rerender(<ChatBubble isOwn message={{ ...message, id: 'confirmed' }} />);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(view.queryByText('Ожидает отправки')).toBeNull();
    expect(view.queryByTestId('chat-message-sending-clock')).toBeNull();
  });

  it('never shows a delayed online send as error text inside the bubble', async () => {
    jest.useFakeTimers();
    const view = await render(<ChatBubble isOwn awaitingConnection message={{ ...message, local_status: 'failed' }} />);
    await act(async () => { jest.advanceTimersByTime(1000); });
    await view.rerender(<ChatBubble isOwn message={{ ...message, local_status: 'sending' }} />);
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(view.queryByText('Ожидает отправки')).toBeNull();
    expect(view.queryByText('Убрать из очереди')).toBeNull();
    expect(view.getByTestId('chat-message-sending-clock')).toBeTruthy();
    await view.rerender(<ChatBubble isOwn message={{ ...message, id: 'confirmed' }} />);
    expect(view.queryByTestId('chat-message-sending-clock')).toBeNull();
  });

  it('keeps the same clock icon on connection loss without inline error text', async () => {
    jest.useFakeTimers();
    const view = await render(<ChatBubble isOwn awaitingConnection message={{ ...message, local_status: 'failed' }} />);
    await view.rerender(<ChatBubble isOwn offline awaitingConnection message={{ ...message, local_status: 'failed' }} />);
    expect(view.queryByText('Ожидает подключения')).toBeNull();
    expect(view.queryByText('Убрать из очереди')).toBeNull();
    expect(view.getByTestId('chat-message-sending-clock')).toBeTruthy();
    await view.rerender(<ChatBubble isOwn awaitingConnection message={{ ...message, local_status: 'failed' }} />);
    expect(view.getByTestId('chat-message-sending-clock')).toBeTruthy();
    expect(view.queryByText('Ожидает отправки')).toBeNull();
  });

  it('marks failures and cancellation with a tappable alert outside the bubble', async () => {
    const onPress = jest.fn();
    const view = await render(<ChatBubble isOwn onPress={onPress} message={{ ...message, local_status: 'failed' }} />);
    expect(view.queryByText('Не отправлено · повторить')).toBeNull();
    expect(view.queryByText('Убрать из очереди')).toBeNull();
    const badge = view.getByLabelText('Не отправлено, нажмите, чтобы повторить');
    expect(badge).toBeTruthy();
    await fireEvent.press(badge);
    expect(onPress).toHaveBeenCalledTimes(1);
    await view.rerender(<ChatBubble isOwn onPress={onPress} message={{ ...message, local_status: 'cancelled' }} />);
    expect(view.getByLabelText('Отправка отменена, нажмите, чтобы повторить')).toBeTruthy();
    expect(view.queryByText('Отправка отменена · повторить')).toBeNull();
  });

  it('shows a clock icon without an extra sending text label', async () => {
    const view = await render(
      <ChatBubble
        isOwn
        message={{
          id: 'pending:message-1',
          conversation_id: 'conversation-1',
          sender_user_id: 1,
          body_text: 'Проверка',
          created_at: '2026-08-27T10:00:00Z',
          is_own: true,
          local_status: 'sending',
        }}
      />,
    );

    expect(view.getByTestId('chat-message-sending-clock')).toBeTruthy();
    expect(view.getByLabelText('Сообщение отправляется')).toBeTruthy();
    expect(view.queryByText(/Отправляется/)).toBeNull();
    expect(view.queryByLabelText('Не отправлено, нажмите, чтобы повторить')).toBeNull();
  });
});

describe('ChatDeliveryStatus glyph transitions', () => {
  const message = { id: 'm1', conversation_id: 'c1', sender_user_id: 1, body_text: 'same text', created_at: '2026-09-05T10:00:00Z' };

  afterEach(() => jest.restoreAllMocks());

  it('swaps the single check for a double check exactly once when read arrives', async () => {
    const view = await render(<ChatBubble isOwn message={{ ...message, delivery_status: 'sent' }} />);
    expect(view.getByLabelText('Отправлено')).toBeTruthy();
    await view.rerender(<ChatBubble isOwn message={{ ...message, delivery_status: 'read' }} />);
    expect(view.getByLabelText('Прочитано')).toBeTruthy();
    expect(view.queryByLabelText('Отправлено')).toBeNull();
  });

  it('crossfades once per status change when motion is allowed', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const timingSpy = jest.spyOn(Animated, 'timing');
    const view = await render(<ChatBubble isOwn message={{ ...message, delivery_status: 'sent' }} />);
    await act(async () => { await Promise.resolve(); });
    const baseline = timingSpy.mock.calls.length;
    await view.rerender(<ChatBubble isOwn message={{ ...message, delivery_status: 'read' }} />);
    await act(async () => { await Promise.resolve(); });
    expect(timingSpy.mock.calls.length).toBe(baseline + 1);
  });

  it('changes the glyph instantly without animation under reduced motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const timingSpy = jest.spyOn(Animated, 'timing');
    const view = await render(<ChatBubble isOwn message={{ ...message, delivery_status: 'sent' }} />);
    await act(async () => { await Promise.resolve(); });
    const baseline = timingSpy.mock.calls.length;
    await view.rerender(<ChatBubble isOwn message={{ ...message, delivery_status: 'read' }} />);
    await act(async () => { await Promise.resolve(); });
    expect(timingSpy.mock.calls.length).toBe(baseline);
    expect(view.getByLabelText('Прочитано')).toBeTruthy();
  });
});

it('reserves the same delivery slot for sending, sent, read and failed', async () => {
  const message = { id: 'm1', conversation_id: 'c1', sender_user_id: 1, body_text: 'same text', created_at: '2026-09-05T10:00:00Z' };
  const view = await render(<ChatBubble isOwn message={{ ...message, local_status: 'sending' }} />);
  const initial = StyleSheet.flatten(view.getByTestId('chat-delivery-status').props.style);
  for (const state of [{ delivery_status: 'sent' as const }, { delivery_status: 'read' as const }, { local_status: 'failed' as const }]) {
    await view.rerender(<ChatBubble isOwn message={{ ...message, ...state }} />);
    expect(StyleSheet.flatten(view.getByTestId('chat-delivery-status').props.style)).toEqual(initial);
  }
});

describe('ChatBubble attachment upload overlay', () => {
  const photoMessage = {
    id: 'pending:p-1',
    conversation_id: 'c1',
    sender_user_id: 1,
    local_status: 'sending' as const,
    attachments: [{
      id: 'pending-attachment:c1:0',
      kind: 'image' as const,
      mime_type: 'image/jpeg',
      file_name: 'photo.jpg',
      local_uri: 'file:///cache/photo.jpg',
    }],
  };

  it('shows an indeterminate sending state instead of a stuck 0%', async () => {
    const view = await render(
      <ChatBubble
        isOwn
        message={photoMessage}
        attachmentTransfers={{ 'pending-attachment:c1:0': { action: 'upload', progress: 0, status: 'active', cancellable: true } }}
        onAttachmentTransferCancel={jest.fn()}
      />,
    );

    expect(view.getByText('Отправка…')).toBeTruthy();
    expect(view.queryByText(/0%/)).toBeNull();
  });

  it('shows a spinning ring inside the control when progress has not started and there is no action', async () => {
    const view = await render(
      <ChatBubble
        isOwn
        message={photoMessage}
        attachmentTransfers={{ 'pending-attachment:c1:0': { action: 'upload', progress: null, status: 'active', cancellable: false } }}
      />,
    );

    expect(view.getByTestId('chat-transfer-indeterminate')).toBeTruthy();
    expect(view.queryByText(/0%/)).toBeNull();
    expect(view.getByText('Отправка…')).toBeTruthy();
  });

  it('shows the real percentage once upload progress arrives', async () => {
    const view = await render(
      <ChatBubble
        isOwn
        message={photoMessage}
        attachmentTransfers={{ 'pending-attachment:c1:0': { action: 'upload', progress: 0.42, status: 'active', cancellable: true } }}
        onAttachmentTransferCancel={jest.fn()}
      />,
    );

    expect(view.getByText('Отправка 42%')).toBeTruthy();
    expect(view.queryByText('Отправка…')).toBeNull();
  });
});

it('renders a playable video preview instead of a document row', async () => {
  const attachment = { id: 'video-1', kind: 'video' as const, mime_type: 'video/mp4', file_name: 'clip.mp4',
    variant_urls: { poster: '/api/v1/chat/poster.jpg' }, original_url: '/api/v1/chat/clip.mp4' };
  const onOpen = jest.fn();
  const view = await render(<ChatBubble isOwn onAttachmentPress={onOpen} message={{
    id: 'v1', conversation_id: 'c1', sender_user_id: 1, attachments: [attachment],
  }} />);
  await fireEvent.press(view.getByLabelText('Воспроизвести видео clip.mp4'));
  expect(onOpen).toHaveBeenCalledWith(attachment);
  expect(view.getByTestId('chat-video-preview')).toBeTruthy();
});

it('keeps an explicitly uploaded video document as a file', async () => {
  const view = await render(<ChatBubble isOwn message={{
    id: 'v1', conversation_id: 'c1', sender_user_id: 1,
    attachments: [{ id: 'v1', media_kind: 'file', mime_type: 'video/mp4', file_name: 'clip.mp4' }],
  }} />);
  expect(view.queryByTestId('chat-video-preview')).toBeNull();
  expect(view.getByText('clip.mp4')).toBeTruthy();
});

it('shows a playable video card when a poster has not been generated', async () => {
  const view = await render(<ChatBubble isOwn onAttachmentPress={jest.fn()} message={{
    id: 'v1', conversation_id: 'c1', sender_user_id: 1,
    attachments: [{ id: 'v1', mime_type: 'video/mp4', file_name: 'clip.mp4', original_url: '/api/v1/chat/clip.mp4' }],
  }} />);
  expect(view.getByLabelText('Воспроизвести видео clip.mp4')).toBeTruthy();
  expect(view.getByTestId('chat-video-preview')).toBeTruthy();
});
