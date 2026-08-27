import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import * as departmentsApi from '../../api/departmentsApi';
import * as taskApi from '../../api/taskApi';
import { writeNativeEntitySnapshot } from '../../cache/nativeSnapshotCache';
import { DEFAULT_PREFERENCES, type UserPreferences } from '../../preferences/preferenceNormalizers';
import * as nativeTaskFiles from '../../tasks/nativeTaskFiles';
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
  beforeEach(() => {
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
      uri: 'file:///report.pdf',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 512,
    });
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
    expect(view.getByText('Сохранённый комментарий')).toBeTruthy();
    expect(view.getByText(/Копия от/)).toBeTruthy();
    expect(taskApi.getTask).not.toHaveBeenCalled();
  });

  it('executes only a server-provided task action after confirmation', async () => {
    const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
    await waitFor(() => {
      expect(view.getByText('Установить обновления и проверить сервисы.')).toBeTruthy();
    });
    expect(view.getByTestId('native-task-action-start')).toBeTruthy();
    expect(view.queryByTestId('native-task-action-approve')).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByTestId('native-task-action-start'));
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

  it('adds a comment from the native detail composer', async () => {
    const view = await render(<NativeTaskDetailScreen taskId="task-1" />);
    await waitFor(() => expect(view.getByText('Проверьте резервную копию')).toBeTruthy());
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
    (taskApi.getTask as jest.Mock).mockResolvedValueOnce({
      ...detailTask,
      protocol_date: '2026-08-24',
      assignee_user_id: 7,
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
      fireEvent.press(view.getByTestId('native-task-edit-controller-8'));
      fireEvent.press(view.getByTestId('native-task-edit-observer-8'));
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
    await waitFor(() => expect(taskApi.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      title: 'Обновлённая задача',
      due_at: '2026-09-02T18:00:00',
      priority: 'urgent',
      assignee_user_id: 7,
      controller_user_id: 8,
      observer_user_ids: [8],
      project_id: 'general-tasks',
      object_id: 'object-1',
      department_id: 'department-1',
      visibility_scope: 'department',
      email_deadline_remind_hours: 12,
    })));
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
    await waitFor(() => expect(view.getByTestId('native-task-action-submit')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('native-task-action-submit')); });
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
    await waitFor(() => expect(view.getByTestId('native-task-department-department-1')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByTestId('native-task-create-title'), 'Задача с напоминанием');
      fireEvent.changeText(view.getByTestId('native-task-create-due'), '2026-09-10');
      fireEvent.press(view.getByTestId('native-task-assignee-7'));
      fireEvent.press(view.getByTestId('native-task-department-department-1'));
    });
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
    await waitFor(() => expect(createOnly.getByText('Серверная')).toBeTruthy());
    expect(createOnly.queryByTestId('native-task-new-object-name')).toBeNull();
  });

  it('creates and selects an object with tasks.write permission', async () => {
    setAuth(['tasks.read', 'tasks.write']);
    const writer = await render(<NativeTaskCreateScreen />);
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

  it('does not load task data without tasks.read', async () => {
    setAuth([]);
    const view = await render(<NativeTasksInboxScreen />);
    await waitFor(() => expect(view.getByText('Нет доступа к задачам')).toBeTruthy());
    expect(taskApi.getTasksPage).not.toHaveBeenCalled();
  });
});
