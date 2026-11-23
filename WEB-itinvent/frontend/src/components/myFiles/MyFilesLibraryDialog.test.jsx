import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreate,
  mockUpdate,
  mockRemove,
  mockListMembers,
  mockSetMembers,
  mockListGroups,
  mockListGroupMembers,
  mockGetUsers,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockRemove: vi.fn(),
  mockListMembers: vi.fn(),
  mockSetMembers: vi.fn(),
  mockListGroups: vi.fn(),
  mockListGroupMembers: vi.fn(),
  mockGetUsers: vi.fn(),
}));

vi.mock('../../api/myFilesLibraries', () => ({
  myFilesLibrariesAPI: {
    create: mockCreate,
    update: mockUpdate,
    remove: mockRemove,
    listMembers: mockListMembers,
    setMembers: mockSetMembers,
  },
}));

vi.mock('../../api/myFilesOffice', () => ({
  myFilesOfficeAPI: { listGroups: mockListGroups, listGroupMembers: mockListGroupMembers },
}));

vi.mock('../../api/chatDirectory', () => ({
  default: { getUsers: mockGetUsers },
}));

import MyFilesLibraryDialog, { parseQuotaGbInput, quotaBytesToGbInput } from './MyFilesLibraryDialog';

const GIB = 1024 ** 3;

describe('quota helpers', () => {
  it('derives a GB string from bytes without losing the limit', () => {
    expect(quotaBytesToGbInput(0)).toBe('');
    expect(quotaBytesToGbInput(10 * GIB + 17)).toBe('10');
    expect(quotaBytesToGbInput(1.5 * GIB)).toBe('1.5');
  });

  it('parses empty input as unlimited and rejects non-numbers', () => {
    expect(parseQuotaGbInput('')).toEqual({ ok: true, gb: 0, bytes: 0 });
    expect(parseQuotaGbInput('  ')).toEqual({ ok: true, gb: 0, bytes: 0 });
    expect(parseQuotaGbInput('10')).toEqual({ ok: true, gb: 10, bytes: 10 * GIB });
    expect(parseQuotaGbInput('1,5').bytes).toBe(Math.round(1.5 * GIB));
    expect(parseQuotaGbInput('..').ok).toBe(false);
    expect(parseQuotaGbInput('-2').ok).toBe(false);
  });
});

