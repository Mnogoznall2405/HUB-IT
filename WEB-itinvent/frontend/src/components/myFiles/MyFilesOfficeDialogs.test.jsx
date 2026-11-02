import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetEditorConfig,
  mockListCollaborators,
  mockSetCollaborators,
  mockListVersions,
  mockRestoreVersion,
  mockGetUsers,
} = vi.hoisted(() => ({
  mockGetEditorConfig: vi.fn(),
  mockListCollaborators: vi.fn(),
  mockSetCollaborators: vi.fn(),
  mockListVersions: vi.fn(),
  mockRestoreVersion: vi.fn(),
  mockGetUsers: vi.fn(),
}));

vi.mock('../../api/myFilesOffice', () => ({
  myFilesOfficeAPI: {
    getEditorConfig: mockGetEditorConfig,
    listCollaborators: mockListCollaborators,
    setCollaborators: mockSetCollaborators,
    listVersions: mockListVersions,
    restoreVersion: mockRestoreVersion,
  },
}));

vi.mock('../../api/chatDirectory', () => ({
  default: { getUsers: mockGetUsers },
}));

import MyFilesCollaboratorsDialog from './MyFilesCollaboratorsDialog';
import MyFilesOfficeEditorDialog from './MyFilesOfficeEditorDialog';
import MyFilesVersionsDialog from './MyFilesVersionsDialog';

describe('My Files co-editing dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.DocsAPI;
  });

  it('adds a found colleague to the existing collaborators and saves the whole list', async () => {
    mockListCollaborators.mockResolvedValue({ items: [{ user_id: 5, username: 'ivanov', full_name: 'Иванов Иван' }] });
    mockGetUsers.mockResolvedValue({ items: [{ id: 9, username: 'petrov', full_name: 'Петров Пётр' }] });
    mockSetCollaborators.mockResolvedValue({ items: [] });
    const onClose = vi.fn();

    render(<MyFilesCollaboratorsDialog open file={{ id: 'f1', original_file_name: 'plan.docx' }} onClose={onClose} />);

    await screen.findByText('Иванов Иван (ivanov)');
    const input = screen.getByLabelText('Добавить пользователей');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'петр' } });
    await waitFor(() => expect(mockGetUsers).toHaveBeenCalledWith({ q: 'петр', limit: 20 }));
    fireEvent.click(await screen.findByText('Петров Пётр (petrov)', {}, { timeout: 2000 }));
    fireEvent.click(screen.getByTestId('my-files-collaborators-save'));

    await waitFor(() => expect(mockSetCollaborators).toHaveBeenCalledWith('f1', [5, 9]));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('shows the server reason when a version cannot be restored and keeps the dialog open', async () => {
    mockListVersions.mockResolvedValue({
      items: [{ id: 'v1', version_no: 1, size_bytes: 2048, replaced_by: 'petrov', replaced_at: '2026-11-02T10:00:00Z' }],
    });
    mockRestoreVersion.mockRejectedValue({ response: { data: { detail: 'Файл занят' } } });
    const onClose = vi.fn();

    render(<MyFilesVersionsDialog open file={{ id: 'f1', original_file_name: 'plan.docx' }} onClose={onClose} />);

    fireEvent.click(await screen.findByTestId('my-files-version-restore-1'));

    expect(await screen.findByText('Файл занят')).toBeTruthy();
    expect(mockRestoreVersion).toHaveBeenCalledWith('f1', 'v1');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('starts the editor with the server config and destroys it when the dialog closes', async () => {
    const destroyEditor = vi.fn();
    const DocEditor = vi.fn(() => ({ destroyEditor }));
    window.DocsAPI = { DocEditor };
    mockGetEditorConfig.mockResolvedValue({
      config: { documentType: 'word', token: 'signed', document: { key: 'k1' } },
      role: 'collaborator',
      public_path: '/onlyoffice',
    });

    const { rerender } = render(
      <MyFilesOfficeEditorDialog open file={{ id: 'f1', original_file_name: 'plan.docx' }} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(DocEditor).toHaveBeenCalled());
    const [targetId, options] = DocEditor.mock.calls[0];
    expect(targetId).toBe('office-editor-f1');
    expect(options).toMatchObject({ token: 'signed', document: { key: 'k1' }, width: '100%', height: '100%' });

    rerender(<MyFilesOfficeEditorDialog open={false} file={null} onClose={vi.fn()} />);
    await waitFor(() => expect(destroyEditor).toHaveBeenCalled());
  });

  it('tells the user when the document server cannot be reached', async () => {
    mockGetEditorConfig.mockRejectedValue({ response: { data: { detail: 'Совместное редактирование не настроено' } } });

    render(<MyFilesOfficeEditorDialog open file={{ id: 'f1', original_file_name: 'plan.docx' }} onClose={vi.fn()} />);

    expect(await screen.findByText('Совместное редактирование не настроено')).toBeTruthy();
  });
});
