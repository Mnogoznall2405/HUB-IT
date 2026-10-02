import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChatContactPickDialog from './ChatContactPickDialog';
import ChatPollCreateDialog from './ChatPollCreateDialog';
import { addressBookAPI } from '../../api/addressBook';

vi.mock('../../api/addressBook', () => ({
  addressBookAPI: {
    search: vi.fn(),
  },
}));

const theme = createTheme();
const renderWithTheme = (node) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

describe('ChatPollCreateDialog', () => {
  it('keeps send disabled until the question and two options are filled', () => {
    renderWithTheme(<ChatPollCreateDialog open onClose={vi.fn()} onSend={vi.fn()} />);

    const sendButton = screen.getByTestId('chat-poll-create-send');
    expect(sendButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Вопрос опроса'), { target: { value: 'Обед?' } });
    expect(sendButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Вариант 1'), { target: { value: 'Да' } });
    expect(sendButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Вариант 2'), { target: { value: 'Нет' } });
    expect(sendButton).toBeEnabled();
  });

  it('trims fields, drops empty options and resets after a successful send', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    renderWithTheme(<ChatPollCreateDialog open onClose={vi.fn()} onSend={onSend} />);

    fireEvent.change(screen.getByLabelText('Вопрос опроса'), { target: { value: '  Вопрос?  ' } });
    fireEvent.change(screen.getByLabelText('Вариант 1'), { target: { value: ' A ' } });
    fireEvent.change(screen.getByLabelText('Вариант 2'), { target: { value: 'B' } });
    fireEvent.click(screen.getByText('Вариант'));
    fireEvent.change(screen.getByLabelText('Вариант 3'), { target: { value: '   ' } });
    fireEvent.click(screen.getByLabelText('Анонимный опрос'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('chat-poll-create-send'));
    });

    expect(onSend).toHaveBeenCalledWith({
      question: 'Вопрос?',
      options: ['A', 'B'],
      anonymous: false,
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Вопрос опроса')).toHaveValue('');
    });
  });

  it('does not close while sending and calls onClose from cancel', async () => {
    let resolveSend;
    const onSend = vi.fn(() => new Promise((resolve) => { resolveSend = resolve; }));
    const onClose = vi.fn();
    renderWithTheme(<ChatPollCreateDialog open onClose={onClose} onSend={onSend} />);

    fireEvent.change(screen.getByLabelText('Вопрос опроса'), { target: { value: 'Q' } });
    fireEvent.change(screen.getByLabelText('Вариант 1'), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText('Вариант 2'), { target: { value: 'b' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('chat-poll-create-send'));
    });
    fireEvent.click(screen.getByText('Отмена'));
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => resolveSend(true));
    fireEvent.click(screen.getByText('Отмена'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ChatContactPickDialog', () => {
  const entry = {
    full_name: 'Иван Иванов',
    department: 'ИТ',
    work_phones: [{ value: '+7 900 111-22-33', kind: 'mobile' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('searches the address book and sends the picked contact', async () => {
    addressBookAPI.search.mockResolvedValue({ items: [entry] });
    const onSend = vi.fn().mockResolvedValue(true);

    renderWithTheme(<ChatContactPickDialog open onClose={vi.fn()} onSend={onSend} ui={{ textSecondary: '#aaa' }} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(addressBookAPI.search).toHaveBeenCalledWith({ q: '', limit: 30 });

    await act(async () => {
      fireEvent.click(screen.getByText('Иван Иванов'));
    });

    expect(onSend).toHaveBeenCalledWith({
      name: 'Иван Иванов',
      phone: '+7 900 111-22-33',
      organization: 'ИТ',
    });
  });

  it('debounces the query and shows an empty state when nothing is found', async () => {
    addressBookAPI.search.mockResolvedValue({ items: [] });
    renderWithTheme(<ChatContactPickDialog open onClose={vi.fn()} onSend={vi.fn()} ui={{}} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    fireEvent.change(screen.getByLabelText('Поиск сотрудника'), { target: { value: 'пет' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(addressBookAPI.search).toHaveBeenLastCalledWith({ q: 'пет', limit: 30 });
    expect(screen.getByText('Никого не найдено. Уточните имя.')).toBeInTheDocument();
  });
});
