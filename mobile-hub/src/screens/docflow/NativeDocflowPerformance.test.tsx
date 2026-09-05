import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as docflowApi from '../../api/docflowApi';
import type { DocflowTaskSummary } from '../../api/docflowApi';
import { NativeDocflowInboxScreen } from './NativeDocflowInboxScreen';

const mockTaskCardRender = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'ivanov' },
    offlineMode: false,
    hasPermission: (permission: string) => permission === 'docflow.read',
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
}));

jest.mock('../../api/docflowApi', () => ({
  deleteDocflowCredentials: jest.fn(),
  getDocflowProfile: jest.fn(),
  listDocflowTasks: jest.fn(),
  saveDocflowCredentials: jest.fn(),
  testDocflowCredentials: jest.fn(),
}));

jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeCollectionSnapshot: jest.fn(async () => null),
  writeNativeCollectionSnapshot: jest.fn(async () => undefined),
}));

jest.mock('../../realtime/hubRealtimeSocket', () => ({
  hubRealtimeSocket: {
    onDocflowChanged: jest.fn(() => jest.fn()),
    on: jest.fn(() => jest.fn()),
  },
}));

jest.mock('../../components/docflow/NativeDocflowTaskCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    NativeDocflowTaskCard: React.memo(({ task }: { task: { ref: string; title: string } }) => {
      mockTaskCardRender(task.ref);
      return React.createElement(Text, null, task.title);
    }),
  };
});

const profile = {
  configured: true,
  login: 'ivanov',
  status: 'valid' as const,
  last_error_code: null,
  last_verified_at: null,
  updated_at: null,
};

const tasks: DocflowTaskSummary[] = Array.from({ length: 30 }, (_, index) => ({
  ref: `task-${index}`,
  task_type: 'task',
  task_type_label: 'Задание исполнителя',
  title: `Document task ${String(index).padStart(2, '0')}`,
  number: null,
  created_at: '2026-09-02T10:00:00+05:00',
  due_at: '2026-09-03T10:00:00+05:00',
  author: 'Author',
  subject: null,
  description: null,
  result: null,
  business_state: null,
  importance: null,
  accepted: null,
  completed_at: null,
  completed: false,
}));

const mockedApi = docflowApi as jest.Mocked<typeof docflowApi>;

it('does not rerender 1C DO task cards for a draft keystroke or refresh spinner', async () => {
  mockedApi.getDocflowProfile
    .mockResolvedValueOnce(profile)
    .mockReturnValueOnce(new Promise(() => undefined));
  mockedApi.listDocflowTasks.mockResolvedValue({
    items: tasks,
    returned: tasks.length,
    scope: 'inbox',
    source: 'live_1c',
    as_of: '2026-09-02T10:00:00+05:00',
    truncated: false,
  });

  const view = await render(<NativeDocflowInboxScreen />);
  await waitFor(() => expect(view.getByText('Document task 00')).toBeTruthy());
  mockTaskCardRender.mockClear();

  await fireEvent.changeText(view.getByTestId('native-docflow-search'), 'd');
  const draftTypingRenders = mockTaskCardRender.mock.calls.length;
  mockTaskCardRender.mockClear();

  await act(async () => {
    view.getByTestId('native-docflow-list').props.onRefresh();
  });
  const refreshSpinnerRenders = mockTaskCardRender.mock.calls.length;

  expect({ draftTypingRenders, refreshSpinnerRenders }).toEqual({
    draftTypingRenders: 0,
    refreshSpinnerRenders: 0,
  });
});
