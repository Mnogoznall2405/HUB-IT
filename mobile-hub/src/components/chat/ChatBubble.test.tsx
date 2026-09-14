import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ChatBubble } from './ChatBubble';

describe('ChatBubble pending delivery', () => {
  const message = { id: 'pending:queued', conversation_id: 'c1', sender_user_id: 1, body_text: 'Проверка' };

  afterEach(() => jest.useRealTimers());

  it('keeps fast online queue and sending transitions free of waiting text', async () => {
    jest.useFakeTimers();
    const view = await render(<ChatBubble isOwn awaitingConnection onDiscard={jest.fn()} message={{ ...message, local_status: 'failed' }} />);
    expect(view.queryByText('Ожидает подключения')).toBeNull();
    expect(view.queryByText('Убрать из очереди')).toBeNull();
    expect(view.getByTestId('chat-message-sending-spinner')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(300); });
    await view.rerender(<ChatBubble isOwn message={{ ...message, local_status: 'sending' }} />);
    await act(async () => { jest.advanceTimersByTime(300); });
    await view.rerender(<ChatBubble isOwn message={{ ...message, id: 'confirmed' }} />);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(view.queryByText('Ожидает отправки')).toBeNull();
    expect(view.queryByTestId('chat-message-sending-spinner')).toBeNull();
  });

  it('shows a delayed online send after 1.5 seconds across queue transitions', async () => {
    jest.useFakeTimers();
    const view = await render(<ChatBubble isOwn awaitingConnection message={{ ...message, local_status: 'failed' }} />);
    await act(async () => { jest.advanceTimersByTime(1000); });
    await view.rerender(<ChatBubble isOwn message={{ ...message, local_status: 'sending' }} />);
    await act(async () => { jest.advanceTimersByTime(499); });
    expect(view.queryByText('Ожидает отправки')).toBeNull();
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(view.getByText('Ожидает отправки')).toBeTruthy();
    await view.rerender(<ChatBubble isOwn message={{ ...message, id: 'confirmed' }} />);
    expect(view.queryByText('Ожидает отправки')).toBeNull();
  });

  it('shows connection loss immediately and hides waiting text on reconnect', async () => {
    jest.useFakeTimers();
    const view = await render(<ChatBubble isOwn awaitingConnection message={{ ...message, local_status: 'failed' }} />);
    await view.rerender(<ChatBubble isOwn offline awaitingConnection message={{ ...message, local_status: 'failed' }} />);
    expect(view.getByText('Ожидает подключения')).toBeTruthy();
    await view.rerender(<ChatBubble isOwn awaitingConnection message={{ ...message, local_status: 'failed' }} />);
    expect(view.queryByText('Ожидает подключения')).toBeNull();
    expect(view.queryByText('Ожидает отправки')).toBeNull();
  });

  it('shows failures and cancellation immediately', async () => {
    const view = await render(<ChatBubble isOwn message={{ ...message, local_status: 'failed' }} />);
    expect(view.getByText('Не отправлено · повторить')).toBeTruthy();
    await view.rerender(<ChatBubble isOwn message={{ ...message, local_status: 'cancelled' }} />);
    expect(view.getByText('Отправка отменена · повторить')).toBeTruthy();
  });

  it('shows a compact spinner without an extra sending text label', async () => {
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

    expect(view.getByTestId('chat-message-sending-spinner')).toBeTruthy();
    expect(view.getByLabelText('Сообщение отправляется')).toBeTruthy();
    expect(view.queryByText(/Отправляется/)).toBeNull();
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
