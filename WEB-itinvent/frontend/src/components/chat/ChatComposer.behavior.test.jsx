import React, { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatComposer from './ChatComposer';
import { CHAT_MESSAGE_BODY_MAX_LENGTH } from './chatHelpers';
import { buildChatUiTokens } from './chatUiTokens';

vi.mock('emoji-picker-react', () => ({ default: () => null }));
const agentAccessState = vi.hoisted(() => ({ current: { allowed: true, loading: false, error: false } }));
vi.mock('./useAiAgentAccess', () => ({ default: () => agentAccessState.current }));
const theme = createTheme();
const candidates = [{ id: 1, full_name: 'Анна Иванова', username: 'anna' }, { id: 2, full_name: 'Борис Петров', username: 'boris' }];
function Fixture({ initialText = '', ui, ...props }) {
  const [text, setText] = useState(initialText);
  const ref = useRef(null);
  return <ThemeProvider theme={theme}><ChatComposer theme={theme} ui={ui || buildChatUiTokens(theme)} compactMobile={false}
    activeConversationId="chat" selectedFiles={[]} composerRef={ref} messageText={text} onMessageTextChange={setText}
    mentionCandidates={candidates} {...props} /></ThemeProvider>;
}
const input = () => screen.getByRole('textbox', { name: 'Сообщение' });

beforeEach(() => {
  agentAccessState.current = { allowed: true, loading: false, error: false };
});

describe('Telegram-style composer interactions', () => {
  it.each([
    [{ allowed: false, loading: true, error: false }, 'Проверяем доступ к агенту'],
    [{ allowed: false, loading: false, error: true }, 'Не удалось проверить доступ к агенту'],
    [{ allowed: false, loading: false, error: false }, 'Доступ к агенту не предоставлен'],
  ])('replaces the composer input with a status notice for agent access state %j', (state, text) => {
    agentAccessState.current = state;
    render(<Fixture isAiConversation />);
    expect(screen.getByRole('status')).toHaveTextContent(text);
    expect(screen.queryByRole('textbox', { name: 'Сообщение' })).not.toBeInTheDocument();
  });
  it('renders the composer when agent access is allowed', () => {
    render(<Fixture isAiConversation />);
    expect(input()).toBeInTheDocument();
  });
  it('cancels voice recording with Escape', () => {
    const cancel = vi.fn();
    render(<Fixture voiceRecording onCancelVoiceRecording={cancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('announces voice recording and returns focus to the input when it ends', () => {
    const { rerender } = render(<Fixture voiceRecording />);
    expect(screen.getByRole('status')).toHaveTextContent('Идёт запись голосового сообщения');
    rerender(<Fixture voiceRecording={false} />);
    expect(input()).toHaveFocus();
  });
  it('caps the message at the server limit and shows the remaining count near it', () => {
    render(<Fixture initialText={'а'.repeat(CHAT_MESSAGE_BODY_MAX_LENGTH - 10)} />);
    expect(input()).toHaveAttribute('maxLength', String(CHAT_MESSAGE_BODY_MAX_LENGTH));
    expect(screen.getByText('10')).toBeInTheDocument();
  });
  it('exposes expanded state on the emoji toggle and the mention listbox', () => {
    render(<Fixture emojiPickerOpen />);
    expect(screen.getByRole('button', { name: 'Закрыть панель эмодзи' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(input(), { target: { value: '@' } });
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input()).toHaveAttribute('aria-expanded', 'false');
  });
  it('describes the adaptive keyboard hint to the input', () => {
    render(<Fixture />);
    expect(input()).toHaveAttribute('aria-describedby');
    fireEvent.change(input(), { target: { value: '@' } });
    expect(screen.getByText(/Enter — упомянуть/)).toBeInTheDocument();
  });
  it('follows the compact desktop capsule height', () => {
    render(<Fixture ui={buildChatUiTokens(theme, { compactDesktop: true })} />);
    expect(screen.getByTestId('chat-composer-capsule')).toHaveStyle({ minHeight: '34px' });
  });

  it('keeps a disabled save action instead of switching to voice when editing becomes empty', () => {
    render(<Fixture editingMessage={{ id: 'edit', body: 'Текст' }} />);
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Голосовое сообщение' })).not.toBeInTheDocument();
    expect(input()).toHaveAttribute('placeholder', 'Измените сообщение…');
  });
  it('uses a save checkmark and calls the existing send handler when editing', () => {
    const send = vi.fn();
    render(<Fixture initialText="Исправленный текст" editingMessage={{ id: 'edit' }} onSendMessage={send} />);
    expect(screen.getByTestId('CheckRoundedIcon')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not offer an enabled send action without a conversation', () => {
    render(<Fixture initialText="Черновик" activeConversationId="" />);
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
  });
  it.each(['reply', 'edit', 'emoji'])('closes the %s mode with Escape without forwarding it', (mode) => {
    const dismiss = vi.fn(), keyDown = vi.fn();
    const props = mode === 'reply' ? { replyMessage: { id: 'r' }, onClearReply: dismiss }
      : mode === 'edit' ? { editingMessage: { id: 'e' }, onClearEditing: dismiss }
        : { emojiPickerOpen: true, onCloseEmojiPicker: dismiss };
    render(<Fixture {...props} onComposerKeyDown={keyDown} />);
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(keyDown).not.toHaveBeenCalled();
  });
  it('closes mentions before cancelling the reply', () => {
    const cancel = vi.fn();
    render(<Fixture replyMessage={{ id: 'r' }} onClearReply={cancel} />);
    fireEvent.change(input(), { target: { value: '@' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('selects a mention with arrows and Enter using the active option', () => {
    render(<Fixture />);
    fireEvent.change(input(), { target: { value: '@' } });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Борис');
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { selected: true }).id);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(input()).toHaveValue('@boris ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
  it('does not turn Shift+Enter into mention selection', () => {
    const keyDown = vi.fn();
    render(<Fixture onComposerKeyDown={keyDown} />);
    fireEvent.change(input(), { target: { value: '@' } });
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    expect(input()).toHaveValue('@');
    expect(keyDown).toHaveBeenCalledTimes(1);
  });
  it.each([{ isComposing: true }, { keyCode: 229 }])('does not submit or select a mention during IME composition: %j', (event) => {
    const keyDown = vi.fn();
    render(<Fixture onComposerKeyDown={keyDown} />);
    fireEvent.change(input(), { target: { value: '@' } });
    fireEvent.keyDown(input(), { key: 'Enter', ...event });
    expect(input()).toHaveValue('@');
    expect(keyDown).not.toHaveBeenCalled();
  });
  it('clears old mention suggestions when switching conversations', () => {
    const { rerender } = render(<Fixture />);
    fireEvent.change(input(), { target: { value: '@' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    rerender(<Fixture activeConversationId="another-chat" />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
  it('keeps focus on the input for mouse clicks on send and emoji', () => {
    render(<Fixture initialText="Текст" />);
    for (const id of ['chat-composer-send-button', 'chat-composer-emoji-button']) {
      expect(fireEvent.mouseDown(screen.getByTestId(id))).toBe(false);
    }
  });
  it('shows only editing context when reply and editing are both provided', () => {
    render(<Fixture replyMessage={{ id: 'r' }} editingMessage={{ id: 'e' }} />);
    expect(screen.getByRole('button', { name: 'Отменить редактирование' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отменить ответ' })).not.toBeInTheDocument();
  });
});
