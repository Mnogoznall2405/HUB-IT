import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as groupsApi from '../../api/groupsAccessApi';
import { NativeGroupsAccessScreen } from './NativeGroupsAccessScreen';

let mockPermissions = ['groups_access.read'];
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
jest.mock('../../api/groupsAccessApi', () => ({
  getGroupsAccessStatus: jest.fn(),
  listGroupsAccessGroups: jest.fn(),
}));

const group: groupsApi.GroupsAccessGroup = {
  dn: 'CN=RW-Files,OU=SPb',
  cn: 'RW-Files',
  branch: 'SPb',
  folder_label: 'Проекты',
  folder_path: 'Общие/Проекты',
  access_level: 'write',
  member_count: 12,
  description: '',
};

it('reveals the full folder path and group details without fetching again', async () => {
  const longPath = 'Общие/Проекты/Архив подразделения/Документы большого проекта';
  (groupsApi.listGroupsAccessGroups as jest.Mock).mockResolvedValue({ items: [{ ...group, folder_path: longPath }], total: 1, page: 1, limit: 40, has_more: false });
  const view = await render(<NativeGroupsAccessScreen />);
  await view.findByText(longPath);
  expect(view.getByText(longPath).props.numberOfLines).toBe(2);
  const requests = (groupsApi.listGroupsAccessGroups as jest.Mock).mock.calls.length;
  await fireEvent.press(view.getByText('Показать подробности'));
  expect(view.getByText(longPath).props.numberOfLines).toBeUndefined();
  await fireEvent.press(view.getByText('Свернуть подробности'));
  expect(view.getByText(longPath).props.numberOfLines).toBe(2);
  expect(groupsApi.listGroupsAccessGroups).toHaveBeenCalledTimes(requests);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['groups_access.read'];
  mockOfflineMode = false;
  (groupsApi.getGroupsAccessStatus as jest.Mock).mockResolvedValue({
    status: 'ok', last_sync_at: '2026-08-24T10:00:00Z', error: '', branches: ['SPb', 'Tyumen'], summary: { group_count: 608, user_count: 515 },
  });
  (groupsApi.listGroupsAccessGroups as jest.Mock).mockResolvedValue({
    items: [group], total: 1, page: 1, limit: 40, has_more: false, synced_at: '2026-08-24T10:00:00Z',
  });
});

it('loads only the bounded folder snapshot and exposes its freshness', async () => {
  const view = await render(<NativeGroupsAccessScreen />);
  await waitFor(() => expect(view.getByText('Общие/Проекты')).toBeTruthy());
  expect(groupsApi.getGroupsAccessStatus).toHaveBeenCalledWith({ signal: expect.anything() });
  expect(groupsApi.listGroupsAccessGroups).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 40, signal: expect.anything() }));
  await fireEvent.press(view.getByRole('button', { name: 'О данных доступа' }));
  expect(view.getByText('608')).toBeTruthy();
  expect(view.getByText('515')).toBeTruthy();
  expect(view.queryByText('Обновить снимок')).toBeNull();
  await view.unmount();
});

it('keeps the bounded group snapshot read-only without a web fallback', async () => {
  const view = await render(<NativeGroupsAccessScreen />);
  await waitFor(() => expect(view.getByText('Общие/Проекты')).toBeTruthy());
  expect(view.queryByTestId('native-groups-access-open-web')).toBeNull();
  expect(view.getByLabelText('Общие/Проекты, SPb, RW-Files, Запись, участников 12')).toBeTruthy();
  await view.unmount();
});

it('offers retry after a failed bounded list request', async () => {
  (groupsApi.listGroupsAccessGroups as jest.Mock)
    .mockRejectedValueOnce(new Error('snapshot unavailable'))
    .mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 40, has_more: false, synced_at: '' });
  const view = await render(<NativeGroupsAccessScreen />);
  await waitFor(() => expect(view.getByTestId('native-groups-access-retry')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-groups-access-retry'));
  await waitFor(() => expect(groupsApi.listGroupsAccessGroups).toHaveBeenCalledTimes(2));
  await view.unmount();
});

