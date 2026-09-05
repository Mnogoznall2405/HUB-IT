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

function mockUserDirectory(items: userAdminApi.AdminUser[]) {
  userMocks.searchUsers.mockImplementation(async (params = {}) => {
    const query = String(params.q || '').trim().toLowerCase();
    const ids = new Set(params.ids || []);
    let matched = items.filter((item) => {
      if (ids.size > 0 && !ids.has(item.id)) return false;
      if (params.excludeUserId && item.id === params.excludeUserId) return false;
      if (params.status === 'active' && item.is_active === false) return false;
      if (params.status === 'inactive' && item.is_active !== false) return false;
      if (params.role && params.role !== 'all' && item.role !== params.role) return false;
      if (!query) return true;
      return [item.username, item.full_name, item.department, item.job_title, item.email]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
    const total = matched.length;
    const offset = params.offset || 0;
    const limit = params.limit || 50;
    matched = matched.slice(offset, offset + limit);
    return { items: matched, total, offset, limit, has_more: offset + matched.length < total };
  });
}

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
  mockUserDirectory([]);
  userMocks.getTaskDelegates.mockResolvedValue([]);
  userMocks.updateTaskDelegates.mockResolvedValue([]);
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
  mockUserDirectory([{
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

it('keeps assigned delegates visible and searches other candidates by name', async () => {
  mockUserDirectory([
    { id: 9, username: 'ivanov', full_name: 'Иванов Иван', role: 'viewer', permissions: [], is_active: true },
    { id: 10, username: 'petrova', full_name: 'Петрова Анна', department: 'ИТ', job_title: 'Инженер', role: 'viewer', permissions: [], is_active: true },
    { id: 11, username: 'sidorov', full_name: 'Сидоров Пётр', department: 'Снабжение', job_title: 'Специалист', role: 'viewer', permissions: [], is_active: true },
  ]);
  userMocks.getTaskDelegates.mockResolvedValue([
    {
      owner_user_id: 9,
      delegate_user_id: 10,
      role_type: 'assistant',
      is_active: true,
      delegate_username: 'petrova',
      delegate_full_name: 'Петрова Анна',
    },
  ]);

  const view = await render(<NativeAdminUsersScreen />);
  await waitFor(() => expect(view.getByText('Иванов Иван')).toBeTruthy());
  await act(async () => {
    fireEvent.press(view.getByText('Иванов Иван').parent as never);
  });

  await waitFor(() => expect(view.getByTestId('native-admin-delegate-search')).toBeTruthy());
  expect(view.getByText('Петрова Анна')).toBeTruthy();
  expect(view.queryByText('Сидоров Пётр')).toBeNull();

  await act(async () => {
    fireEvent.changeText(view.getByTestId('native-admin-delegate-search'), 'сидоров');
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  await waitFor(() => expect(view.getByText('Сидоров Пётр')).toBeTruthy());
  expect(userMocks.listUsers).not.toHaveBeenCalled();
  expect(userMocks.searchUsers).toHaveBeenCalledWith(expect.objectContaining({
    q: 'сидоров',
    limit: 30,
    status: 'active',
    excludeUserId: 9,
  }));
});

it('reports that the profile was saved when delegate update fails', async () => {
  mockUserDirectory([{
    id: 9,
    username: 'ivanov',
    full_name: 'Иванов Иван',
    role: 'viewer',
    permissions: [],
    is_active: true,
  }]);
  userMocks.updateTaskDelegates.mockRejectedValueOnce(new Error('network unavailable'));

  const view = await render(<NativeAdminUsersScreen />);
  await waitFor(() => expect(view.getByText('Иванов Иван')).toBeTruthy());
  await act(async () => {
    fireEvent.press(view.getByText('Иванов Иван').parent as never);
  });
  await waitFor(() => expect(view.getByText('Сохранить')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByText('Сохранить'));
  });

  await waitFor(() => expect(view.getByText(/Профиль сохранён, но назначения/)).toBeTruthy());
  expect(userMocks.updateUser).toHaveBeenCalledTimes(1);
  expect(userMocks.updateTaskDelegates).toHaveBeenCalledTimes(1);
});

it('places role and permissions before task delegation', async () => {
  mockUserDirectory([{
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
  await waitFor(() => expect(view.getByText('Роль и права доступа')).toBeTruthy());

  const rendered = JSON.stringify(view.toJSON());
  expect(rendered.indexOf('Роль и права доступа')).toBeLessThan(rendered.indexOf('Помощники и заместители'));
  expect(view.getByText('Права роли · Просмотр')).toBeTruthy();
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
