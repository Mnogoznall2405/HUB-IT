import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as chatApi from '../api/chatApi';
import * as docflowApi from '../api/docflowApi';
import * as hubApi from '../api/hubApi';
import * as notificationApi from '../api/notificationApi';
import {
  clearNativeSnapshots,
  writeNativeCollectionSnapshot,
  writeNativeSnapshot,
} from '../cache/nativeSnapshotCache';
import { openPortalPath } from '../navigation/moduleRegistry';
import * as nativeUnreadSnapshot from '../notifications/nativeUnreadSnapshot';
import { DashboardScreen } from './DashboardScreen';

let mockOfflineMode = false;
let mockDeniedPermissions: string[] = [];

const docflowAbsences = {
  status: 'available' as const,
  items: [{
    id: 'docflow:abs-1',
    employee_code: 'E-1',
    matching_status: 'matched' as const,
    display_name: 'Петров Пётр',
    starts_on: '2026-08-20',
    ends_on: '2026-08-25',
    kind: 'vacation',
    label: 'Отпуск',
    comment: 'Плановый отпуск',
    will_handle_tasks: false,
    differences: [] as string[],
  }],
  count: 1,
  unresolved_count: 0,
  as_of: '2026-08-24T10:00:00+05:00',
  zup_comparison: 'available' as const,
};

const emptyDashboard = () => ({
  announcements: { items: [], total: 0 },
  my_tasks: { items: [], total: 0 },
  unread_counts: {},
  summary: {},
  absences_today: { count: 0, items: [] },
});

jest.mock('../api/chatApi', () => ({ getUnreadSummary: jest.fn() }));
jest.mock('../api/docflowApi', () => ({ getInboxSummary: jest.fn(), listDocflowAbsences: jest.fn() }));
jest.mock('../api/hubApi', () => ({ getHubDashboard: jest.fn() }));
jest.mock('../api/notificationApi', () => ({ getMailUnreadSnapshot: jest.fn() }));
jest.mock('../notifications/nativeUnreadSnapshot', () => ({
  getNativeUnreadSnapshot: jest.fn(),
}));
jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'cached-user', full_name: 'Иван Иванов', role: 'user', permissions: [] },
    offlineMode: mockOfflineMode,
    hasPermission: (permission: string) => !mockDeniedPermissions.includes(permission),
  }),
}));
jest.mock('../preferences/PreferencesContext', () => ({
  usePreferences: () => ({
    preferences: {
      theme_mode: 'system',
      dashboard_sections: ['attention', 'tasks', 'absences', 'communication', 'news'],
      dashboard_mobile_sections: [],
    },
    savePreferences: jest.fn(),
  }),
}));
jest.mock('../navigation/useNativeBottomNavInset', () => ({ useNativeBottomNavInset: () => 0 }));
jest.mock('../navigation/moduleRegistry', () => ({
  openNativeNotifications: jest.fn(),
  openPortalPath: jest.fn(),
}));

