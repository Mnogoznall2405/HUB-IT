import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import * as computersApi from '../../api/computersApi';
import type { ComputerRecord } from '../../api/computersApi';
import { NativeComputersScreen } from './NativeComputersScreen';

const mockComputerCardRender = jest.fn();

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: false,
    hasPermission: () => true,
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
}));

jest.mock('../../api/computersApi', () => ({
  searchComputers: jest.fn(),
  getComputersSummary: jest.fn(),
}));

jest.mock('../../components/computers/NativeComputerCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    NativeComputerCard: React.memo(({ computer }: { computer: ComputerRecord }) => {
      mockComputerCardRender(computer.mac_address);
      return React.createElement(Text, null, computer.hostname);
    }),
  };
});

const params = useLocalSearchParams as jest.Mock;
const computers = Array.from({ length: 30 }, (_, index) => ({
  mac_address: `AA:BB:CC:DD:EE:${String(index).padStart(2, '0')}`,
  hostname: `PC-${String(index).padStart(2, '0')}`,
  status: 'online',
  age_seconds: 30,
  current_user: '',
  user_login: '',
  user_full_name: '',
  branch_name: '',
  location_name: '',
  ip_primary: `10.0.0.${index + 1}`,
  has_hardware_changes: false,
  changes_count_30d: 0,
  is_unassigned: false,
})) as ComputerRecord[];

const mockedApi = computersApi as jest.Mocked<typeof computersApi>;

beforeEach(() => {
  jest.clearAllMocks();
  params.mockReturnValue({});
  mockedApi.searchComputers.mockResolvedValue({
    items: computers,
    total: computers.length,
    limit: 50,
    offset: 0,
    has_more: false,
    next_offset: null,
  });
  mockedApi.getComputersSummary.mockResolvedValue({
    total: computers.length,
    unassigned: 0,
    statuses: { online: computers.length },
    branches: {},
    outlook: {},
  });
});

it('does not rerender mounted computer cards for a draft keystroke or refresh spinner', async () => {
  const view = await render(<NativeComputersScreen />);
  await waitFor(() => expect(view.getByText('PC-00')).toBeTruthy());
  mockComputerCardRender.mockClear();

  await fireEvent.changeText(view.getByTestId('native-computers-search'), 'p');
  const draftTypingRenders = mockComputerCardRender.mock.calls.length;
  mockComputerCardRender.mockClear();

  mockedApi.searchComputers.mockReturnValueOnce(new Promise(() => undefined));
  await act(async () => {
    view.getByTestId('native-computers-list').props.onRefresh();
  });
  const refreshSpinnerRenders = mockComputerCardRender.mock.calls.length;

  expect({ draftTypingRenders, refreshSpinnerRenders }).toEqual({
    draftTypingRenders: 0,
    refreshSpinnerRenders: 0,
  });
});
