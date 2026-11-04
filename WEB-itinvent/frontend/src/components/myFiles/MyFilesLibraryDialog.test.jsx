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
  mockGetUsers,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockRemove: vi.fn(),
  mockListMembers: vi.fn(),
  mockSetMembers: vi.fn(),
  mockListGroups: vi.fn(),
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
  myFilesOfficeAPI: { listGroups: mockListGroups },
}));

vi.mock('../../api/chatDirectory', () => ({
  default: { getUsers: mockGetUsers },
}));

import MyFilesLibraryDialog from './MyFilesLibraryDialog';

const GIB = 1024 ** 3;

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
    expect(mockUpdate).toHaveBeenCalledWith('lib-1', { name: 'Финансы', quotaBytes: 50 * GIB });
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
});
