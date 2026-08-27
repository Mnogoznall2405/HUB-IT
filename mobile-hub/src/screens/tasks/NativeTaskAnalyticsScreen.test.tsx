import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as taskApi from '../../api/taskApi';
import * as nativeDownloads from '../../files/nativeAttachmentDownloads';
import * as nativeTaskFiles from '../../tasks/nativeTaskFiles';
import { NativeTaskAnalyticsScreen, taskAnalyticsRange } from './NativeTaskAnalyticsScreen';

let mockOfflineMode = false;
let mockPermissions = ['tasks.read'];

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: mockOfflineMode,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({
    preferences: jest.requireActual('../../preferences/preferenceNormalizers').DEFAULT_PREFERENCES,
  }),
}));

jest.mock('../../api/taskApi', () => ({
  getTaskAnalytics: jest.fn(),
  getTaskProjects: jest.fn(),
  getTaskObjects: jest.fn(),
  searchTaskAssignees: jest.fn(),
}));

jest.mock('../../tasks/nativeTaskFiles', () => ({
  downloadNativeTaskAnalytics: jest.fn(),
}));

jest.mock('../../files/nativeAttachmentDownloads', () => ({
  shareNativeFile: jest.fn(),
}));

const analyticsPayload = {
  summary: {
    total: 5,
    new: 1,
    in_progress: 2,
    review: 0,
    done: 2,
    open: 3,
    done_on_time: 1,
    done_without_due: 0,
    overdue: 1,
    with_due_total: 4,
    completion_percent: 40,
    completion_on_time_percent: 25,
  },
  by_participant: [{ participant_user_id: 7, participant_name: 'Иван Петров', total: 5, open: 3, in_progress: 2, overdue: 1 }],
  by_project: [{ project_id: 'p1', project_name: 'Проект', total: 5, open: 3, in_progress: 2, overdue: 1 }],
  by_object: [{ object_id: 'o1', object_name: 'Серверная', total: 5, open: 3, in_progress: 2, overdue: 1 }],
  status_breakdown: [
    { status: 'new', label: 'Новые', value: 1 },
    { status: 'done', label: 'Выполнено', value: 2 },
  ],
  trend: { granularity: 'day', items: [{ bucket_key: '2026-08-24', bucket_label: '24.08', created: 2, completed: 1, completed_on_time: 1 }] },
  truncated: false,
};

describe('NativeTaskAnalyticsScreen', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    jest.clearAllMocks();
    mockOfflineMode = false;
    mockPermissions = ['tasks.read'];
    (taskApi.getTaskAnalytics as jest.Mock).mockResolvedValue(analyticsPayload);
    (taskApi.getTaskProjects as jest.Mock).mockResolvedValue([{ id: 'p1', name: 'Проект' }]);
    (taskApi.getTaskObjects as jest.Mock).mockResolvedValue([{ id: 'o1', project_id: 'p1', name: 'Серверная' }]);
    (taskApi.searchTaskAssignees as jest.Mock).mockResolvedValue([{ id: 7, full_name: 'Иван Петров' }]);
    (nativeTaskFiles.downloadNativeTaskAnalytics as jest.Mock).mockResolvedValue({
      file: { uri: 'file:///analytics.xlsx' },
      fileName: 'analytics.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  });

  it('builds the same calendar presets as the web analytics', () => {
    expect(taskAnalyticsRange('7d', new Date(2026, 7, 24))).toEqual({ startDate: '2026-08-18', endDate: '2026-08-24' });
    expect(taskAnalyticsRange('quarter', new Date(2026, 7, 24))).toEqual({ startDate: '2026-07-01', endDate: '2026-08-24' });
  });

  it('loads native analytics and applies project, object and participant filters', async () => {
    const view = await render(<NativeTaskAnalyticsScreen />);
    await waitFor(() => expect(view.getByText('40%')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('native-task-analytics-filters-toggle')); });
    await waitFor(() => expect(view.getAllByText('Проект').length).toBeGreaterThan(0));
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-analytics-project-p1'));
    });
    await waitFor(() => expect(view.getByTestId('native-task-analytics-project-p1').props.accessibilityState.checked).toBe(true));
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-analytics-object-o1'));
      fireEvent.press(view.getByTestId('native-task-analytics-participant-7'));
    });
    await waitFor(() => expect(view.getByTestId('native-task-analytics-participant-7').props.accessibilityState.checked).toBe(true));
    await act(async () => { fireEvent.press(view.getByTestId('native-task-analytics-apply')); });
    await waitFor(() => expect(taskApi.getTaskAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({
      project_ids: ['p1'],
      object_ids: ['o1'],
      participant_user_ids: [7],
    })));
  });

  it('exports the applied slice through the Android share sheet', async () => {
    const view = await render(<NativeTaskAnalyticsScreen />);
    await waitFor(() => expect(view.getByText('40%')).toBeTruthy());
    expect(view.getByTestId('native-task-analytics-export')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByTestId('native-task-analytics-export')); });
    await waitFor(() => expect(nativeTaskFiles.downloadNativeTaskAnalytics).toHaveBeenCalled());
    expect(nativeDownloads.shareNativeFile).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'file:///analytics.xlsx' }),
      'analytics.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('does not request analytics without tasks.read', async () => {
    mockPermissions = [];
    const view = await render(<NativeTaskAnalyticsScreen />);
    await waitFor(() => expect(view.getByText('Нет доступа')).toBeTruthy());
    expect(taskApi.getTaskAnalytics).not.toHaveBeenCalled();
  });
});
