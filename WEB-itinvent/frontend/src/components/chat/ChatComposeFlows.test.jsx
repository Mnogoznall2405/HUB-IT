import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import ChatNewMessagePicker, { orderPickerUsersByRecency } from './ChatNewMessagePicker';
import ChatGroupCreateFlow from './ChatGroupCreateFlow';

const theme = createTheme();
const ui = {
  sidebarBg: '#17212b',
  sidebarHeaderBg: '#17212b',
  sidebarSearchBg: '#202f3f',
  textSecondary: '#94a3b8',
  textStrong: '#f8fafc',
  accentText: '#7dd3fc',
  borderSoft: 'rgba(148,163,184,0.2)',
};

const renderWithTheme = (node) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

const person = (id, name, extra = {}) => ({
  id,
  full_name: name,
  username: `user-${id}`,
  presence: { is_online: false },
  ...extra,
});

describe('orderPickerUsersByRecency', () => {
  it('puts people with recent direct dialogs first, then alphabetical', () => {
    const users = [person(1, 'Борис'), person(2, 'Анна'), person(3, 'Вера')];
    const conversations = [
      { kind: 'direct', direct_peer: { id: 3 }, last_message_at: '2026-09-20T10:00:00Z' },
      { kind: 'direct', direct_peer: { id: 1 }, last_message_at: '2026-09-21T10:00:00Z' },
      { kind: 'group', last_message_at: '2026-09-25T10:00:00Z' },
    ];

    expect(orderPickerUsersByRecency(users, conversations).map((item) => item.id)).toEqual([1, 3, 2]);
    expect(orderPickerUsersByRecency(users, []).map((item) => item.id)).toEqual([2, 1, 3]);
  });
});

describe('ChatNewMessagePicker', () => {
  it('searches people and opens a direct conversation in one click', () => {
    const onSelectPerson = vi.fn();
    const onQueryChange = vi.fn();
    const { container } = renderWithTheme(
      <ChatNewMessagePicker
        ui={ui}
        query="ив"
        onQueryChange={onQueryChange}
        users={[person(7, 'Иван Петров', { job_title: 'DevOps', presence: { is_online: true } })]}
        conversations={[]}
        onSelectPerson={onSelectPerson}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('Новое сообщение')).toBeInTheDocument();
    expect(screen.getByText(/DevOps/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Поиск людей'), { target: { value: 'ан' } });
    expect(onQueryChange).toHaveBeenCalledWith('ан');

    fireEvent.click(container.querySelector('[data-user-id="7"]'));
    expect(onSelectPerson).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it('shows the back button and an empty state', () => {
    const onBack = vi.fn();
    renderWithTheme(
      <ChatNewMessagePicker ui={ui} query="zzz" users={[]} onBack={onBack} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByText('По запросу никого не найдено')).toBeInTheDocument();
  });
});

describe('ChatGroupCreateFlow', () => {
  const baseFlow = {
    ui,
    step: 'members',
    query: '',
    onQueryChange: vi.fn(),
    users: [person(2, 'Анна Смирнова'), person(3, 'Пётр Волков')],
    usersLoading: false,
    selectedUsers: [],
    onAddMember: vi.fn(),
    onRemoveMember: vi.fn(),
    maxMembers: 128,
    title: '',
    onTitleChange: vi.fn(),
    creating: false,
    createDisabled: true,
    onCreate: vi.fn(),
    onStepChange: vi.fn(),
    onBack: vi.fn(),
  };

  it('shows selectable members, toggles selection, and disables rows at the limit', () => {
    const onAddMember = vi.fn();
    const onRemoveMember = vi.fn();
    renderWithTheme(
      <ChatGroupCreateFlow
        {...baseFlow}
        maxMembers={3}
        selectedUsers={[person(9, 'Сергей Лимитов')]}
        onAddMember={onAddMember}
        onRemoveMember={onRemoveMember}
      />,
    );

    expect(screen.getByText('Добавить участников')).toBeInTheDocument();
    expect(screen.getByText('Выбрано: 1 из 3')).toBeInTheDocument();
    // Лимит бэкенда включает создателя: выбрать можно maxMembers - 1 = 2.
    expect(screen.getByRole('checkbox', { name: /Анна Смирнова/ })).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByRole('checkbox', { name: /Анна Смирнова/ }));
    expect(onAddMember).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it('blocks further selection once the creator-inclusive limit is reached', () => {
    const onAddMember = vi.fn();
    renderWithTheme(
      <ChatGroupCreateFlow
        {...baseFlow}
        maxMembers={3}
        selectedUsers={[person(9, 'Сергей'), person(10, 'Мария')]}
        onAddMember={onAddMember}
      />,
    );

    const row = screen.getByRole('checkbox', { name: /Анна Смирнова/ });
    expect(row).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(row);
    expect(onAddMember).not.toHaveBeenCalled();
    expect(screen.getByText(/Лимит группы — 3 участников включая вас/)).toBeInTheDocument();
  });

  it('renders selected members as chips and removes the last one on Backspace', () => {
    const onRemoveMember = vi.fn();
    const selected = [person(2, 'Анна Смирнова'), person(3, 'Пётр Волков')];
    renderWithTheme(
      <ChatGroupCreateFlow
        {...baseFlow}
        selectedUsers={selected}
        onRemoveMember={onRemoveMember}
      />,
    );

    const searchArea = screen.getByTestId('group-members-search');
    expect(within(searchArea).getByText('Анна')).toBeInTheDocument();
    expect(within(searchArea).getByText('Пётр')).toBeInTheDocument();

    fireEvent.keyDown(within(searchArea).getByLabelText('Поиск участников'), { key: 'Backspace' });
    expect(onRemoveMember).toHaveBeenCalledWith(3);
  });

  it('moves to the details step and creates the group', () => {
    const onStepChange = vi.fn();
    renderWithTheme(
      <ChatGroupCreateFlow
        {...baseFlow}
        selectedUsers={[person(2), person(3)]}
        onStepChange={onStepChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    expect(onStepChange).toHaveBeenCalledWith('details');
  });

  it('submits the details step with title and avatar file', () => {
    const onCreate = vi.fn();
    const onStepChange = vi.fn();
    renderWithTheme(
      <ChatGroupCreateFlow
        {...baseFlow}
        step="details"
        title="Команда"
        selectedUsers={[person(2), person(3)]}
        createDisabled={false}
        onCreate={onCreate}
        onStepChange={onStepChange}
      />,
    );

    expect(screen.getByText('Новая группа')).toBeInTheDocument();
    expect(screen.getByTestId('group-flow-title-input')).toHaveValue('Команда');
    expect(screen.getByText('Участников: 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Создать группу' }));
    expect(onCreate).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: 'Назад к выбору участников' }));
    expect(onStepChange).toHaveBeenCalledWith('members');
  });
});
