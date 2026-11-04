import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetEditorConfig,
  mockListCollaborators,
  mockSetCollaborators,
  mockListVersions,
  mockRestoreVersion,
  mockDownloadVersion,
  mockGetUsers,
  mockListGroups,
  mockListGroupMembers,
  mockListFolderCollaborators,
  mockSetFolderCollaborators,
} = vi.hoisted(() => ({
  mockGetEditorConfig: vi.fn(),
  mockListCollaborators: vi.fn(),
  mockSetCollaborators: vi.fn(),
  mockListVersions: vi.fn(),
  mockRestoreVersion: vi.fn(),
  mockDownloadVersion: vi.fn(),
  mockGetUsers: vi.fn(),
  mockListGroups: vi.fn(),
  mockListGroupMembers: vi.fn(),
  mockListFolderCollaborators: vi.fn(),
  mockSetFolderCollaborators: vi.fn(),
}));

vi.mock('../../api/myFilesOffice', () => ({
  myFilesOfficeAPI: {
    getEditorConfig: mockGetEditorConfig,
    listCollaborators: mockListCollaborators,
    setCollaborators: mockSetCollaborators,
    listVersions: mockListVersions,
    restoreVersion: mockRestoreVersion,
    downloadVersion: mockDownloadVersion,
    listGroups: mockListGroups,
    listGroupMembers: mockListGroupMembers,
    listFolderCollaborators: mockListFolderCollaborators,
    setFolderCollaborators: mockSetFolderCollaborators,
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
    mockListGroups.mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    delete window.DocsAPI;
  });

  it('grants a whole folder to a colleague with a chosen role and saves it through the folder endpoint', async () => {
    mockListFolderCollaborators.mockResolvedValue({ items: [] });
    mockGetUsers.mockResolvedValue({ items: [{ id: 9, username: 'petrov', full_name: 'Петров Пётр' }] });
    mockSetFolderCollaborators.mockResolvedValue({ items: [] });
    const onClose = vi.fn();

    render(<MyFilesCollaboratorsDialog open folder={{ id: 'fo1', name: 'Проект' }} onClose={onClose} onShareLink={vi.fn()} />);

    await screen.findByText('Пока доступ есть только у вас.');
    expect(screen.getByText(/в том числе добавленные позже/)).toBeInTheDocument();
    expect(screen.queryByTestId('my-files-collaborators-copy-link')).not.toBeInTheDocument();
    const input = screen.getByLabelText('Добавить пользователя');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'петр' } });
    fireEvent.click(await screen.findByText('Петров Пётр (petrov)', {}, { timeout: 2000 }));
    fireEvent.click(screen.getByTestId('my-files-collaborators-save'));

    await waitFor(() => expect(mockSetFolderCollaborators).toHaveBeenCalledWith('fo1', [{ user_id: 9, role: 'edit' }]));
    expect(mockSetCollaborators).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('adds a found colleague to the existing collaborators and saves the whole list', async () => {
    mockListCollaborators.mockResolvedValue({ items: [{ user_id: 5, username: 'ivanov', full_name: 'Иванов Иван', role: 'comment' }] });
    mockGetUsers.mockResolvedValue({ items: [{ id: 9, username: 'petrov', full_name: 'Петров Пётр' }] });
    mockSetCollaborators.mockResolvedValue({ items: [] });
    const onClose = vi.fn();

    render(<MyFilesCollaboratorsDialog open file={{ id: 'f1', original_file_name: 'plan.docx' }} onClose={onClose} />);

    await screen.findByText('Иванов Иван');
    const input = screen.getByLabelText('Добавить пользователя');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'петр' } });
    await waitFor(() => expect(mockGetUsers).toHaveBeenCalledWith({ q: 'петр', limit: 20 }));
    fireEvent.click(await screen.findByText('Петров Пётр (petrov)', {}, { timeout: 2000 }));
    fireEvent.click(screen.getByTestId('my-files-collaborators-save'));

    await waitFor(() => expect(mockSetCollaborators).toHaveBeenCalledWith('f1', [
      { user_id: 5, role: 'comment' },
      { user_id: 9, role: 'edit' },
    ]));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('adds the members of a chosen group once and keeps people already on the list', async () => {
    mockListCollaborators.mockResolvedValue({ items: [{ user_id: 5, username: 'ivanov', full_name: 'Иванов Иван' }] });
    mockListGroups.mockResolvedValue({ items: [{ id: 'it', name: 'ИТ-отдел', members_count: 2 }] });
    mockListGroupMembers.mockResolvedValue({ items: [
      { user_id: 5, username: 'ivanov', full_name: 'Иванов Иван' },
      { user_id: 7, username: 'sidorov', full_name: 'Сидоров Сидор' },
    ] });
    mockSetCollaborators.mockResolvedValue({ items: [] });

    render(<MyFilesCollaboratorsDialog open file={{ id: 'f1', original_file_name: 'plan.docx' }} onClose={vi.fn()} />);

    await screen.findByText('Иванов Иван');
    fireEvent.mouseDown(await screen.findByLabelText('Добавить группу целиком'));
    fireEvent.click(await screen.findByText('ИТ-отдел (2)'));
    fireEvent.click(screen.getByTestId('my-files-collaborators-add-group'));
    await screen.findByText('Сидоров Сидор');
    fireEvent.click(screen.getByTestId('my-files-collaborators-save'));

    await waitFor(() => expect(mockSetCollaborators).toHaveBeenCalledWith('f1', [
      { user_id: 5, role: 'edit' },
      { user_id: 7, role: 'edit' },
    ]));
  });

  it('hands the file to the page when the owner asks for the one shared link', async () => {
    mockListCollaborators.mockResolvedValue({ items: [] });
    const onShareLink = vi.fn();
    const file = { id: 'f1', original_file_name: 'plan.docx' };

    render(<MyFilesCollaboratorsDialog open file={file} onClose={vi.fn()} onShareLink={onShareLink} />);

    fireEvent.click(await screen.findByTestId('my-files-collaborators-copy-link'));
    expect(onShareLink).toHaveBeenCalledWith(file);
  });

  it('lists the history like Google Docs: the current version first, grouped by day, with the author of each', async () => {
    const now = new Date();
    const earlier = new Date(now.getFullYear() - 1, 2, 5, 9, 30).toISOString();
    mockListVersions.mockResolvedValue({
      items: [{
        id: 'v1', version_no: 1, size_bytes: 2048, replaced_by: 'petrov', replaced_at: now.toISOString(), author: 'ivanov', authored_at: earlier,
      }],
      current: { author: 'petrov', authored_at: now.toISOString(), size_bytes: 4096 },
    });

    render(<MyFilesVersionsDialog open file={{ id: 'f1', original_file_name: 'plan.docx' }} onClose={vi.fn()} />);

    const current = await screen.findByTestId('my-files-version-current');
    expect(current).toHaveTextContent('Текущая версия');
    expect(current).toHaveTextContent('petrov');
    expect(screen.getByText('Сегодня')).toBeTruthy();
    expect(screen.getByTestId('my-files-version-1')).toHaveTextContent('ivanov');
    expect(screen.getByText(/5 марта \d{4}/)).toBeTruthy();
    expect(screen.queryByTestId('my-files-version-download-current')).toBeNull();
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

  it('saves a retired version under the file name sent by the server', async () => {
    mockListVersions.mockResolvedValue({
      items: [{ id: 'v1', version_no: 1, size_bytes: 2048, replaced_by: 'petrov', replaced_at: '2026-11-02T10:00:00Z' }],
    });
    mockDownloadVersion.mockResolvedValue({
      data: new Blob(['old']),
      headers: { 'content-disposition': "attachment; filename*=UTF-8''plan%20(%D0%B2%D0%B5%D1%80%D1%81%D0%B8%D1%8F%201).docx" },
    });
    URL.createObjectURL = vi.fn(() => 'blob:version');
    URL.revokeObjectURL = vi.fn();
    const saved = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function recordDownload() {
      saved.push(this.download);
    });

    render(<MyFilesVersionsDialog open file={{ id: 'f1', original_file_name: 'plan.docx' }} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('my-files-version-download-1'));

    await waitFor(() => expect(saved).toEqual(['plan (версия 1).docx']));
    expect(mockDownloadVersion).toHaveBeenCalledWith('f1', 'v1');
    click.mockRestore();
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
