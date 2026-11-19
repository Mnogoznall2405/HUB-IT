import { File, Paths } from 'expo-file-system';
import { clearNativeFormDrafts } from '../../drafts/nativeFormDrafts';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import * as Clipboard from 'expo-clipboard';
import { Alert, Dimensions, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as departmentsApi from '../../api/departmentsApi';
import * as taskApi from '../../api/taskApi';
import { readNativeEntitySnapshot, writeNativeEntitySnapshot } from '../../cache/nativeSnapshotCache';
import { DEFAULT_PREFERENCES, type UserPreferences } from '../../preferences/preferenceNormalizers';
import * as nativeTaskFiles from '../../tasks/nativeTaskFiles';
import { nativeTaskDateKey } from '../../tasks/nativeTaskViews';
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
  createSubtask: jest.fn(),
  createTaskProject: jest.fn(),
  createTaskObject: jest.fn(),
  updateTask: jest.fn(),
  uploadTaskAttachment: jest.fn(),
  deleteTaskAttachment: jest.fn(),
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

  it('ignores an older task response after navigating to another task', async () => {
    let resolveOld!: (value: unknown) => void;
    (taskApi.getTask as jest.Mock).mockImplementation((id) => id === 'old-task'
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve({ ...detailTask, id: 'new-task', title: 'Current task' }));
    const view = await render(<NativeTaskDetailScreen taskId="old-task" />);
    await waitFor(() => expect(taskApi.getTask).toHaveBeenCalledWith('old-task'));
    await view.rerender(<NativeTaskDetailScreen taskId="new-task" />);
    await waitFor(() => expect(view.getByText('Current task')).toBeTruthy());
    await act(async () => { resolveOld({ ...detailTask, id: 'old-task', title: 'Stale task' }); });
    expect(view.queryByText('Stale task')).toBeNull();
    expect(view.getByText('Current task')).toBeTruthy();
    const cached = await readNativeEntitySnapshot<{ task: { id: string } }>('task-details', 1, 'new-task');
    expect(cached?.data.task.id).toBe('new-task');
  });

  it('ignores a network response after switching to the offline copy', async () => {
    await writeNativeEntitySnapshot('task-details', 1, 'offline-race', {
      task: { ...detailTask, id: 'offline-race', title: 'Saved task' }, comments: [], statusLog: [],
    });
    let finish!: (value: unknown) => void;
    (taskApi.getTask as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = await render(<NativeTaskDetailScreen taskId="offline-race" />);
    await waitFor(() => expect(taskApi.getTask).toHaveBeenCalled());
    mockAuth.offlineMode = true;
    await view.rerender(<NativeTaskDetailScreen taskId="offline-race" />);
    await waitFor(() => expect(view.getByText('Saved task')).toBeTruthy());
    await act(async () => { finish({ ...detailTask, id: 'offline-race', title: 'Late network task' }); });
    expect(view.queryByText('Late network task')).toBeNull();
    expect(view.getByText('Saved task')).toBeTruthy();
  });

  it('keeps the newest refresh when requests for the same task finish out of order', async () => {
    const listener = jest.spyOn(hubRealtimeSocket, 'onTaskChanged');
    let finishOld!: (value: unknown) => void;
    (taskApi.getTask as jest.Mock)
      .mockResolvedValueOnce(detailTask)
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce({ ...detailTask, title: 'Newest refresh' });
    try {
      const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
      await waitFor(() => expect(view.getByText(detailTask.title)).toBeTruthy());
      const refresh = listener.mock.calls[0][0];
      await act(async () => { refresh({ payload: { task_id: 'task-1' } }); });
      await waitFor(() => expect(taskApi.getTask).toHaveBeenCalledTimes(2));
      await act(async () => { refresh({ payload: { task_id: 'task-1' } }); });
      await waitFor(() => expect(view.getByText('Newest refresh')).toBeTruthy());
      await act(async () => { finishOld({ ...detailTask, title: 'Older refresh' }); });
      expect(view.queryByText('Older refresh')).toBeNull();
      expect(view.getByText('Newest refresh')).toBeTruthy();
    } finally {
      listener.mockRestore();
    }
  });

  it('loads the native task list and opens a task detail', async () => {
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => {
      expect(view.getByText('Настроить сервер')).toBeTruthy();
    });
    expect(view.getAllByText('Новые комментарии').length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-row-task-1'));
    });
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(shell)/tasks/[taskId]',
      params: { taskId: 'task-1' },
    });
  });

  it('keeps completed tasks collapsed below the active task feed', async () => {
    (taskApi.getTasksPage as jest.Mock).mockResolvedValueOnce({
      items: [
        { ...listTask, id: 'task-done', title: 'Закрытая задача', status: 'done' },
        { ...listTask, id: 'task-active', title: 'Задача в работе', status: 'in_progress' },
      ],
      total: 2,
      limit: 40,
      offset: 0,
    });
    const view = await render(<NativeTasksInboxScreen />);

    await waitFor(() => expect(view.getByText('Задача в работе')).toBeTruthy());
    expect(view.getByTestId('native-task-active-section')).toBeTruthy();
    expect(view.queryByText('Закрытая задача')).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-completed-toggle'));
    });
    expect(view.getByText('Закрытая задача')).toBeTruthy();
  });

  it('does not expose a web fallback on the native task list', async () => {
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByTestId('native-task-list-more')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('native-task-list-more')); });
    expect(view.queryByTestId('native-tasks-open-web')).toBeNull();
    expect(view.getByTestId('native-task-analytics')).toBeTruthy();
  });

  it('opens the native task analytics from the list header', async () => {
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByTestId('native-task-list-more')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('native-task-list-more')); });
    await waitFor(() => expect(view.getByTestId('native-task-analytics')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('native-task-analytics')); });
    expect(router.push).toHaveBeenCalledWith('/(shell)/tasks/analytics');
  });

  it('applies the native role, due, file, department and controller filters', async () => {
    setAuth(['tasks.read', 'tasks.manage_all', 'tasks.review']);
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByTestId('native-task-list-filters-toggle')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-sort-due'));
      fireEvent.press(view.getByTestId('native-task-list-filters-toggle'));
    });
    await waitFor(() => expect(view.getByTestId('native-task-department-selector')).toBeTruthy());
    expect(view.queryByTestId('native-task-view-assignee')).toBeNull();
    expect(view.queryByTestId('native-task-view-creator')).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-view-department'));
      fireEvent.press(view.getByTestId('native-task-due-overdue'));
      fireEvent.press(view.getByTestId('native-task-files-only'));
      fireEvent.press(view.getByTestId('native-task-unread-only'));
      fireEvent.press(view.getByTestId('native-task-department-selector'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-department-department-1'));
      fireEvent.press(view.getByTestId('native-task-controller-selector'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-controller-8'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-apply-filters'));
    });
    await waitFor(() => expect(taskApi.getTasksPage).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: 'department',
      role_scope: 'both',
      due_state: 'overdue',
      has_attachments: true,
      unread_comments_only: true,
      department_id: 'department-1',
      controller_user_id: 8,
      sort_by: 'due_at',
      sort_dir: 'asc',
    })));
  });

  it('opens a previously saved task without calling the API while offline', async () => {
    await writeNativeEntitySnapshot('task-details', 1, 'task-1', {
      task: detailTask,
      comments: [{ id: 'comment-offline', body: 'Сохранённый комментарий', full_name: 'Мария Сидорова' }],
      statusLog: [],
    });
    mockAuth = { ...mockAuth, offlineMode: true };

    const view = await render(<NativeTaskDetailScreen taskId="task-1" />);

    await waitFor(() => expect(view.getByText('Установить обновления и проверить сервисы.')).toBeTruthy());
    await fireEvent.press(view.getByTestId('native-task-tab-discussion'));
    expect(view.getByText('Сохранённый комментарий')).toBeTruthy();
    expect(view.getByText(/Копия от/)).toBeTruthy();
    expect(taskApi.getTask).not.toHaveBeenCalled();
  });

  it('executes only a server-provided task action after confirmation', async () => {
    const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
    await waitFor(() => {
      expect(view.getByText('Установить обновления и проверить сервисы.')).toBeTruthy();
    });
    expect(view.getByTestId('native-task-primary-start')).toBeTruthy();
    expect(view.queryByTestId('native-task-action-approve')).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-primary-start'));
    });
    await waitFor(() => expect(view.getByTestId('native-task-action-confirm')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-action-confirm'));
    });
    await waitFor(() => {
      expect(taskApi.startTask).toHaveBeenCalledWith('task-1');
      expect(view.getByText('Задача взята в работу.')).toBeTruthy();
    });
  });

  it('opens secondary task actions separately and keeps confirmation cancellable', async () => {
    (taskApi.getTask as jest.Mock).mockResolvedValueOnce({ ...detailTask, capabilities: { can_review: true } });
    const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
    await waitFor(() => expect(view.getByTestId('native-task-primary-approve')).toBeTruthy());
    expect(view.queryByTestId('native-task-action-reject')).toBeNull();
    await fireEvent.press(view.getByTestId('native-task-actions-more'));
    expect(view.queryByTestId('native-task-action-approve')).toBeNull();
    await fireEvent.press(view.getByTestId('native-task-action-reject'));
    expect(view.getByTestId('native-task-action-confirm')).toBeTruthy();
    expect(taskApi.reviewTask).not.toHaveBeenCalled();
    await fireEvent.press(view.getByTestId('account-subpage-back'));
    expect(view.queryByTestId('native-task-action-confirm')).toBeNull();
    expect(taskApi.reviewTask).not.toHaveBeenCalled();
  });

  it('mounts a bounded part of a large legacy discussion', async () => {
    (taskApi.getTaskComments as jest.Mock).mockResolvedValue(Array.from({ length: 1000 }, (_, i) => ({ id: `large-${i}`, body: `Synthetic comment ${i}`, full_name: 'Test author' })));
    const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
    await waitFor(() => expect(view.getByTestId('native-task-tab-discussion')).toBeTruthy());
    await fireEvent.press(view.getByTestId('native-task-tab-discussion'));
    await waitFor(() => expect(view.getByText('Synthetic comment 0')).toBeTruthy());
    expect(view.getAllByText(/^Synthetic comment /).length).toBeLessThan(100);
    expect(view.queryByText('Synthetic comment 999')).toBeNull();
  });

  it('adds a comment from the native detail composer', async () => {
    const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
    await waitFor(() => expect(view.getByTestId('native-task-tab-discussion')).toBeTruthy());
    await fireEvent.press(view.getByTestId('native-task-tab-discussion'));
    await waitFor(() => expect(view.getByText('Проверьте резервную копию')).toBeTruthy());
    expect(view.getByTestId('native-task-detail-keyboard-host')).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(view.getByTestId('native-task-comment-input'), 'Готово');
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-comment-send'));
    });
    await waitFor(() => {
      expect(taskApi.addTaskComment).toHaveBeenCalledWith('task-1', 'Готово');
      expect(view.getByText('Готово')).toBeTruthy();
    });
  });

  it('shows status history and copies a canonical task link', async () => {
    const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
    await waitFor(() => expect(view.getByRole('button', { name: /^История статусов/ })).toBeTruthy());
    await fireEvent.press(view.getByRole('button', { name: /^История статусов/ }));
    await waitFor(() => expect(view.getByText('Новая → В работе')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('native-task-copy-link')); });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('https://hubit.zsgp.ru/tasks?task=task-1');
  });

  it('deletes only a creator-owned task after explicit confirmation', async () => {
    (taskApi.getTask as jest.Mock).mockResolvedValueOnce({
      ...detailTask,
      created_by_user_id: 1,
    });
    const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
    await waitFor(() => expect(view.getByTestId('native-task-delete-open')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('native-task-delete-open')); });
    await waitFor(() => expect(view.getByTestId('native-task-delete-confirm')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('native-task-delete-confirm')); });
    await waitFor(() => expect(taskApi.deleteTask).toHaveBeenCalledWith('task-1'));
    expect(router.replace).toHaveBeenCalledWith('/(shell)/tasks');
  });

  it('edits task fields through the server capability', async () => {
    // The department directory is gated on settings.read — the same contract
    // the create screen already uses for its department picker.
    setAuth(['tasks.read', 'tasks.create', 'settings.read']);
    (taskApi.getTask as jest.Mock).mockResolvedValueOnce({
      ...detailTask,
      protocol_date: '2026-08-24',
      assignee_user_id: 7,
      assignee_user_ids: [7],
      project_id: 'general-tasks',
      capabilities: { ...detailTask.capabilities, can_edit: true },
    });
    const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
    await waitFor(() => expect(view.getByTestId('native-task-edit-open')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-edit-open'));
    });
    await waitFor(() => expect(view.getByTestId('native-task-edit-title')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByTestId('native-task-edit-title'), 'Обновлённая задача');
      fireEvent.changeText(view.getByTestId('native-task-edit-due-date'), '2026-09-02');
      fireEvent.changeText(view.getByTestId('native-task-edit-email-reminder'), '12');
      fireEvent.press(view.getByTestId('native-task-edit-priority-urgent'));
    });
    await waitFor(() => expect(view.getByTestId('native-task-edit-assignee-7')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-edit-assignee-8'));
      fireEvent.press(view.getByTestId('native-task-edit-controller-8'));
      fireEvent.press(view.getByTestId('native-task-edit-object-object-1'));
      fireEvent.press(view.getByTestId('native-task-edit-department-department-1'));
    });
    await waitFor(() => expect(view.getByTestId('native-task-edit-visibility-department').props.accessibilityState.disabled).toBe(false));
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-edit-visibility-department'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-edit-save'));
    });
    // Only changed fields go out: an untouched list (observers, project)
    // must not roll back a colleague's parallel edit (MB3-04).
    await waitFor(() => expect(taskApi.updateTask).toHaveBeenCalledWith('task-1', {
      title: 'Обновлённая задача',
      due_at: '2026-09-02T18:00:00',
      priority: 'urgent',
      assignee_user_ids: [7, 8],
      controller_user_id: 8,
      object_id: 'object-1',
      department_id: 'department-1',
      visibility_scope: 'department',
      email_deadline_remind_hours: 12,
    }));
    expect(view.getByText('Задача обновлена.')).toBeTruthy();
  });

  it('updates the checklist through the participant capability', async () => {
    (taskApi.getTask as jest.Mock).mockResolvedValueOnce({
      ...detailTask,
      checklist_items: [{ id: 'step-1', text: 'Проверить сеть', done: false }],
      capabilities: { ...detailTask.capabilities, can_update_checklist: true },
    });
    const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
    await waitFor(() => expect(view.getByTestId('native-task-checklist-toggle-step-1')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-checklist-toggle-step-1'));
    });
    await waitFor(() => expect(taskApi.updateTask).toHaveBeenCalledWith('task-1', {
      checklist_items: [{ id: 'step-1', text: 'Проверить сеть', done: true }],
    }));
  });

  it('uploads a task attachment with the native picker', async () => {
    (taskApi.getTask as jest.Mock).mockResolvedValue({
      ...detailTask,
      capabilities: { ...detailTask.capabilities, can_upload_files: true },
    });
    const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
    await waitFor(() => expect(view.getByTestId('native-task-tab-files')).toBeTruthy());
    await fireEvent.press(view.getByTestId('native-task-tab-files'));
    await waitFor(() => expect(view.getByTestId('native-task-attachment-upload')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-attachment-upload'));
    });
    await waitFor(() => expect(taskApi.uploadTaskAttachment).toHaveBeenCalledWith('task-1', expect.objectContaining({ name: 'report.pdf' })));
    expect(view.getByText('Файл прикреплён к задаче.')).toBeTruthy();
  });

  it('submits a task with an optional native report file', async () => {
    const submitReady = {
      ...detailTask,
      status: 'in_progress',
      capabilities: { can_submit: true, can_open_discussion: false },
    };
    (taskApi.getTask as jest.Mock).mockResolvedValueOnce(submitReady);
    (taskApi.submitTask as jest.Mock).mockResolvedValue({ ...submitReady, status: 'review', capabilities: {} });
    const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
    await waitFor(() => expect(view.getByTestId('native-task-primary-submit')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('native-task-primary-submit')); });
    await act(async () => { fireEvent.press(view.getByTestId('native-task-submit-file')); });
    await waitFor(() => expect(view.getByText(/report\.pdf/)).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('native-task-action-confirm')); });
    await waitFor(() => expect(taskApi.submitTask).toHaveBeenCalledWith('task-1', '', expect.objectContaining({ name: 'report.pdf' })));
  });

  it('creates or opens the task discussion and moves into the native Chat thread', async () => {
    (taskApi.getTask as jest.Mock).mockResolvedValueOnce({
      ...detailTask,
      capabilities: { can_start: true, can_open_discussion: true },
    });
    const view = await render(<NativeTaskDetailScreen taskId="task-1" />);

    await waitFor(() => expect(view.getByTestId('native-task-tab-discussion')).toBeTruthy());
    await fireEvent.press(view.getByTestId('native-task-tab-discussion'));
    await waitFor(() => expect(view.getByTestId('native-task-open-discussion')).toBeTruthy());
    expect(taskApi.getTaskComments).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-open-discussion'));
    });

    await waitFor(() => expect(taskApi.openTaskDiscussion).toHaveBeenCalledWith('task-1'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(shell)/chat/[conversationId]',
      params: { conversationId: 'task-conversation-1' },
    });
  });

  it('does not treat the default project as an edit but protects an unfinished checklist item', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const view = await render(<NativeTaskCreateScreen />);
    await view.findByTestId('native-task-assignee-7');
    await fireEvent.press(view.getByLabelText('Назад'));
    expect(alert).not.toHaveBeenCalled();
    jest.mocked(router.back).mockClear();
    await fireEvent.press(view.getByText('Чек-лист (0)'));
    await fireEvent.changeText(view.getByTestId('native-task-create-checklist-input'), 'Проверить кабель');
    await fireEvent.press(view.getByLabelText('Назад'));
    expect(router.back).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Сохранить черновик и выйти?', expect.any(String), expect.any(Array), expect.any(Object));
    alert.mockRestore();
  });

  it('protects unfinished task input and lets the user stay or explicitly discard it', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const view = await render(<NativeTaskCreateScreen />);
    await view.findByTestId('native-task-assignee-7');
    await fireEvent.changeText(view.getByTestId('native-task-create-title'), 'Несохранённая задача');
    await fireEvent.press(view.getByLabelText('Назад'));
    expect(router.back).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Сохранить черновик и выйти?', expect.any(String), expect.any(Array), expect.any(Object));
    await act(async () => alert.mock.calls[0][2]?.[0].onPress?.());
    expect(view.getByTestId('native-task-create-title').props.value).toBe('Несохранённая задача');
    await fireEvent.press(view.getByLabelText('Назад'));
    await act(async () => alert.mock.calls[1][2]?.[1].onPress?.());
    expect(router.back).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('creates a task with the real project and assignee contract', async () => {
    const view = await render(<NativeTaskCreateScreen />);
    await waitFor(() => expect(view.getByTestId('native-task-assignee-7')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByTestId('native-task-create-title'), 'Новая нативная задача');
      fireEvent.press(view.getByTestId('native-task-assignee-7'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-create-submit'));
    });
    await waitFor(() => {
      expect(taskApi.createTask).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Новая нативная задача',
        assignee_user_ids: [7],
        project_id: 'general-tasks',
        priority: 'normal',
      }));
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/(shell)/tasks/[taskId]',
        params: { taskId: 'created-task-1' },
      });
    });
  });

  it('creates a task with controller, observer, object, visibility, checklist and file', async () => {
    setAuth(['tasks.read', 'tasks.create', 'settings.read']);
    const view = await render(<NativeTaskCreateScreen />);
    for (const title of ['Контролёр', 'Наблюдатели', 'Объект', 'Отдел', 'Чек-лист (0)', 'Файлы (0)']) {
      await fireEvent.press(view.getByRole('button', { name: title }));
    }
    await waitFor(() => expect(view.getByTestId('native-task-controller-8')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByTestId('native-task-create-title'), 'Расширенная задача');
      fireEvent.press(view.getByTestId('native-task-assignee-7'));
      fireEvent.press(view.getByTestId('native-task-observer-8'));
      fireEvent.changeText(view.getByTestId('native-task-create-checklist-input'), 'Проверить доступ');
    });
    await act(async () => {
      fireEvent.press(view.getByText('Добавить пункт'));
      fireEvent.press(view.getByText('Серверная'));
      fireEvent.press(view.getByTestId('native-task-department-department-1'));
      fireEvent.press(view.getByTestId('native-task-controller-8'));
      fireEvent.press(view.getByText('Добавить файл'));
    });
    await waitFor(() => expect(view.getByText('report.pdf')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('native-task-create-submit')); });
    await waitFor(() => expect(taskApi.createTask).toHaveBeenCalledWith(expect.objectContaining({
      controller_user_id: 8,
      observer_user_ids: [8],
      object_id: 'object-1',
      department_id: 'department-1',
      visibility_scope: 'department',
      checklist_items: [expect.objectContaining({ text: 'Проверить доступ', done: false })],
    })));
    expect(taskApi.uploadTaskAttachment).toHaveBeenCalledWith('created-task-1', expect.objectContaining({ name: 'report.pdf' }));
  });

  it('sends a custom email deadline reminder and department scope through the confirmed create contract', async () => {
    setAuth(['tasks.read', 'tasks.create', 'settings.read']);
    const view = await render(<NativeTaskCreateScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Отдел' }));
    await waitFor(() => expect(view.getByTestId('native-task-department-department-1')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByTestId('native-task-create-title'), 'Задача с напоминанием');
      fireEvent.changeText(view.getByTestId('native-task-create-due'), '2026-09-10');
      fireEvent.press(view.getByTestId('native-task-assignee-7'));
      fireEvent.press(view.getByTestId('native-task-department-department-1'));
    });
    await fireEvent.press(view.getByRole('button', { name: 'Видимость' }));
    await waitFor(() => expect(view.getByTestId('native-task-email-reminder-6')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-email-reminder-6'));
      fireEvent.press(view.getByTestId('native-task-visibility-department_managers'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-create-submit'));
    });
    await waitFor(() => expect(taskApi.createTask).toHaveBeenCalledWith(expect.objectContaining({
      due_at: '2026-09-10T18:00:00',
      email_deadline_remind_hours: 6,
      department_id: 'department-1',
      visibility_scope: 'department_managers',
    })));
  });

  it('creates and selects a project with tasks.create permission', async () => {
    const view = await render(<NativeTaskCreateScreen />);
    await waitFor(() => expect(view.getByTestId('native-task-new-project-name')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByTestId('native-task-new-project-name'), 'Проект Север');
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-create-project'));
    });
    await waitFor(() => expect(taskApi.createTaskProject).toHaveBeenCalledWith({
      name: 'Проект Север', code: '', description: '', is_active: true,
    }));
    expect(view.getByText('Проект Север')).toBeTruthy();
  });

  it('hides object creation without tasks.write permission', async () => {
    const createOnly = await render(<NativeTaskCreateScreen />);
    await fireEvent.press(createOnly.getByRole('button', { name: 'Объект' }));
    await waitFor(() => expect(createOnly.getByText('Серверная')).toBeTruthy());
    expect(createOnly.queryByTestId('native-task-new-object-name')).toBeNull();
  });

  it('creates and selects an object with tasks.write permission', async () => {
    setAuth(['tasks.read', 'tasks.write']);
    const writer = await render(<NativeTaskCreateScreen />);
    await fireEvent.press(writer.getByRole('button', { name: 'Объект' }));
    await waitFor(() => expect(writer.getByTestId('native-task-new-object-name')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(writer.getByTestId('native-task-new-object-name'), 'Новая серверная');
    });
    await act(async () => {
      fireEvent.press(writer.getByTestId('native-task-create-object'));
    });
    await waitFor(() => expect(taskApi.createTaskObject).toHaveBeenCalledWith({
      project_id: 'general-tasks', name: 'Новая серверная', code: '', description: '', is_active: true,
    }));
    expect(writer.getByTestId('native-task-object-object-2')).toBeTruthy();
  });

  describe('subtasks', () => {
    const parentTask = {
      ...detailTask,
      subtasks_total: 3,
      subtasks_done: 1,
      capabilities: { ...detailTask.capabilities, can_create_subtask: true },
      subtasks: [
        { id: 'sub-1', title: 'Собрать сборку', status: 'done', assignees: [{ user_id: 7, full_name: 'Иван Петров' }] },
        { id: 'sub-2', title: 'Проверить на стенде', status: 'new', assignees: [{ user_id: 8, full_name: 'Анна Смирнова' }] },
      ],
    };

    it('lists subtasks, opens one and starts creating a new one for the parent', async () => {
      (taskApi.getTask as jest.Mock).mockResolvedValue(parentTask);
      const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
      await waitFor(() => expect(view.getByText('Подзадачи · 1/3')).toBeTruthy());
      expect(view.getByText('Собрать сборку')).toBeTruthy();
      expect(view.getByTestId('native-task-subtasks-hidden')).toHaveTextContent('и ещё 1 недоступных вам');

      await act(async () => { fireEvent.press(view.getByTestId('native-task-subtask-sub-2')); });
      expect(router.push).toHaveBeenCalledWith({ pathname: '/(shell)/tasks/[taskId]', params: { taskId: 'sub-2' } });

      await act(async () => { fireEvent.press(view.getByTestId('native-task-subtask-create')); });
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/(shell)/tasks/create',
        params: { parentTaskId: 'task-1', parentTitle: 'Настроить сервер' },
      });
    });

    it('hides creation without the server capability and links a subtask to its parent', async () => {
      (taskApi.getTask as jest.Mock).mockResolvedValue({
        ...detailTask,
        parent_task_id: 'parent-1',
        parent: { id: 'parent-1', can_view: true, title: 'Большая задача' },
      });
      const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
      await waitFor(() => expect(view.getByTestId('native-task-parent-link')).toBeTruthy());
      expect(view.queryByTestId('native-task-subtask-create')).toBeNull();

      await act(async () => { fireEvent.press(view.getByTestId('native-task-parent-link')); });
      expect(router.push).toHaveBeenCalledWith({ pathname: '/(shell)/tasks/[taskId]', params: { taskId: 'parent-1' } });
    });

    it('does not make an inaccessible parent clickable', async () => {
      (taskApi.getTask as jest.Mock).mockResolvedValue({
        ...detailTask,
        parent_task_id: 'parent-1',
        parent: { id: 'parent-1', can_view: false },
      });
      const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
      await waitFor(() => expect(view.getByText(/Родительская задача недоступна/)).toBeTruthy());

      await act(async () => { fireEvent.press(view.getByTestId('native-task-parent-link')); });
      expect(router.push).not.toHaveBeenCalled();
    });

    it('disables adding a subtask in the offline copy', async () => {
      await writeNativeEntitySnapshot('task-details', 1, 'task-1', { task: parentTask, comments: [], statusLog: [] });
      mockAuth = { ...mockAuth, offlineMode: true };
      const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
      await waitFor(() => expect(view.getByTestId('native-task-subtask-create')).toBeTruthy());

      await act(async () => { fireEvent.press(view.getByTestId('native-task-subtask-create')); });
      expect(router.push).not.toHaveBeenCalled();
      expect(view.getByTestId('native-task-subtask-create').props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('warns about open subtasks when a parent goes to review, without blocking it', async () => {
      (taskApi.getTask as jest.Mock).mockResolvedValue({
        ...parentTask,
        status: 'in_progress',
        capabilities: { can_submit: true, can_open_discussion: false },
      });
      const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
      await waitFor(() => expect(view.getByText('Подзадачи · 1/3')).toBeTruthy());
      await act(async () => { fireEvent.press(view.getByTestId('native-task-primary-submit')); });

      await waitFor(() => expect(view.getByTestId('native-task-open-subtasks-warning')).toHaveTextContent(/невыполненные подзадачи: 2/));
    });

    it('shows subtask progress and the subtask mark in the task list', async () => {
      (taskApi.getTasksPage as jest.Mock).mockResolvedValue({
        items: [
          { ...listTask, subtasks_total: 3, subtasks_done: 1 },
          { ...listTask, id: 'task-2', title: 'Часть работы', has_unread_comments: false, parent_task_id: 'task-1' },
        ],
        total: 2,
        limit: 40,
        offset: 0,
      });
      const view = await render(<NativeTasksInboxScreen />);

      await waitFor(() => expect(view.getByTestId('native-task-row-subtasks-task-1')).toHaveTextContent('Подзадачи 1/3'));
      expect(view.getByText('Подзадача')).toBeTruthy();
    });

    it('creates a subtask for the parent with only tasks.read and no project selection', async () => {
      setAuth(['tasks.read']);
      (taskApi.createSubtask as jest.Mock).mockResolvedValue({ id: 'sub-9', parent_task_id: 'task-1' });
      const view = await render(<NativeTaskCreateScreen parentTaskId="task-1" parentTitle="Настроить сервер" />);
      await waitFor(() => expect(view.getByTestId('native-task-assignee-7')).toBeTruthy());
      expect(taskApi.getTaskProjects).not.toHaveBeenCalled();
      expect(view.queryByText('Проект *')).toBeNull();

      await act(async () => {
        fireEvent.changeText(view.getByTestId('native-task-create-title'), 'Подготовить стенд');
        fireEvent.press(view.getByTestId('native-task-assignee-7'));
      });
      await act(async () => { fireEvent.press(view.getByTestId('native-task-create-submit')); });

      await waitFor(() => expect(taskApi.createSubtask).toHaveBeenCalledWith('task-1', expect.objectContaining({
        title: 'Подготовить стенд',
        assignee_user_ids: [7],
      })));
      const payload = (taskApi.createSubtask as jest.Mock).mock.calls[0][1];
      expect(payload).not.toHaveProperty('project_id');
      expect(taskApi.createTask).not.toHaveBeenCalled();
      // Родитель уже открыт под формой: возвращаемся к нему, а не открываем второй экземпляр.
      expect(router.back).toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
    });
  });

  describe('assignment mode', () => {
    const createWithAssignees = async (ids: number[]) => {
      const view = await render(<NativeTaskCreateScreen />);
      await waitFor(() => expect(view.getByTestId('native-task-assignee-7')).toBeTruthy());
      // Черновик восстанавливается асинхронно и перезаписывает поля: выбираем исполнителей после него.
      await waitFor(() => expect(view.getByTestId('native-task-create-submit')).toBeEnabled());
      await act(async () => {
        fireEvent.changeText(view.getByTestId('native-task-create-title'), 'Общая настройка');
        for (const id of ids) fireEvent.press(view.getByTestId(`native-task-assignee-${id}`));
      });
      return view;
    };
    const submit = (view: Awaited<ReturnType<typeof render>>) => act(async () => { fireEvent.press(view.getByTestId('native-task-create-submit')); });

    it('offers one shared task or a task per assignee only for several assignees', async () => {
      const view = await createWithAssignees([7]);
      expect(view.queryByTestId('native-task-assignment-mode-separate')).toBeNull();
      await submit(view);
      await waitFor(() => expect(taskApi.createTask).toHaveBeenCalledTimes(1));
      expect((taskApi.createTask as jest.Mock).mock.calls[0][0]).not.toHaveProperty('assignment_mode');
    });

    it('sends a shared task by default', async () => {
      const view = await createWithAssignees([7, 8]);
      expect(view.getByTestId('native-task-assignment-mode-shared')).toBeTruthy();
      await submit(view);
      await waitFor(() => expect(taskApi.createTask).toHaveBeenLastCalledWith(expect.objectContaining({
        assignee_user_ids: [7, 8], assignment_mode: 'shared',
      })));
    });

    it('sends a task per assignee when the author picks that mode', async () => {
      const view = await createWithAssignees([7, 8]);
      await fireEvent.press(view.getByTestId('native-task-assignment-mode-separate'));
      await submit(view);
      await waitFor(() => expect(taskApi.createTask).toHaveBeenLastCalledWith(expect.objectContaining({
        assignee_user_ids: [7, 8], assignment_mode: 'separate',
      })));
    });

    it('keeps only the assignees without a task after a partial result and does not duplicate the rest', async () => {
      (taskApi.createTask as jest.Mock).mockResolvedValueOnce(
        Object.assign([{ id: 'created-1' }], { failed: [{ assignee_user_id: 8, detail: 'нет доступа' }] }),
      );
      const view = await createWithAssignees([7, 8]);
      await fireEvent.press(view.getByTestId('native-task-assignment-mode-separate'));
      await submit(view);

      await waitFor(() => expect(view.getByText(/Создано 1 из 2 задач\. Не удалось создать для: Анна Смирнова/)).toBeTruthy());
      expect(router.replace).not.toHaveBeenCalled();
      expect(view.getByTestId('native-task-assignee-8').props.accessibilityState.checked).toBe(true);
      expect(view.getByTestId('native-task-assignee-7').props.accessibilityState.checked).toBe(false);
      expect(view.queryByTestId('native-task-assignment-mode-separate')).toBeNull();

      await submit(view);
      await waitFor(() => expect(taskApi.createTask).toHaveBeenCalledTimes(2));
      const retry = (taskApi.createTask as jest.Mock).mock.calls[1][0];
      expect(retry.assignee_user_ids).toEqual([8]);
      expect(retry).not.toHaveProperty('assignment_mode');
    });
  });

  describe('task attachment deletion', () => {
    const files = [
      { id: 'own', file_name: 'my.pdf', scope: 'task', uploaded_by_user_id: 1 },
      { id: 'foreign', file_name: 'foreign.pdf', scope: 'task', uploaded_by_user_id: 9 },
      { id: 'report', file_name: 'report.pdf', scope: 'report', uploaded_by_user_id: 1 },
    ];
    const openFiles = async (task: Record<string, unknown>) => {
      (taskApi.getTask as jest.Mock).mockResolvedValue({ ...detailTask, created_by_user_id: 5, attachments: files, ...task });
      const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
      await waitFor(() => expect(view.getByTestId('native-task-tab-files')).toBeTruthy());
      await fireEvent.press(view.getByTestId('native-task-tab-files'));
      await waitFor(() => expect(view.getByTestId('native-task-attachment-own')).toBeTruthy());
      return view;
    };

    it('lets the user delete only their own task files and confirms before removing', async () => {
      const alert = jest.spyOn(Alert, 'alert');
      (taskApi.deleteTaskAttachment as jest.Mock).mockResolvedValue(undefined);
      const view = await openFiles({});
      expect(view.getByTestId('native-task-attachment-delete-own')).toBeTruthy();
      expect(view.queryByTestId('native-task-attachment-delete-foreign')).toBeNull();
      expect(view.queryByTestId('native-task-attachment-delete-report')).toBeNull();

      (taskApi.getTask as jest.Mock).mockResolvedValue({ ...detailTask, created_by_user_id: 5, attachments: files.slice(1) });
      await fireEvent.press(view.getByTestId('native-task-attachment-delete-own'));
      expect(taskApi.deleteTaskAttachment).not.toHaveBeenCalled();
      await act(async () => alert.mock.calls[0][2]?.[1].onPress?.());

      await waitFor(() => expect(taskApi.deleteTaskAttachment).toHaveBeenCalledWith('task-1', 'own'));
      await waitFor(() => expect(view.queryByTestId('native-task-attachment-own')).toBeNull());
      expect(view.getByText('Файл удалён из задачи.')).toBeTruthy();
      alert.mockRestore();
    });

    it('gives the task creator the delete button for any task file', async () => {
      const view = await openFiles({ created_by_user_id: 1 });
      expect(view.getByTestId('native-task-attachment-delete-foreign')).toBeTruthy();
      expect(view.queryByTestId('native-task-attachment-delete-report')).toBeNull();
    });

    it('hides deletion once the task is done', async () => {
      const view = await openFiles({ created_by_user_id: 1, status: 'done' });
      expect(view.queryByTestId('native-task-attachment-delete-own')).toBeNull();
    });
  });

  it('renders the task board for a task_mode=board deep link and navigates from rows', async () => {
    mockedUseLocalSearchParams.mockReturnValue({ taskMode: 'board' });
    (taskApi.getTasksPage as jest.Mock).mockResolvedValue({
      items: [
        { ...listTask, id: 'task-new', title: 'Новая задача', status: 'new' },
        { ...listTask, id: 'task-progress', title: 'Задача в работе', status: 'in_progress' },
        { ...listTask, id: 'task-done', title: 'Готовая задача', status: 'done' },
      ],
      total: 3,
      limit: 40,
      offset: 0,
    });
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByTestId('native-tasks-board')).toBeTruthy());
    expect(taskApi.getTasksPage).toHaveBeenCalledWith(expect.objectContaining({
      sort_by: 'status',
      sort_dir: 'asc',
      scope: 'my',
      role_scope: 'assignee',
    }));
    expect(view.getByText('Новое')).toBeTruthy();
    expect(view.getAllByText('В работе').length).toBe(2);
    expect(view.getByText('На проверке')).toBeTruthy();
    expect(view.getByText('Готово')).toBeTruthy();
    expect(view.getAllByText('Загружено 1').length).toBe(3);
    expect(view.getByText('Загружено 0')).toBeTruthy();
    expect(view.getByText('Новая задача')).toBeTruthy();
    expect(view.getByText('Готовая задача')).toBeTruthy();
    expect(view.getByTestId('native-tasks-board').props.onEndReached).toBeUndefined();
    await act(async () => { fireEvent.press(view.getByTestId('native-task-row-task-progress')); });
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(shell)/tasks/[taskId]',
      params: { taskId: 'task-progress' },
    });
  });

  it('switches to the board tab and refetches sorted by status without the due-sort toggle', async () => {
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByText('Настроить сервер')).toBeTruthy());
    expect(view.getByTestId('native-task-sort-due')).toBeTruthy();
    (taskApi.getTasksPage as jest.Mock).mockClear();
    await act(async () => { fireEvent.press(view.getByTestId('native-task-page-mode-board')); });
    await waitFor(() => expect(view.getByTestId('native-tasks-board')).toBeTruthy());
    expect(taskApi.getTasksPage).toHaveBeenCalledWith(expect.objectContaining({ sort_by: 'status', sort_dir: 'asc' }));
    expect(view.queryByTestId('native-task-sort-due')).toBeNull();
    await act(async () => { fireEvent.press(view.getByTestId('native-task-page-mode-list')); });
    await waitFor(() => expect(view.getByTestId('native-tasks-list')).toBeTruthy());
  });

  it('warns about a partial board page and loads the next page only on demand', async () => {
    mockedUseLocalSearchParams.mockReturnValue({ taskMode: 'board' });
    (taskApi.getTasksPage as jest.Mock)
      .mockResolvedValueOnce({
        items: [{ ...listTask, id: 'task-a', title: 'Первая задача' }],
        total: 60,
        limit: 40,
        offset: 0,
      })
      .mockResolvedValueOnce({
        items: [{ ...listTask, id: 'task-b', title: 'Вторая задача', status: 'in_progress' }],
        total: 60,
        limit: 40,
        offset: 1,
      });
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByText('Загружено 1 из 60 задач. Доска/календарь может быть неполным.')).toBeTruthy());
    expect(taskApi.getTasksPage).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.press(view.getByTestId('native-tasks-load-more')); });
    await waitFor(() => expect(view.getByText('Вторая задача')).toBeTruthy());
    expect(taskApi.getTasksPage).toHaveBeenCalledTimes(2);
    expect(taskApi.getTasksPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1, limit: 40 }));
    expect(view.getByText('Загружено 2 из 60 задач. Доска/календарь может быть неполным.')).toBeTruthy();
  });

  it('renders the calendar for task_mode=calendar and selects a day agenda', async () => {
    mockedUseLocalSearchParams.mockReturnValue({ taskMode: 'calendar' });
    const now = new Date();
    const localIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T12:00:00`;
    const targetDay = now.getDate() === 15 ? 16 : 15;
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), targetDay, 12);
    const otherDay = new Date(now.getFullYear(), now.getMonth(), targetDay === 16 ? 15 : 16, 12);
    (taskApi.getTasksPage as jest.Mock).mockResolvedValue({
      items: [
        { ...listTask, id: 'task-day', title: 'Задача выбранного дня', status: 'in_progress', due_at: localIso(thisMonth) },
        { ...listTask, id: 'task-other', title: 'Задача другого дня', status: 'new', due_at: localIso(otherDay) },
        { ...listTask, id: 'task-nodue', title: 'Задача без срока', status: 'new', due_at: '' },
      ],
      total: 3,
      limit: 40,
      offset: 0,
    });
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByTestId('native-tasks-calendar')).toBeTruthy());
    expect(taskApi.getTasksPage).toHaveBeenCalledWith(expect.objectContaining({ sort_by: 'due_at', sort_dir: 'asc' }));
    await act(async () => {
      fireEvent.press(view.getByTestId(`native-task-calendar-day-${nativeTaskDateKey(thisMonth)}`));
    });
    await waitFor(() => expect(view.getByText('Задача выбранного дня')).toBeTruthy());
    expect(view.queryByText('Задача другого дня')).toBeNull();
    expect(view.queryByText('Задача без срока')).toBeNull();
    await act(async () => { fireEvent.press(view.getByTestId('native-task-calendar-no-due')); });
    await waitFor(() => expect(view.getByText('Задача без срока')).toBeTruthy());
    expect(view.queryByText('Задача выбранного дня')).toBeNull();
    expect(view.getByTestId('native-tasks-calendar').props.onEndReached).toBeUndefined();
  });

  it('moves the calendar between months and returns to today', async () => {
    mockedUseLocalSearchParams.mockReturnValue({ taskMode: 'calendar' });
    (taskApi.getTasksPage as jest.Mock).mockResolvedValue({ items: [], total: 0, limit: 40, offset: 0 });
    const monthLabel = (value: Date) => new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(value);
    const now = new Date();
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByText(monthLabel(now))).toBeTruthy());
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    await act(async () => { fireEvent.press(view.getByTestId('native-task-calendar-next')); });
    expect(view.getByText(monthLabel(nextMonth))).toBeTruthy();
    expect(view.getByTestId(`native-task-calendar-day-${nativeTaskDateKey(nextMonth)}`)).toBeTruthy();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    await act(async () => { fireEvent.press(view.getByTestId('native-task-calendar-prev')); });
    await act(async () => { fireEvent.press(view.getByTestId('native-task-calendar-prev')); });
    expect(view.getByText(monthLabel(prevMonth))).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByTestId('native-task-calendar-today')); });
    expect(view.getByText(monthLabel(now))).toBeTruthy();
    expect(view.getByTestId(`native-task-calendar-day-${nativeTaskDateKey(now)}`)).toBeTruthy();
  });

  it('renders the gantt view for task_mode=gantt and opens tasks from bars and the no-due section', async () => {
    mockedUseLocalSearchParams.mockReturnValue({ taskMode: 'gantt' });
    const now = new Date();
    const localIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T12:00:00`;
    const soon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 12);
    (taskApi.getTasksPage as jest.Mock).mockResolvedValue({
      items: [
        { ...listTask, id: 'task-due', title: 'Задача со сроком', status: 'in_progress', due_at: localIso(soon) },
        { ...listTask, id: 'task-nodue', title: 'Задача без срока', status: 'new', due_at: '' },
      ],
      total: 2,
      limit: 40,
      offset: 0,
    });
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByTestId('native-tasks-gantt')).toBeTruthy());
    expect(taskApi.getTasksPage).toHaveBeenCalledWith(expect.objectContaining({ sort_by: 'due_at', sort_dir: 'asc' }));
    expect(view.getByTestId('native-tasks-gantt-row-task-due')).toBeTruthy();
    expect(view.queryByTestId('native-tasks-gantt-row-task-nodue')).toBeNull();
    expect(view.getAllByText('Без срока').length).toBeGreaterThan(0);
    expect(view.getByText('Задача без срока')).toBeTruthy();
    expect(view.getByTestId('native-tasks-gantt').props.onEndReached).toBeUndefined();
    await act(async () => { fireEvent.press(view.getByTestId('native-tasks-gantt-row-task-due')); });
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(shell)/tasks/[taskId]',
      params: { taskId: 'task-due' },
    });
    await act(async () => { fireEvent.press(view.getByTestId('native-task-row-task-nodue')); });
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(shell)/tasks/[taskId]',
      params: { taskId: 'task-nodue' },
    });
  });

  it('renders the deadlines view for task_mode=deadlines and groups tasks into buckets', async () => {
    mockedUseLocalSearchParams.mockReturnValue({ taskMode: 'deadlines' });
    const now = new Date();
    const localIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T12:00:00`;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    const farFuture = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21, 12);
    (taskApi.getTasksPage as jest.Mock).mockResolvedValue({
      items: [
        { ...listTask, id: 'task-overdue', title: 'Просроченная задача', status: 'in_progress', due_at: localIso(yesterday), is_overdue: true },
        { ...listTask, id: 'task-today', title: 'Задача на сегодня', status: 'new', due_at: localIso(today) },
        { ...listTask, id: 'task-later', title: 'Задача вдалеке', status: 'new', due_at: localIso(farFuture) },
        { ...listTask, id: 'task-nodue', title: 'Задача без срока', status: 'new', due_at: '' },
        { ...listTask, id: 'task-done', title: 'Завершённая задача', status: 'done', due_at: '' },
      ],
      total: 5,
      limit: 40,
      offset: 0,
    });
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByTestId('native-tasks-deadlines')).toBeTruthy());
    expect(taskApi.getTasksPage).toHaveBeenCalledWith(expect.objectContaining({ sort_by: 'due_at', sort_dir: 'asc' }));
    ['overdue', 'today', 'this_week', 'next_week', 'no_due', 'later', 'done'].forEach((key) => {
      expect(view.getByTestId(`native-tasks-deadline-bucket-${key}`)).toBeTruthy();
    });
    expect(within(view.getByTestId('native-tasks-deadline-bucket-overdue')).getByText('Просроченная задача')).toBeTruthy();
    expect(within(view.getByTestId('native-tasks-deadline-bucket-today')).getByText('Задача на сегодня')).toBeTruthy();
    expect(within(view.getByTestId('native-tasks-deadline-bucket-later')).getByText('Задача вдалеке')).toBeTruthy();
    expect(within(view.getByTestId('native-tasks-deadline-bucket-no_due')).getByText('Задача без срока')).toBeTruthy();
    expect(within(view.getByTestId('native-tasks-deadline-bucket-done')).getByText('Завершённая задача')).toBeTruthy();
    expect(view.getByTestId('native-tasks-deadlines').props.onEndReached).toBeUndefined();
    await act(async () => { fireEvent.press(view.getByTestId('native-task-row-task-today')); });
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(shell)/tasks/[taskId]',
      params: { taskId: 'task-today' },
    });
  });

  it('warns about a partial deadlines page and loads the next page only on demand', async () => {
    mockedUseLocalSearchParams.mockReturnValue({ taskMode: 'deadlines' });
    (taskApi.getTasksPage as jest.Mock)
      .mockResolvedValueOnce({
        items: [{ ...listTask, id: 'task-a', title: 'Первая задача' }],
        total: 60,
        limit: 40,
        offset: 0,
      })
      .mockResolvedValueOnce({
        items: [{ ...listTask, id: 'task-b', title: 'Вторая задача', status: 'in_progress' }],
        total: 60,
        limit: 40,
        offset: 1,
      });
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByText('Загружено 1 из 60 задач. Доска/календарь может быть неполным.')).toBeTruthy());
    expect(taskApi.getTasksPage).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.press(view.getByTestId('native-tasks-load-more')); });
    await waitFor(() => expect(view.getByText('Вторая задача')).toBeTruthy());
    expect(taskApi.getTasksPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1, limit: 40 }));
  });

  it('disables the board load-more while offline instead of silently refetching', async () => {
    mockedUseLocalSearchParams.mockReturnValue({ taskMode: 'board' });
    (taskApi.getTasksPage as jest.Mock).mockResolvedValueOnce({
      items: [{ ...listTask, id: 'task-a', title: 'Первая задача' }],
      total: 60,
      limit: 40,
      offset: 0,
    });
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByText('Загружено 1 из 60 задач. Доска/календарь может быть неполным.')).toBeTruthy());
    mockAuth.offlineMode = true;
    await act(async () => { view.rerender(<NativeTasksInboxScreen />); });
    await waitFor(() => expect(view.getByText('Нет сети — остальные задачи недоступны.')).toBeTruthy());
    expect(view.getByTestId('native-tasks-load-more').props.accessibilityState.disabled).toBe(true);
    (taskApi.getTasksPage as jest.Mock).mockClear();
    await act(async () => { fireEvent.press(view.getByTestId('native-tasks-load-more')); });
    expect(taskApi.getTasksPage).not.toHaveBeenCalled();
    expect(view.getByText('Первая задача')).toBeTruthy();
  });

  it('keeps the calendar navigation reachable at 320px with a larger font scale', async () => {
    const originalWindow = Dimensions.get('window');
    await act(async () => { Dimensions.set({ window: { ...originalWindow, width: 320, height: 640, fontScale: 1.4 } }); });
    try {
      mockedUseLocalSearchParams.mockReturnValue({ taskMode: 'calendar' });
      const view = await render(<NativeTasksInboxScreen />);
      await waitFor(() => expect(view.getByTestId('native-tasks-calendar')).toBeTruthy());
      const prev = view.getByTestId('native-task-calendar-prev');
      const today = view.getByTestId('native-task-calendar-today');
      const next = view.getByTestId('native-task-calendar-next');
      const styleOf = (element: TestInstance): Record<string, number | string | undefined> => (
        (StyleSheet.flatten(
          typeof element.props.style === 'function' ? element.props.style({ pressed: false }) : element.props.style,
        ) || {}) as Record<string, number | string | undefined>
      );
      [prev, today, next].forEach((button) => {
        expect(styleOf(button).minHeight).toBeGreaterThanOrEqual(44);
      });
      expect(styleOf(today).flex).toBe(1);
      const monthTitle = view.getByText(new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date()));
      expect(monthTitle.parent).not.toBe(prev.parent);
      expect(StyleSheet.flatten(monthTitle.props.style).textAlign).toBe('center');
      const firstDay = view.getAllByTestId(/native-task-calendar-day-/)[0];
      const dayStyle = styleOf(firstDay);
      expect(dayStyle.flex).toBe(1);
      expect(dayStyle.minWidth).toBe(0);
      expect(dayStyle.minHeight).toBeGreaterThanOrEqual(44);
    } finally {
      await act(async () => { Dimensions.set({ window: originalWindow }); });
    }
  });

  it('hides board and calendar controls without tasks.read', async () => {
    setAuth([]);
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByText('Нет доступа к задачам')).toBeTruthy());
    expect(view.queryByTestId('native-task-page-mode-board')).toBeNull();
    expect(view.queryByTestId('native-task-page-mode-calendar')).toBeNull();
    expect(view.queryByTestId('native-tasks-board')).toBeNull();
    expect(view.queryByTestId('native-tasks-calendar')).toBeNull();
  });

  it('does not load task data without tasks.read', async () => {
    setAuth([]);
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByText('Нет доступа к задачам')).toBeTruthy());
    expect(taskApi.getTasksPage).not.toHaveBeenCalled();
  });
});
