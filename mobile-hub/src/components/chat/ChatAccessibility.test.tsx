import { render } from '@testing-library/react-native';
import { ChatBubble } from './ChatBubble';
import { ChatComposer } from './ChatComposer';

describe('native Chat accessibility', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('announces sender, message state, and delivery state', async () => {
    const incoming = await render(
      <ChatBubble
        isOwn={false}
        message={{
          id: 'message-incoming',
          conversation_id: 'conversation-1',
          sender_user_id: 2,
          sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
          body_text: 'Проверь документ',
          created_at: '2026-08-23T08:00:00Z',
          edited_at: '2026-08-23T08:01:00Z',
        }}
      />,
    );

    expect(incoming.getByLabelText(/Сообщение от Мария Иванова.*Проверь документ.*Изменено/)).toBeTruthy();

    const own = await render(
      <ChatBubble
        isOwn
        message={{
          id: 'message-own',
          conversation_id: 'conversation-1',
          sender_user_id: 1,
          body_text: 'Готово',
          created_at: '2026-08-23T08:02:00Z',
          delivery_status: 'read',
        }}
      />,
    );

    expect(own.getByLabelText(/Ваше сообщение.*Готово.*Прочитано/)).toBeTruthy();
  });

  it('announces pending and failed delivery without inline error text', async () => {
    const pending = await render(
      <ChatBubble
        isOwn
        message={{
          id: 'pending-1',
          conversation_id: 'conversation-1',
          sender_user_id: 1,
          body_text: 'Ещё отправляется',
          created_at: '2026-08-23T08:03:00Z',
          local_status: 'sending',
        }}
      />,
    );

    expect(pending.getByLabelText(/Ваше сообщение.*Ещё отправляется.*Отправляется/)).toBeTruthy();
    expect(pending.getByLabelText('Сообщение отправляется')).toBeTruthy();
    expect(pending.queryByText('Ожидает отправки')).toBeNull();

    const failed = await render(
      <ChatBubble
        isOwn
        message={{
          id: 'failed-1',
          conversation_id: 'conversation-1',
          sender_user_id: 1,
          body_text: 'Не ушло',
          created_at: '2026-08-23T08:04:00Z',
          local_status: 'failed',
        }}
      />,
    );

    expect(failed.getByLabelText(/Ваше сообщение.*Не ушло.*Не отправлено/)).toBeTruthy();
    expect(failed.getByLabelText('Не отправлено, нажмите, чтобы повторить')).toBeTruthy();
    expect(failed.queryByText('Не отправлено · повторить')).toBeNull();
  });

  it('exposes determinate upload progress to TalkBack', async () => {
    const screen = await render(
      <ChatComposer
        value=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        uploadLabel="Отправляем: report.pdf"
        uploadProgress={0.42}
      />,
    );

    expect(screen.queryByLabelText('Записать голосовое')).toBeNull();
    const progress = screen.getByRole('progressbar', { name: 'Отправляем: report.pdf' });
    expect(progress.props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 42,
      text: '42 процентов',
    });
  });

  it('shows a live recording waveform instead of a static red label', async () => {
    const screen = await render(
      <ChatComposer
        value=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        voiceRecording
        voiceDurationLabel="0:12"
        voiceLevel={0.64}
        onCancelVoice={jest.fn()}
        onSendVoice={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('Запись голосового сообщения 0:12')).toBeTruthy();
    expect(screen.getByTestId('chat-voice-recording-activity', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('chat-voice-recording-waveform', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getAllByTestId('chat-voice-recording-bar', { includeHiddenElements: true })).toHaveLength(18);
    expect(screen.getByText('0:12')).toBeTruthy();
  });

  it('shows slide-to-cancel hint while the mic is held', async () => {
    const screen = await render(
      <ChatComposer
        value=""
        onChangeText={jest.fn()}
        onSend={jest.fn()}
        voiceRecording
        voiceDurationLabel="0:03"
        voiceHoldLocked={false}
        voiceHoldHint="cancel"
        onCancelVoice={jest.fn()}
        onSendVoice={jest.fn()}
      />,
    );

    expect(screen.getByText('Отпустите, чтобы отменить')).toBeTruthy();
    expect(screen.queryByLabelText('Отправить голосовое')).toBeNull();
  });
});
