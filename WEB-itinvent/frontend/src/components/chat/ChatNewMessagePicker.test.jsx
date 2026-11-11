import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import ChatNewMessagePicker, { orderPickerUsersByRecency } from './ChatNewMessagePicker';

const theme = createTheme();
const ui = { textSecondary: '#707579', accentText: '#3390ec', textStrong: '#17212b' };
const renderWithTheme = (node) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

const daysAgo = (days) => new Date(Date.now() - days * 86400_000).toISOString();

describe('orderPickerUsersByRecency (Д2-9)', () => {
  it('puts recent direct-chat peers first and the rest alphabetically', () => {
    const users = [
      { id: 1, full_name: 'Яковлев' },
      { id: 2, full_name: 'Абрамов' },
      { id: 3, full_name: 'Борисов' },
      { id: 4, full_name: 'Власов' },
    ];
    const conversations = [
      { kind: 'direct', direct_peer: { id: 1 }, last_message_at: '2026-09-01T10:00:00.000Z' },
      { kind: 'direct', direct_peer: { id: 4 }, last_message_at: '2026-09-20T10:00:00.000Z' },
      { kind: 'group', last_message_at: '2026-09-30T10:00:00.000Z' },
    ];
    expect(orderPickerUsersByRecency(users, conversations).map((item) => item.id)).toEqual([4, 1, 2, 3]);
  });
});

describe('ChatNewMessagePicker', () => {
  it('renders «в сети · должность» and «был(а) …» status lines and opens the person in one click', () => {
    const onSelectPerson = vi.fn();
    renderWithTheme(
      <ChatNewMessagePicker
        ui={ui}
        users={[
          { id: 10, full_name: 'Иван Петров', job_title: 'Инженер', presence: { is_online: true } },
          { id: 11, full_name: 'Мария Орлова', job_title: 'Бухгалтер', presence: { is_online: false, last_seen_at: daysAgo(3) } },
        ]}
        conversations={[]}
        onSelectPerson={onSelectPerson}
        onBack={() => {}}
      />,
    );

    expect(screen.getByText('Новое сообщение')).toBeInTheDocument();
    const online = screen.getByRole('button', { name: /Иван Петров/ });
    expect(online).toHaveTextContent('в сети · Инженер');
    const offline = screen.getByRole('button', { name: /Мария Орлова/ });
    expect(offline).toHaveTextContent(/был\(а\) .* · Бухгалтер/);

    fireEvent.click(online);
    expect(onSelectPerson).toHaveBeenCalledTimes(1);
    expect(onSelectPerson.mock.calls[0][0].id).toBe(10);
  });
});
