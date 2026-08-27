import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import * as mailApi from '../../api/mailApi';
import * as mailboxApi from '../../api/mailMailboxesApi';
import { NativeMailFoldersScreen } from './NativeMailFoldersScreen';

let mockPermissions = ['mail.access'];
let mockOfflineMode = false;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: mockOfflineMode,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));

jest.mock('../../api/mailMailboxesApi', () => ({ listMailboxes: jest.fn() }));
jest.mock('../../api/mailApi', () => ({
  getMailFolderTree: jest.fn(),
  createMailFolder: jest.fn(),
  renameMailFolder: jest.fn(),
  deleteMailFolder: jest.fn(),
  setMailFolderFavorite: jest.fn(),
}));

const customFolder = {
  id: 'custom-projects',
  label: 'Проекты',
  scope: 'mailbox',
  unread: 2,
  is_favorite: false,
  can_rename: true,
  can_delete: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['mail.access'];
  mockOfflineMode = false;
  (useLocalSearchParams as jest.Mock).mockReturnValue({ mailboxId: 'box-1' });
  (mailboxApi.listMailboxes as jest.Mock).mockResolvedValue([
    { id: 'box-1', label: 'Рабочая почта', is_primary: true, is_active: true },
  ]);
  (mailApi.getMailFolderTree as jest.Mock).mockResolvedValue({
    items: [
      { id: 'inbox', label: 'Входящие', well_known_key: 'inbox', scope: 'mailbox' },
      customFolder,
    ],
  });
  (mailApi.createMailFolder as jest.Mock).mockResolvedValue(customFolder);
  (mailApi.renameMailFolder as jest.Mock).mockResolvedValue(customFolder);
  (mailApi.deleteMailFolder as jest.Mock).mockResolvedValue({ ok: true });
  (mailApi.setMailFolderFavorite as jest.Mock).mockResolvedValue({ ...customFolder, is_favorite: true });
});

it('creates a root and nested custom folder through the native dialog', async () => {
  const view = await render(<NativeMailFoldersScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-managed-folder-custom-projects')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByTestId('native-mail-folder-create'));
  });
  await waitFor(() => expect(view.getByTestId('native-mail-folder-dialog')).toBeTruthy());
  await act(async () => {
    fireEvent.changeText(view.getByTestId('native-mail-folder-name'), 'Новая папка');
  });
  await act(async () => {
    fireEvent.press(view.getByTestId('native-mail-folder-save'));
  });
  await waitFor(() => expect(mailApi.createMailFolder).toHaveBeenCalledWith({
    mailboxId: 'box-1',
    name: 'Новая папка',
    parentFolderId: '',
    scope: 'mailbox',
  }));
  await waitFor(() => expect(view.getByText('Папка создана.')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByTestId('native-mail-folder-child-custom-projects'));
  });
  await waitFor(() => expect(view.getByTestId('native-mail-folder-dialog')).toBeTruthy());
  await act(async () => {
    fireEvent.changeText(view.getByTestId('native-mail-folder-name'), '2026');
  });
  await act(async () => {
    fireEvent.press(view.getByTestId('native-mail-folder-save'));
  });
  await waitFor(() => expect(mailApi.createMailFolder).toHaveBeenLastCalledWith({
    mailboxId: 'box-1',
    name: '2026',
    parentFolderId: 'custom-projects',
    scope: 'mailbox',
  }));
});

it('renames and toggles favorite for a custom folder', async () => {
  const view = await render(<NativeMailFoldersScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-folder-rename-custom-projects')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByTestId('native-mail-folder-rename-custom-projects'));
  });
  await waitFor(() => expect(view.getByTestId('native-mail-folder-dialog')).toBeTruthy());
  await act(async () => {
    fireEvent.changeText(view.getByTestId('native-mail-folder-name'), 'Важные проекты');
  });
  await act(async () => {
    fireEvent.press(view.getByTestId('native-mail-folder-save'));
  });
  await waitFor(() => expect(mailApi.renameMailFolder).toHaveBeenCalledWith('custom-projects', 'box-1', 'Важные проекты'));

  fireEvent.press(view.getByTestId('native-mail-folder-favorite-custom-projects'));
  await waitFor(() => expect(mailApi.setMailFolderFavorite).toHaveBeenCalledWith('custom-projects', true, 'box-1'));
});

it('requires destructive confirmation before deleting a custom folder', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find((button) => button.style === 'destructive')?.onPress?.();
  });
  const view = await render(<NativeMailFoldersScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-folder-delete-custom-projects')).toBeTruthy());

  fireEvent.press(view.getByTestId('native-mail-folder-delete-custom-projects'));

  expect(alert).toHaveBeenCalledWith(
    'Удалить папку «Проекты»?',
    expect.stringContaining('нельзя отменить'),
    expect.any(Array),
  );
  await waitFor(() => expect(mailApi.deleteMailFolder).toHaveBeenCalledWith('custom-projects', 'box-1'));
  alert.mockRestore();
});

it('disables folder mutations in offline mode', async () => {
  mockOfflineMode = true;
  const view = await render(<NativeMailFoldersScreen />);
  await waitFor(() => expect(view.getByText('Автономный режим: управление папками недоступно.')).toBeTruthy());
  expect(view.getByTestId('native-mail-folder-create').props.accessibilityState.disabled).toBe(true);
});

it('does not load protected folders without mail.access', async () => {
  mockPermissions = [];
  const view = await render(<NativeMailFoldersScreen />);
  await waitFor(() => expect(view.getByText('Нет доступа')).toBeTruthy());
  expect(mailApi.getMailFolderTree).not.toHaveBeenCalled();
});
