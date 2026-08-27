import { act, render, waitFor } from '@testing-library/react-native';
import * as chatApi from '../api/chatApi';
import * as docflowApi from '../api/docflowApi';
import * as hubApi from '../api/hubApi';
import * as notificationApi from '../api/notificationApi';
import { writeNativeSnapshot } from '../cache/nativeSnapshotCache';
import { DashboardScreen } from './DashboardScreen';

let mockOfflineMode = false;

jest.mock('../api/chatApi', () => ({ getUnreadSummary: jest.fn() }));
jest.mock('../api/docflowApi', () => ({ getInboxSummary: jest.fn() }));
jest.mock('../api/hubApi', () => ({ getHubDashboard: jest.fn() }));
jest.mock('../api/notificationApi', () => ({ getMailUnreadSnapshot: jest.fn() }));
jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'cached-user', full_name: 'Иван Иванов', role: 'user', permissions: [] },
    offlineMode: mockOfflineMode,
    hasPermission: () => true,
  }),
}));
jest.mock('../preferences/PreferencesContext', () => ({
  usePreferences: () => ({
    preferences: {
      theme_mode: 'system',
      dashboard_sections: ['attention', 'tasks', 'communication', 'news'],
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
  beforeEach(() => {
    mockOfflineMode = false;
    jest.clearAllMocks();
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
});
