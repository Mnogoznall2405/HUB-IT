import { File, Paths } from 'expo-file-system';
import { clearNativeFormDrafts } from '../../drafts/nativeFormDrafts';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as departmentsApi from '../../api/departmentsApi';
import * as taskApi from '../../api/taskApi';
import { readNativeEntitySnapshot, writeNativeEntitySnapshot } from '../../cache/nativeSnapshotCache';
import { DEFAULT_PREFERENCES, type UserPreferences } from '../../preferences/preferenceNormalizers';
import * as nativeTaskFiles from '../../tasks/nativeTaskFiles';
import { hubRealtimeSocket } from '../../realtime/hubRealtimeSocket';
import { NativeTaskCreateScreen } from './NativeTaskCreateScreen';
import { NativeTaskDetailScreen } from './NativeTaskDetailScreen';
import { NativeTasksInboxScreen } from './NativeTasksInboxScreen';

let mockAuth: {
  user: { id: number; username: string; role: string; permissions: string[] };
  offlineMode: boolean;
  hasPermission: (permission: string) => boolean;
};

let mockPreferences: {
  preferences: UserPreferences;
  loading: boolean;
  refreshPreferences: jest.Mock;
  savePreferences: jest.Mock;
};

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => mockPreferences,
}));

jest.mock('../../api/taskApi', () => ({
  getTasksPage: jest.fn(),
  getTask: jest.fn(),
  getTaskComments: jest.fn(),
  getTaskStatusLog: jest.fn(),
  markTaskCommentsSeen: jest.fn(),
  addTaskComment: jest.fn(),
  startTask: jest.fn(),
  submitTask: jest.fn(),
  reviewTask: jest.fn(),
  completeTask: jest.fn(),
  reopenTask: jest.fn(),
  openTaskDiscussion: jest.fn(),
  getTaskProjects: jest.fn(),
  getTaskObjects: jest.fn(),
  searchTaskAssignees: jest.fn(),
  searchTaskControllers: jest.fn(),
  createTask: jest.fn(),
  createTaskProject: jest.fn(),
  createTaskObject: jest.fn(),
  updateTask: jest.fn(),
  uploadTaskAttachment: jest.fn(),
  deleteTask: jest.fn(),
}));

jest.mock('../../api/departmentsApi', () => ({
  listDepartments: jest.fn(),
}));

jest.mock('../../tasks/nativeTaskFiles', () => ({
  downloadNativeTaskAttachment: jest.fn(),
  pickNativeTaskFile: jest.fn(),
}));

jest.mock('../../files/nativeAttachmentDownloads', () => ({
  openNativeFile: jest.fn(),
}));

const mockedUseLocalSearchParams = useLocalSearchParams as jest.Mock;

const listTask = {
  id: 'task-1',
  title: 'Настроить сервер',
  status: 'new',
  priority: 'high',
  due_at: '2026-08-31T18:00:00',
  assignee_full_name: 'Иван Петров',
  has_unread_comments: true,
};

const detailTask = {
  ...listTask,
  description: 'Установить обновления и проверить сервисы.',
  created_by_full_name: 'Мария Сидорова',
  controller_full_name: 'Алексей Орлов',
  project_name: 'Общие задачи',
  capabilities: { can_start: true, can_open_discussion: false },
};

function setAuth(permissions = ['tasks.read', 'tasks.create']) {
  mockAuth = {
    user: { id: 1, username: 'user', role: 'user', permissions },
    offlineMode: false,
    hasPermission: (permission) => permissions.includes(permission),
  };
}