describe('MyFilesLibraryDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListGroups.mockResolvedValue({ items: [{ id: 5, name: 'Бухгалтерия', members_count: 12 }] });
    mockGetUsers.mockResolvedValue({ items: [] });
  });

  it('creates a library with a limit, then gives a whole department the edit role', async () => {
    mockCreate.mockResolvedValue({ id: 'lib-1', name: 'Финансы', quota_bytes: 50 * GIB });
    mockListMembers.mockResolvedValue({
      items: [{ principal_type: 'user', principal_id: '1', name: 'Админ', role: 'manage', members_count: 0 }],
    });
    mockUpdate.mockResolvedValue({});
    mockSetMembers.mockResolvedValue({ items: [] });
    const onClose = vi.fn();

    render(<MyFilesLibraryDialog open library={null} onClose={onClose} />);

    fireEvent.change(screen.getByTestId('my-files-library-name'), { target: { value: 'Финансы' } });
    fireEvent.change(screen.getByTestId('my-files-library-quota'), { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('my-files-library-create'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({ name: 'Финансы', quotaBytes: 50 * GIB }));
    const members = await screen.findByTestId('my-files-library-members');
    await within(members).findByText('Админ');

    const department = screen.getByLabelText('Добавить подразделение');
    fireEvent.focus(department);
    fireEvent.keyDown(department, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByText('Бухгалтерия (12)'));
    fireEvent.click(screen.getByTestId('my-files-library-add-department'));
    await within(members).findByText(/Бухгалтерия/);

    fireEvent.click(screen.getByTestId('my-files-library-save'));

    await waitFor(() => expect(mockSetMembers).toHaveBeenCalledWith('lib-1', [
      expect.objectContaining({ principal_type: 'user', principal_id: '1', role: 'manage' }),
      expect.objectContaining({ principal_type: 'department', principal_id: '5', role: 'edit' }),
    ]));
    // Настройки после создания не менялись — PUT библиотеки не нужен, сохраняем только участников.
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('opens without pending changes: save stays disabled and no requests are sent', async () => {
    mockListMembers.mockResolvedValue({
      items: [{ principal_type: 'user', principal_id: '1', name: 'Админ', role: 'manage', members_count: 0 }],
    });
    const onClose = vi.fn();

    render(<MyFilesLibraryDialog open library={{ id: 'lib-4', name: 'Отчёты', quota_bytes: 10 * GIB + 17 }} onClose={onClose} />);

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByTestId('my-files-library-tab-access'));
    const members = await within(dialog).findByTestId('my-files-library-members');
    await within(members).findByText('Админ');
    fireEvent.click(within(dialog).getByTestId('my-files-library-tab-main'));

    // Лимит 10 ГБ + хвост в байтах: сравнение идёт строкой ГБ, ложной «грязи» нет.
    expect(screen.getByTestId('my-files-library-quota')).toHaveValue('10');
    expect(screen.queryByTestId('my-files-library-unsaved')).not.toBeInTheDocument();
    expect(screen.getByTestId('my-files-library-save')).toBeDisabled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetMembers).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends only the settings update when just the name changed', async () => {
    mockListMembers.mockResolvedValue({
      items: [{ principal_type: 'user', principal_id: '1', name: 'Админ', role: 'manage', members_count: 0 }],
    });
    mockUpdate.mockResolvedValue({});
    const onClose = vi.fn();

    render(<MyFilesLibraryDialog open library={{ id: 'lib-5', name: 'Отчёты', quota_bytes: 10 * GIB }} onClose={onClose} />);

    await screen.findByRole('dialog');
    fireEvent.change(screen.getByTestId('my-files-library-name'), { target: { value: 'Отчёты 2026' } });
    expect(screen.getByTestId('my-files-library-unsaved')).toHaveTextContent('1');
    const saveButton = screen.getByTestId('my-files-library-save');
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('lib-5', { name: 'Отчёты 2026', quotaBytes: 10 * GIB }));
    expect(mockSetMembers).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('rejects a non-numeric limit instead of silently storing zero', async () => {
    mockListMembers.mockResolvedValue({ items: [] });
    const onClose = vi.fn();

    render(<MyFilesLibraryDialog open library={{ id: 'lib-6', name: 'Архив', quota_bytes: 0 }} onClose={onClose} />);

    await screen.findByRole('dialog');
    fireEvent.change(screen.getByTestId('my-files-library-quota'), { target: { value: '..' } });

    expect(await screen.findByText('Укажите число не меньше 0')).toBeInTheDocument();
    expect(screen.getByTestId('my-files-library-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('my-files-library-save'));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetMembers).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends only setMembers when a member role changed', async () => {
    mockListMembers.mockResolvedValue({
      items: [{ principal_type: 'user', principal_id: '1', name: 'Админ', role: 'manage', members_count: 0 }],
    });
    mockSetMembers.mockResolvedValue({ items: [] });
    const onClose = vi.fn();

    render(<MyFilesLibraryDialog open library={{ id: 'lib-7', name: 'Подбор', quota_bytes: 10 * GIB }} onClose={onClose} />);

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByTestId('my-files-library-tab-access'));
    const members = await within(dialog).findByTestId('my-files-library-members');
    await within(members).findByText('Админ');
    expect(screen.getByTestId('my-files-library-save')).toBeDisabled();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Роль: Админ' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Просмотр/ }));
    expect(screen.getByTestId('my-files-library-unsaved')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('my-files-library-save'));

    await waitFor(() => expect(mockSetMembers).toHaveBeenCalledWith('lib-7', [
      expect.objectContaining({ principal_id: '1', role: 'view' }),
    ]));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('reports a deleted library to the page and shows the server refusal when it is not empty', async () => {
    mockListMembers.mockResolvedValue({ items: [] });
    mockRemove.mockRejectedValueOnce({ response: { data: { detail: 'Library is not empty' } } });
    const onClose = vi.fn();

    render(<MyFilesLibraryDialog open library={{ id: 'lib-2', name: 'Архив', quota_bytes: 0 }} onClose={onClose} />);

    fireEvent.click(await screen.findByTestId('my-files-library-delete'));
    fireEvent.click(screen.getByTestId('my-files-library-delete-confirm'));
    await screen.findByText('Library is not empty');
    expect(onClose).not.toHaveBeenCalled();

    mockRemove.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByTestId('my-files-library-delete'));
    fireEvent.click(screen.getByTestId('my-files-library-delete-confirm'));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true, { removedId: 'lib-2' }));
  });

  it('expands a department row to show the people it gives access to', async () => {
    mockListMembers.mockResolvedValue({
      items: [
        { principal_type: 'user', principal_id: '1', name: 'Админ', role: 'manage', members_count: 0 },
        { principal_type: 'department', principal_id: 'dept-5', name: 'Бухгалтерия', role: 'view', members_count: 2 },
      ],
    });
    mockListGroupMembers.mockResolvedValue({
      items: [
        { user_id: 11, username: 'ivanov_ii', full_name: 'Иванов Иван' },
        { user_id: 12, username: 'petrov_pp', full_name: 'Петров Пётр' },
      ],
    });

    render(<MyFilesLibraryDialog open membersOnly library={{ id: 'lib-9', name: 'ИТ', quota_bytes: 0 }} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('my-files-library-expand-dept-5'));

    expect(mockListGroupMembers).toHaveBeenCalledWith('dept-5');
    const list = await screen.findByTestId('my-files-library-group-users-dept-5');
    await within(list).findByText('Иванов Иван (ivanov_ii)');
    await within(list).findByText('Петров Пётр (petrov_pp)');
  });

  it('in members-only mode a library manager edits access but not the folder itself', async () => {
    mockListMembers.mockResolvedValue({
      items: [{ principal_type: 'user', principal_id: '1', name: 'Админ', role: 'manage', members_count: 0 }],
    });
    mockSetMembers.mockResolvedValue({ items: [] });
    const onClose = vi.fn();

    render(<MyFilesLibraryDialog open membersOnly library={{ id: 'lib-3', name: 'Подбор', quota_bytes: 10 * GIB }} onClose={onClose} />);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Управление доступом')).toBeInTheDocument();
    expect(within(dialog).getByText(/Папка «Подбор»/)).toBeInTheDocument();
    // A library ``manage`` member must not rename, re-quota or delete the folder.
    expect(screen.queryByTestId('my-files-library-name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-files-library-quota')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-files-library-delete')).not.toBeInTheDocument();
    const members = await within(dialog).findByTestId('my-files-library-members');
    await within(members).findByText('Админ');

    // Nothing changed yet: saving stays disabled until a role or the list itself changes.
    expect(screen.getByTestId('my-files-library-save')).toBeDisabled();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Роль: Админ' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Просмотр/ }));
    fireEvent.click(screen.getByTestId('my-files-library-save'));

    await waitFor(() => expect(mockSetMembers).toHaveBeenCalledWith('lib-3', [
      expect.objectContaining({ principal_id: '1', role: 'view' }),
    ]));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(true);
  });
});
