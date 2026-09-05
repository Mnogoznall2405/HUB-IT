import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as taskApi from '../../api/taskApi';
import type { HubTask } from '../../api/taskApi';
import { NativeTasksInboxScreen } from './NativeTasksInboxScreen';

const mockTaskRowRender = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'ivanov', role: 'user' },
    offlineMode: false,
    hasPermission: (permission: string) => permission === 'tasks.read',
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
}));

jest.mock('../../api/taskApi', () => ({
  getTasksPage: jest.fn(),
  searchTaskAssignees: jest.fn(),
  searchTaskControllers: jest.fn(),
}));

jest.mock('../../api/departmentsApi', () => ({
  listDepartments: jest.fn(),
}));

jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeCollectionSnapshot: jest.fn(async () => null),
  writeNativeCollectionSnapshot: jest.fn(async () => undefined),
}));

jest.mock('../../realtime/hubRealtimeSocket', () => ({
  hubRealtimeSocket: {
    onTaskChanged: jest.fn(() => jest.fn()),
    on: jest.fn(() => jest.fn()),
  },
}));

jest.mock('../../components/tasks/NativeTaskRow', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    NativeTaskRow: React.memo(({ task }: { task: { id: string; title: string } }) => {
      mockTaskRowRender(task.id);
      return React.createElement(Text, null, task.title);
    }),
  };
});

const tasks: HubTask[] = Array.from({ length: 30 }, (_, index) => ({
  id: `task-${index}`,
  title: `Task ${String(index).padStart(2, '0')}`,
  status: 'in_progress',
  priority: 'normal',
  created_by_full_name: 'Author',
  updated_at: '2026-09-02T10:00:00+05:00',
}));

const mockedApi = taskApi as jest.Mocked<typeof taskApi>;

it('does not rerender mounted task rows for a draft keystroke or refresh spinner', async () => {
  mockedApi.getTasksPage
    .mockResolvedValueOnce({ items: tasks, total: tasks.length, limit: 40, offset: 0 })
    .mockReturnValueOnce(new Promise(() => undefined));

  const view = await render(<NativeTasksInboxScreen />);
  await waitFor(() => expect(view.getByText('Task 00')).toBeTruthy());
  mockTaskRowRender.mockClear();

  await fireEvent.changeText(view.getByTestId('native-tasks-search'), 't');
  const draftTypingRenders = mockTaskRowRender.mock.calls.length;
  mockTaskRowRender.mockClear();

  await act(async () => {
    view.getByTestId('native-tasks-list').props.onRefresh();
  });
  const refreshSpinnerRenders = mockTaskRowRender.mock.calls.length;

  expect({ draftTypingRenders, refreshSpinnerRenders }).toEqual({
    draftTypingRenders: 0,
    refreshSpinnerRenders: 0,
  });
});