it('shows a status error without hiding a successfully loaded folder list', async () => {
  (groupsApi.getGroupsAccessStatus as jest.Mock).mockRejectedValueOnce(new Error('status unavailable'));
  const view = await render(<NativeGroupsAccessScreen />);
  await waitFor(() => expect(view.getByText('Общие/Проекты')).toBeTruthy());
  await waitFor(() => expect(view.getByText('status unavailable')).toBeTruthy());
  await view.unmount();
});

it('ignores a late status response after switching offline', async () => {
  let finish!: (value: unknown) => void;
  (groupsApi.getGroupsAccessStatus as jest.Mock).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const view = await render(<NativeGroupsAccessScreen />);
  await view.findByText('Общие/Проекты');
  mockOfflineMode = true;
  await view.rerender(<NativeGroupsAccessScreen />);
  await act(async () => { finish({ last_sync_at: 'Устаревший снимок', branches: [], summary: {} }); });
  expect(view.queryByText(/Устаревший снимок/)).toBeNull();
});

it('does not replace refreshed status with an older response', async () => {
  let finish!: (value: unknown) => void;
  (groupsApi.getGroupsAccessStatus as jest.Mock).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValue({ last_sync_at: 'Новый снимок', branches: [], summary: {} });
  const view = await render(<NativeGroupsAccessScreen />);
  await view.findByText('Общие/Проекты');
  await fireEvent(view.getByTestId('native-groups-access-groups-list'), 'refresh');
  await view.findByText(/Новый снимок/);
  await act(async () => { finish({ last_sync_at: 'Устаревший снимок', branches: [], summary: {} }); });
  expect(view.queryByText(/Устаревший снимок/)).toBeNull();
  expect(view.getByText(/Новый снимок/)).toBeTruthy();
});

it('aborts a stale next page when a debounced search replaces the list', async () => {
  let resolveOldPage: ((value: unknown) => void) | undefined;
  const searchGroup = { ...group, dn: 'CN=RO-Search,OU=SPb', cn: 'RO-Search', folder_path: 'Результат поиска', access_level: 'read' };
  const staleGroup = { ...group, dn: 'CN=OLD,OU=SPb', cn: 'OLD', folder_path: 'Устаревшая страница' };
  (groupsApi.listGroupsAccessGroups as jest.Mock).mockImplementation(({ page, q }: { page: number; q: string }) => {
    if (q === 'поиск') return Promise.resolve({ items: [searchGroup], total: 1, page: 1, limit: 40, has_more: false, synced_at: '' });
    if (page === 2) return new Promise((resolve) => { resolveOldPage = resolve; });
    return Promise.resolve({ items: [group], total: 41, page: 1, limit: 40, has_more: true, synced_at: '' });
  });
  const view = await render(<NativeGroupsAccessScreen />);
  await waitFor(() => expect(view.getByText('Общие/Проекты')).toBeTruthy());
  await fireEvent(view.getByTestId('native-groups-access-groups-list'), 'endReached');
  await waitFor(() => expect(groupsApi.listGroupsAccessGroups).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
  await fireEvent.changeText(view.getByTestId('native-groups-access-search'), 'поиск');
  await waitFor(() => expect(view.getByText('Результат поиска')).toBeTruthy());
  resolveOldPage?.({ items: [staleGroup], total: 41, page: 2, limit: 40, has_more: false, synced_at: '' });
  await Promise.resolve();
  expect(view.queryByText('Устаревшая страница')).toBeNull();
  await view.unmount();
});

it('does not request AD snapshot data without permission or while offline', async () => {
  mockPermissions = [];
  const denied = await render(<NativeGroupsAccessScreen />);
  await waitFor(() => expect(denied.getByText('Нет доступа')).toBeTruthy());
  expect(groupsApi.listGroupsAccessGroups).not.toHaveBeenCalled();
  await denied.unmount();

  jest.clearAllMocks();
  mockPermissions = ['groups_access.read'];
  mockOfflineMode = true;
  const offline = await render(<NativeGroupsAccessScreen />);
  await waitFor(() => expect(offline.getByText(/Автономный режим/)).toBeTruthy());
  expect(groupsApi.listGroupsAccessGroups).not.toHaveBeenCalled();
  await offline.unmount();
});
