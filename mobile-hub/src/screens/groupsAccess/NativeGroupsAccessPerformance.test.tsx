import { act, render, waitFor } from '@testing-library/react-native';
import * as groupsApi from '../../api/groupsAccessApi';
import { NativeGroupsAccessScreen } from './NativeGroupsAccessScreen';

const mockGroupIconRender = jest.fn();

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return function MockMaterialCommunityIcons({ name }: { name: string }) {
    if (name === 'folder-account-outline') mockGroupIconRender();
    return React.createElement(Text, null, name);
  };
});

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: false,
    hasPermission: () => true,
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
}));

jest.mock('../../api/groupsAccessApi', () => ({
  getGroupsAccessStatus: jest.fn(),
  listGroupsAccessGroups: jest.fn(),
}));

const groups = Array.from({ length: 30 }, (_, index): groupsApi.GroupsAccessGroup => ({
  dn: `CN=Group-${index},OU=Tyumen`,
  cn: `Group-${index}`,
  branch: 'Тюмень',
  folder_label: `Папка ${index}`,
  folder_path: `Общие/Папка ${String(index).padStart(2, '0')}`,
  access_level: index % 2 === 0 ? 'read' : 'write',
  member_count: index + 1,
  description: '',
}));

const mockedApi = groupsApi as jest.Mocked<typeof groupsApi>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.getGroupsAccessStatus.mockResolvedValue({
    status: 'ok',
    last_sync_at: '2026-09-02T12:00:00Z',
    error: '',
    branches: ['Тюмень'],
    summary: { group_count: groups.length, user_count: 100 },
  });
  mockedApi.listGroupsAccessGroups.mockResolvedValue({
    items: groups,
    total: groups.length,
    page: 1,
    limit: 40,
    has_more: false,
    synced_at: '2026-09-02T12:00:00Z',
  });
});

it('does not rerender mounted access-group cards for the refresh spinner', async () => {
  const view = await render(<NativeGroupsAccessScreen />);
  await waitFor(() => expect(view.getByText('Общие/Папка 09')).toBeTruthy());
  mockGroupIconRender.mockClear();

  mockedApi.listGroupsAccessGroups.mockReturnValueOnce(new Promise(() => undefined));
  await act(async () => {
    view.getByTestId('native-groups-access-groups-list').props.onRefresh();
  });

  expect(mockGroupIconRender).toHaveBeenCalledTimes(0);
});
