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