describe('Native Tasks screens', () => {
  beforeEach(async () => {
    await clearNativeFormDrafts();
    jest.clearAllMocks();
    mockedUseLocalSearchParams.mockReturnValue({});
    setAuth();
    mockPreferences = {
      preferences: { ...DEFAULT_PREFERENCES },
      loading: false,
      refreshPreferences: jest.fn(),
      savePreferences: jest.fn(),
    };
    (taskApi.getTasksPage as jest.Mock).mockResolvedValue({
      items: [listTask],
      total: 1,
      limit: 40,
      offset: 0,
    });
    (taskApi.getTask as jest.Mock).mockResolvedValue(detailTask);
    (taskApi.getTaskComments as jest.Mock).mockResolvedValue([
      { id: 'comment-1', body: 'Проверьте резервную копию', full_name: 'Мария Сидорова' },
    ]);
    (taskApi.getTaskStatusLog as jest.Mock).mockResolvedValue([
      { id: 'log-1', old_status: 'new', new_status: 'in_progress', changed_by_username: 'petrov', changed_at: '2026-08-24T10:00:00Z' },
    ]);
    (taskApi.markTaskCommentsSeen as jest.Mock).mockResolvedValue(undefined);
    (taskApi.addTaskComment as jest.Mock).mockResolvedValue({
      id: 'comment-2',
      body: 'Готово',
      full_name: 'Я',
    });
    (taskApi.startTask as jest.Mock).mockResolvedValue({
      ...detailTask,
      status: 'in_progress',
      capabilities: { can_submit: true, can_open_discussion: false },
    });
    (taskApi.openTaskDiscussion as jest.Mock).mockResolvedValue({
      conversation_id: 'task-conversation-1',
      created: true,
      kind: 'task',
    });
    (taskApi.getTaskProjects as jest.Mock).mockResolvedValue([
      { id: 'general-tasks', name: 'Общие задачи', code: 'GENERAL', is_active: true },
    ]);
    (taskApi.searchTaskAssignees as jest.Mock).mockResolvedValue([
      { id: 7, full_name: 'Иван Петров', username: 'petrov', job_title: 'Инженер' },
      { id: 8, full_name: 'Анна Смирнова', username: 'smirnova', job_title: 'Руководитель' },
    ]);
    (taskApi.searchTaskControllers as jest.Mock).mockResolvedValue([
      { id: 8, full_name: 'Анна Смирнова', username: 'smirnova', job_title: 'Руководитель' },
    ]);
    (taskApi.getTaskObjects as jest.Mock).mockResolvedValue([
      { id: 'object-1', project_id: 'general-tasks', name: 'Серверная', is_active: true },
    ]);
    (taskApi.createTask as jest.Mock).mockResolvedValue([{ id: 'created-task-1' }]);
    (taskApi.createTaskProject as jest.Mock).mockResolvedValue({ id: 'project-2', name: 'Проект Север' });
    (taskApi.createTaskObject as jest.Mock).mockResolvedValue({ id: 'object-2', project_id: 'general-tasks', name: 'Новая серверная' });
    (departmentsApi.listDepartments as jest.Mock).mockResolvedValue([{ id: 'department-1', name: 'ИТ' }]);
    (taskApi.updateTask as jest.Mock).mockImplementation(async (_taskId, payload) => ({
      ...detailTask,
      ...payload,
      capabilities: {
        ...detailTask.capabilities,
        can_edit: true,
        can_update_checklist: true,
        can_upload_files: true,
      },
    }));
    (taskApi.uploadTaskAttachment as jest.Mock).mockResolvedValue({
      id: 'attachment-2',
      file_name: 'report.pdf',
      file_mime: 'application/pdf',
      file_size: 512,
    });
    (taskApi.deleteTask as jest.Mock).mockResolvedValue({ ok: true, task_id: 'task-1' });
    (nativeTaskFiles.pickNativeTaskFile as jest.Mock).mockResolvedValue({
      uri: new File(Paths.cache, 'report.pdf').uri,
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 512,
    });
    const pickedFixture = await nativeTaskFiles.pickNativeTaskFile();
    if (pickedFixture) new File(pickedFixture.uri).write('x'.repeat(pickedFixture.size));
    jest.mocked(nativeTaskFiles.pickNativeTaskFile).mockClear();
  });


 it('loads and displays comments while status history is still pending',async()=>{
  let finish!: (value: unknown[]) => void;
  (taskApi.getTaskStatusLog as jest.Mock).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  (taskApi.getTaskComments as jest.Mock).mockResolvedValue([{id:'parallel-comment',body:'Visible before status',full_name:'Test author'}]);
  const view=await render(<NativeTaskDetailScreen taskId="parallel-task"/>);
  await waitFor(()=>expect(taskApi.getTaskStatusLog).toHaveBeenCalled());
  await waitFor(()=>expect(taskApi.getTaskComments).toHaveBeenCalled());
  await fireEvent.press(view.getByTestId('native-task-tab-discussion'));
  await waitFor(()=>expect(view.getByText('Visible before status')).toBeTruthy());
  await act(async()=>finish([]));
  await view.unmount();
 });
});
