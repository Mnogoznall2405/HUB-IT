// Автоподсказка эмодзи по `:keyword` в композере (issue #82, Telegram
// Desktop parity). Тесты идут через реальный CLDR-индекс (чанк резолвится
// vitest напрямую) и реальный композер — без моков данных: проверяется
// вся цепочка «триггер → reverse-поиск → клавиатура → вставка».
// Сценарии, которые ловит только эта связка: регрессия charset-триггера,
// гонка «Enter отправляет сообщение вместо вставки», потеря caret после
// вставки, конфликт с потоком упоминаний.
import React, { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import ChatComposer from './ChatComposer';
import { buildChatUiTokens } from './chatUiTokens';
import {
  ensureEmojiKeywordIndex,
  resetEmojiKeywordIndexForTests,
} from '../../lib/chat/emojiKeywordIndex';

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
const typeQuery = (value) => fireEvent.change(input(), { target: { value } });
const emojiListbox = () => screen.queryByTestId('chat-emoji-suggestions');

beforeAll(async () => {
  // Реальный индекс один раз на файл: 1941 эмодзи, ~12k ключевых слов.
  await ensureEmojiKeywordIndex();
});

afterAll(() => {
  resetEmojiKeywordIndexForTests(null);
});

describe('composer emoji autocomplete on :keyword', () => {
  it('opens the vertical suggestion list for a cyrillic query', () => {
    render(<Fixture />);
    expect(emojiListbox()).not.toBeInTheDocument();
    typeQuery(':сов');
    expect(emojiListbox()).toBeInTheDocument();
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('сова');
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    expect(input()).toHaveAttribute('aria-controls', emojiListbox().id);
  });

  it('opens for latin queries too (EN keywords)', () => {
    render(<Fixture />);
    typeQuery(':owl');
    expect(emojiListbox()).toBeInTheDocument();
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('owl');
  });

  it.each([':с', '12:30', 'abc:сов', 'привет:сов'])('does not open for %j', (value) => {
    render(<Fixture />);
    typeQuery(value);
    expect(emojiListbox()).not.toBeInTheDocument();
    expect(input()).toHaveAttribute('aria-expanded', 'false');
  });

  it('inserts the active emoji with Enter, replacing the :token', () => {
    const keyDown = vi.fn();
    render(<Fixture onComposerKeyDown={keyDown} />);
    typeQuery('привет :сов');
    expect(emojiListbox()).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'Enter' });
    // Enter съедается списком — отправки сообщения не происходит.
    expect(keyDown).not.toHaveBeenCalled();
    expect(input()).toHaveValue('привет 🦉 ');
    expect(emojiListbox()).not.toBeInTheDocument();
    // Следующий Enter — уже обычная отправка.
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(keyDown).toHaveBeenCalledTimes(1);
  });

  it('navigates with arrows and inserts the chosen emoji with Tab', () => {
    render(<Fixture />);
    typeQuery(':умор');
    const first = screen.getByRole('option', { selected: true });
    expect(first).toHaveTextContent('умора');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const selected = screen.getByRole('option', { selected: true });
    expect(selected).not.toBe(first);
    expect(input()).toHaveAttribute('aria-activedescendant', selected.id);
    fireEvent.keyDown(input(), { key: 'Tab' });
    // 🤣 идёт первым в unicode-порядке, ↓ переносит выбор на 😂.
    expect(input()).toHaveValue('😂 ');
  });

  it('places the caret after the inserted emoji', async () => {
    render(<Fixture />);
    typeQuery(':сов');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(input()).toHaveValue('🦉 ');
    await vi.waitFor(() => {
      expect(input().selectionStart).toBe('🦉 '.length);
    });
  });

  it('Escape hides only the list and re-arms when the query changes', () => {
    const keyDown = vi.fn();
    render(<Fixture onComposerKeyDown={keyDown} />);
    typeQuery(':сов');
    expect(emojiListbox()).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(emojiListbox()).not.toBeInTheDocument();
    // Esc не ушёл ни в отмену ответа, ни в отправку.
    expect(keyDown).not.toHaveBeenCalled();
    // Тот же запрос — список всё ещё скрыт (поведение Telegram Desktop).
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(emojiListbox()).not.toBeInTheDocument();
    // Новая буква перевооружает подсказку.
    typeQuery(':сова');
    expect(emojiListbox()).toBeInTheDocument();
  });

  it('closes before the reply cancel in the Escape chain', () => {
    const cancel = vi.fn();
    render(<Fixture replyMessage={{ id: 'r' }} onClearReply={cancel} />);
    typeQuery(':сов');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('inserts the emoji on mouse click', () => {
    render(<Fixture />);
    typeQuery(':owl');
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(input()).toHaveValue('🦉 ');
    expect(emojiListbox()).not.toBeInTheDocument();
  });

  it('does not turn Shift+Enter into emoji insertion', () => {
    const keyDown = vi.fn();
    render(<Fixture onComposerKeyDown={keyDown} />);
    typeQuery(':сов');
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    expect(input()).toHaveValue(':сов');
    expect(keyDown).toHaveBeenCalledTimes(1);
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])('does not insert during IME composition: %j', (event) => {
    const keyDown = vi.fn();
    render(<Fixture onComposerKeyDown={keyDown} />);
    typeQuery(':сов');
    fireEvent.keyDown(input(), { key: 'Enter', ...event });
    expect(input()).toHaveValue(':сов');
    expect(keyDown).not.toHaveBeenCalled();
  });

  it('keeps the mention flow working alongside (disjoint triggers)', () => {
    render(<Fixture />);
    typeQuery('@');
    expect(screen.getByTestId('chat-mention-suggestions')).toBeInTheDocument();
    expect(emojiListbox()).not.toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(input()).toHaveValue('@boris ');
    // После вставки упоминания emoji-подсказка не открывается сама.
    expect(emojiListbox()).not.toBeInTheDocument();
  });

  it('drops the trigger when a space is typed inside the query', () => {
    render(<Fixture />);
    typeQuery(':сов');
    expect(emojiListbox()).toBeInTheDocument();
    typeQuery(':сов ');
    expect(emojiListbox()).not.toBeInTheDocument();
    expect(input()).toHaveAttribute('aria-expanded', 'false');
  });

  it('clears suggestions when switching conversations', () => {
    const { rerender } = render(<Fixture />);
    typeQuery(':сов');
    expect(emojiListbox()).toBeInTheDocument();
    rerender(<Fixture activeConversationId="another-chat" />);
    expect(emojiListbox()).not.toBeInTheDocument();
  });
});
