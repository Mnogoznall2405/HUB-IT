import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { NativeAdminDepartmentsScreen } from './NativeAdminDepartmentsScreen';
import { NativeAdminSessionsScreen } from './NativeAdminSessionsScreen';
import { NativeAdminUsersScreen } from './NativeAdminUsersScreen';
import * as sessionsApi from '../../api/authSessionsApi';
import * as departmentsApi from '../../api/departmentsApi';
import * as userAdminApi from '../../api/authUserAdminApi';
import { listAvailableDatabases } from '../../api/databaseApi';

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', role: 'admin', permissions: [] },
    hasPermission: () => true,
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => {
  const { DEFAULT_PREFERENCES } = jest.requireActual('../../preferences/preferenceNormalizers');
  return {
    usePreferences: () => ({ preferences: DEFAULT_PREFERENCES }),
  };
});

jest.mock('../../api/departmentsApi');
jest.mock('../../api/authUserAdminApi');
jest.mock('../../api/authSessionsApi');
jest.mock('../../api/databaseApi', () => ({ listAvailableDatabases: jest.fn() }));

const departmentMocks = departmentsApi as jest.Mocked<typeof departmentsApi>;
const userMocks = userAdminApi as jest.Mocked<typeof userAdminApi>;
const sessionMocks = sessionsApi as jest.Mocked<typeof sessionsApi>;
const databaseMock = listAvailableDatabases as jest.MockedFunction<typeof listAvailableDatabases>;

beforeEach(() => {
  jest.clearAllMocks();
  departmentMocks.listDepartments.mockResolvedValue([
    { id: 'it', name: 'ИТ', members_count: 8, managers_count: 2 },
    { id: 'finance', name: 'Финансы', members_count: 4, managers_count: 1 },
  ]);
  departmentMocks.getDepartmentMembers.mockResolvedValue([]);
  departmentMocks.syncDepartmentsFromAd.mockResolvedValue();
  departmentMocks.syncDepartmentsFromUsers.mockResolvedValue();
  userMocks.listUsers.mockResolvedValue([]);
  sessionMocks.listSessions.mockResolvedValue([]);
  sessionMocks.normalizeSessionLimit.mockResolvedValue({});
  databaseMock.mockResolvedValue([]);
});

afterEach(() => jest.restoreAllMocks());

it('filters departments locally and displays backend counter names', async () => {
  const view = await render(<NativeAdminDepartmentsScreen />);

  await waitFor(() => expect(view.getByText('Сотрудников: 8 · руководителей: 2')).toBeTruthy());
  expect(departmentMocks.listDepartments).toHaveBeenCalledWith();

  await act(async () => {
    fireEvent.changeText(view.getByTestId('text-input-outlined'), 'фин');
  });

  await waitFor(() => expect(view.queryByText('ИТ')).toBeNull());
  expect(view.getByText('Финансы')).toBeTruthy();
  expect(departmentMocks.listDepartments).toHaveBeenCalledTimes(1);
});

it('asks for confirmation before synchronizing departments', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<NativeAdminDepartmentsScreen />);
  await waitFor(() => expect(view.getByText('ИТ')).toBeTruthy());

  fireEvent.press(view.getByText('Синхронизация из AD'));

  expect(departmentMocks.syncDepartmentsFromAd).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'Синхронизировать отделы из AD?',
    expect.any(String),
    expect.any(Array),
  );
});

it('shows an existing username as immutable', async () => {
  userMocks.listUsers.mockResolvedValue([{
    id: 9,
    username: 'ivanov',
    full_name: 'Иванов Иван',
    role: 'viewer',
    permissions: [],
    is_active: true,
  }]);
  const view = await render(<NativeAdminUsersScreen />);
  await waitFor(() => expect(view.getByText('Иванов Иван')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByText('Иванов Иван').parent as never);
  });

  await waitFor(() => expect(view.getByDisplayValue('ivanov').props.editable).toBe(false));
  expect(view.getByText('Логин существующей учётной записи изменить нельзя.')).toBeTruthy();
});

it('previews session-limit normalization before applying it', async () => {
  sessionMocks.listSessions.mockResolvedValue([
    { session_id: 'active-1', user_id: 1, username: 'admin', status: 'active', is_active: true },
    { session_id: 'closed-1', user_id: 2, username: 'viewer', status: 'terminated', is_active: false },
  ]);
  sessionMocks.normalizeSessionLimit
    .mockResolvedValueOnce({ limit: 3, users_affected: 1, sessions_to_close: 2, sessions_closed: 0 })
    .mockResolvedValueOnce({ limit: 3, users_affected: 1, sessions_to_close: 2, sessions_closed: 2 });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<NativeAdminSessionsScreen />);
  await waitFor(() => expect(view.getByText('Проверить лимит сессий')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByText('Проверить лимит сессий'));
  });

  await waitFor(() => expect(sessionMocks.normalizeSessionLimit).toHaveBeenCalledWith(false));
  expect(sessionMocks.normalizeSessionLimit).not.toHaveBeenCalledWith(true);
  expect(view.getAllByText('Завершить')).toHaveLength(1);

  const buttons = alert.mock.calls.at(-1)?.[2] as Array<{ text?: string; onPress?: () => void }>;
  await act(async () => {
    buttons.find((button) => button.text === 'Закрыть сессии')?.onPress?.();
  });
  await waitFor(() => expect(sessionMocks.normalizeSessionLimit).toHaveBeenCalledWith(true));
});