describe('DashboardScreen cache', () => {
  beforeEach(async () => {
    mockOfflineMode = false;
    mockDeniedPermissions = [];
    jest.clearAllMocks();
    await clearNativeSnapshots(1);
    jest.mocked(hubApi.getHubDashboard).mockReset();
    jest.mocked(docflowApi.getInboxSummary).mockReset().mockResolvedValue({ status: 'available', count: 0, truncated: false });
    jest.mocked(docflowApi.listDocflowAbsences).mockReset().mockResolvedValue(docflowAbsences);
    jest.mocked(nativeUnreadSnapshot.getNativeUnreadSnapshot).mockResolvedValue({
      tasks_open: 0,
      tasks_open_total: 0,
      chat_messages_unread_total: 3,
      mail_unread: 2,
      mail_state: 'ok',
      notifications_unread_total: 0,
      announcements_unread: 0,
      successful_sources: 3,
    });
  });


it('QR button navigates to the full inventory scanner route', async () => {
    jest.mocked(hubApi.getHubDashboard).mockResolvedValueOnce({
      announcements: { items: [], total: 0 },
      my_tasks: { items: [], total: 0 },
      unread_counts: {},
      summary: {},
      absences_today: { count: 0, items: [] },
    });

    const view = await render(<DashboardScreen />);
    await act(async () => {});

    await fireEvent.press(view.getByLabelText('Сканировать QR'));

    expect(openPortalPath).toHaveBeenCalledWith('/database?scan=1');
  });

  it('offline pull refresh must not issue API reads', async () => {
    mockOfflineMode=true;
    const view = await render(<DashboardScreen />);
    await act(async () => {});
    expect(hubApi.getHubDashboard).not.toHaveBeenCalled();
    const {fireEvent}=require('@testing-library/react-native');
    await fireEvent.press(view.getByLabelText('Обновить главную'));
    await act(async () => { await view.getByTestId('native-dashboard-scroll').props.refreshControl.props.onRefresh(); });
    expect(hubApi.getHubDashboard).not.toHaveBeenCalled();
  });
  it('keeps the newer refresh when initial loading finishes last', async () => {
    let finish!: (value: hubApi.HubDashboard) => void;
    const payload = (title: string) => ({ announcements: { items: [], total: 0 }, my_tasks: {
      items: [{ id: title, title, status: 'open' }], total: 1,
    }, unread_counts: {}, summary: {}, absences_today: { count: 0, items: [] } });
    jest.mocked(hubApi.getHubDashboard).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    jest.mocked(hubApi.getHubDashboard).mockResolvedValueOnce(payload('New refresh'));
    const view = await render(<DashboardScreen />);
    await waitFor(() => expect(hubApi.getHubDashboard).toHaveBeenCalledTimes(1));
    await act(async () => { await view.getByTestId('native-dashboard-scroll').props.refreshControl.props.onRefresh(); });
    await waitFor(() => expect(view.getByText('New refresh')).toBeTruthy());
    await act(async () => finish(payload('Old initial')));
    expect(view.queryByText('Old initial')).toBeNull();
    expect(view.getByText('New refresh')).toBeTruthy();
  });
  it('reuses the shared unread snapshot instead of loading Chat and Mail counters separately', async () => {
    jest.mocked(hubApi.getHubDashboard).mockResolvedValueOnce({
      announcements: { items: [], total: 0 },
      my_tasks: { items: [], total: 0 },
      unread_counts: {},
      summary: {},
      absences_today: { count: 0, items: [] },
    });
    jest.mocked(docflowApi.getInboxSummary).mockResolvedValueOnce({
      status: 'available', count: 0, truncated: false,
    });

    await render(<DashboardScreen />);

    await waitFor(() => expect(nativeUnreadSnapshot.getNativeUnreadSnapshot).toHaveBeenCalled());
    expect(chatApi.getUnreadSummary).not.toHaveBeenCalled();
    expect(notificationApi.getMailUnreadSnapshot).not.toHaveBeenCalled();
  });

  it('shows the encrypted local snapshot before the live dashboard request completes', async () => {
    await writeNativeSnapshot('dashboard', 1, {
      payload: {
        announcements: { items: [], total: 0 },
        my_tasks: {
          items: [{ id: 'cached-task', title: 'Кэшированная задача', status: 'open' }],
          total: 1,
        },
        unread_counts: {},
        summary: {},
        absences_today: { count: 0, items: [] },
      },
      communicationCounts: { chat: 3, mail: 2 },
      docflowSummary: { status: 'available', count: 0, truncated: false },
    });
    let resolveDashboard: ((value: Awaited<ReturnType<typeof hubApi.getHubDashboard>>) => void) | undefined;
    jest.mocked(hubApi.getHubDashboard).mockImplementationOnce(() => new Promise((resolve) => {
      resolveDashboard = resolve;
    }));
    jest.mocked(chatApi.getUnreadSummary).mockResolvedValueOnce({
      messages_unread_total: 3,
      conversations_unread: 2,
    });
    jest.mocked(notificationApi.getMailUnreadSnapshot).mockResolvedValueOnce({
      unread_count: 2,
      state: 'available',
    });
    jest.mocked(docflowApi.getInboxSummary).mockResolvedValueOnce({
      status: 'available',
      count: 0,
      truncated: false,
    });

    const view = await render(<DashboardScreen />);

    await waitFor(() => expect(view.getByText('Кэшированная задача')).toBeTruthy());
    expect(hubApi.getHubDashboard).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDashboard?.({
        announcements: { items: [], total: 0 },
        my_tasks: { items: [], total: 0 },
        unread_counts: {},
        summary: {},
        absences_today: { count: 0, items: [] },
      });
    });
  });

  it('renders the saved dashboard without protected network calls in offline mode', async () => {
    mockOfflineMode = true;
    await writeNativeSnapshot('dashboard', 1, {
      payload: {
        announcements: { items: [], total: 0 },
        my_tasks: {
          items: [{ id: 'offline-task', title: 'Офлайн-задача', status: 'open' }],
          total: 1,
        },
        unread_counts: {},
        summary: {},
        absences_today: { count: 0, items: [] },
      },
      communicationCounts: { chat: 1, mail: 1 },
      docflowSummary: { status: 'available', count: 2, truncated: false },
    });

    const view = await render(<DashboardScreen />);

    await waitFor(() => expect(view.getByText('Офлайн-задача')).toBeTruthy());
    expect(hubApi.getHubDashboard).not.toHaveBeenCalled();
    expect(chatApi.getUnreadSummary).not.toHaveBeenCalled();
    expect(notificationApi.getMailUnreadSnapshot).not.toHaveBeenCalled();
    expect(docflowApi.getInboxSummary).not.toHaveBeenCalled();
  });

  it('shows the docflow absence list inside the absences section', async () => {
    jest.mocked(hubApi.getHubDashboard).mockResolvedValue(emptyDashboard());

    const view = await render(<DashboardScreen />);
    await act(async () => {
      fireEvent.press(await view.findByLabelText('Документооборот · отсутствия'));
    });

    await waitFor(() => expect(view.getByText('Петров Пётр')).toBeTruthy());
    expect(view.getByText('Отпуск · 20.08.2026 — 25.08.2026 включительно')).toBeTruthy();
    expect(view.getByText('Плановый отпуск')).toBeTruthy();
    expect(view.getByText('Не будет разбирать задачи')).toBeTruthy();
    expect(view.getByText(/Источник: 1С:Документооборот · 1 записей/)).toBeTruthy();
    expect(docflowApi.listDocflowAbsences).toHaveBeenCalledWith(
      expect.objectContaining({ employeeCode: '' }),
    );
  });

  it('points to the 1C credentials setup when absences need them', async () => {
    jest.mocked(hubApi.getHubDashboard).mockResolvedValue(emptyDashboard());
    jest.mocked(docflowApi.listDocflowAbsences).mockRejectedValue(Object.assign(new Error('conflict'), {
      isAxiosError: true,
      response: { data: { detail: { code: 'DOCFLOW_CREDENTIALS_REQUIRED', message: 'Подключите' } } },
    }));

    const view = await render(<DashboardScreen />);
    await act(async () => {
      fireEvent.press(await view.findByLabelText('Документооборот · отсутствия'));
    });

    await waitFor(() => expect(view.getByText(/Подключите свою учётную запись 1С/)).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('docflow-absences-connect'));
    });
    expect(openPortalPath).toHaveBeenCalledWith('/docflow');
  });

  it('shows the unavailable error and retries the absences request', async () => {
    jest.mocked(hubApi.getHubDashboard).mockResolvedValue(emptyDashboard());
    jest.mocked(docflowApi.listDocflowAbsences).mockRejectedValue(new Error('timeout'));

    const view = await render(<DashboardScreen />);
    await act(async () => {
      fireEvent.press(await view.findByLabelText('Документооборот · отсутствия'));
    });

    await waitFor(() => expect(view.getByText('Отсутствия Документооборота недоступны.')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('docflow-absences-retry'));
    });
    await waitFor(() => expect(docflowApi.listDocflowAbsences).toHaveBeenCalledTimes(2));
  });

  it('hides the docflow absences card without the address_book permission', async () => {
    mockDeniedPermissions = ['address_book.read'];
    jest.mocked(hubApi.getHubDashboard).mockResolvedValue(emptyDashboard());

    const view = await render(<DashboardScreen />);

    await waitFor(() => expect(view.getByText('Сегодня все на месте')).toBeTruthy());
    expect(view.queryByLabelText('Документооборот · отсутствия')).toBeNull();
    expect(docflowApi.listDocflowAbsences).not.toHaveBeenCalled();
  });

  it('serves the saved absence list in offline mode without a request', async () => {
    mockOfflineMode = true;
    await writeNativeCollectionSnapshot(
      'docflow-absences',
      1,
      JSON.stringify({ employee_code: '' }),
      docflowAbsences,
    );

    const view = await render(<DashboardScreen />);
    await act(async () => {
      fireEvent.press(await view.findByLabelText('Документооборот · отсутствия'));
    });

    await waitFor(() => expect(view.getByText('Петров Пётр')).toBeTruthy());
    expect(view.getByText('Не удалось обновить. Показаны сохранённые отсутствия.')).toBeTruthy();
    expect(docflowApi.listDocflowAbsences).not.toHaveBeenCalled();
  });

  it('shows the offline error when no saved absence list exists', async () => {
    mockOfflineMode = true;

    const view = await render(<DashboardScreen />);
    await act(async () => {
      fireEvent.press(await view.findByLabelText('Документооборот · отсутствия'));
    });

    await waitFor(() => expect(view.getByText('Нет подключения и сохранённых отсутствий.')).toBeTruthy());
    expect(docflowApi.listDocflowAbsences).not.toHaveBeenCalled();
  });
});
