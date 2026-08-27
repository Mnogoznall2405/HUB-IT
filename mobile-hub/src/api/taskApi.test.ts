import apiClient from './client';
import {
  createTask,
  createTaskObject,
  createTaskProject,
  deleteTask,
  getTaskAnalytics,
  getTaskObjects,
  getTaskProjects,
  getTaskStatusLog,
  getTasksPage,
  searchTaskAssignees,
  searchTaskControllers,
  submitTask,
  taskAnalyticsPath,
  updateTask,
  updateTaskObject,
  updateTaskProject,
  uploadTaskAttachment,
} from './taskApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedClient = apiClient as unknown as { get: jest.Mock; post: jest.Mock; patch: jest.Mock; delete: jest.Mock };

describe('taskApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads a paged personal task list with native filters', async () => {
    mockedClient.get.mockResolvedValue({
      data: { items: [{ id: 't1', title: 'Task' }], total: 4, limit: 20, offset: 0 },
    });
    await expect(getTasksPage({ q: 'task', status: 'review', limit: 20 })).resolves.toEqual({
      items: [{ id: 't1', title: 'Task' }],
      total: 4,
      limit: 20,
      offset: 0,
    });
    expect(mockedClient.get).toHaveBeenCalledWith('/hub/tasks', {
      params: expect.objectContaining({
        scope: 'my',
        role_scope: 'both',
        q: 'task',
        status: 'review',
        limit: 20,
        offset: 0,
      }),
    });
  });

  it('serializes repeated analytics filters and loads the native payload', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        summary: { total: 3 },
        by_participant: [],
        by_project: [],
        by_object: [],
        status_breakdown: [],
        trend: { granularity: 'day', items: [] },
        truncated: false,
      },
    });
    const params = {
      start_date: '2026-08-01',
      end_date: '2026-08-24',
      date_basis: 'due_at' as const,
      project_ids: ['project 1', 'project/2'],
      object_ids: ['object-1'],
      participant_user_ids: [7, 8],
    };
    const path = taskAnalyticsPath('/hub/tasks/analytics', params);
    expect(path).toBe('/hub/tasks/analytics?start_date=2026-08-01&end_date=2026-08-24&date_basis=due_at&project_id=project+1&project_id=project%2F2&object_id=object-1&participant_user_id=7&participant_user_id=8');
    await expect(getTaskAnalytics(params)).resolves.toMatchObject({ summary: { total: 3 } });
    expect(mockedClient.get).toHaveBeenCalledWith(path);
  });

  it('loads active projects and assignees for the create form', async () => {
    mockedClient.get
      .mockResolvedValueOnce({ data: { items: [{ id: 'p1', name: 'General', is_active: true }, { id: 'p2', name: 'Old', is_active: false }] } })
      .mockResolvedValueOnce({ data: { items: [{ id: 7, full_name: 'User Seven' }] } });
    await expect(getTaskProjects()).resolves.toEqual([{ id: 'p1', name: 'General', is_active: true }]);
    await expect(searchTaskAssignees('seven', 25)).resolves.toEqual([{ id: 7, full_name: 'User Seven' }]);
    expect(mockedClient.get).toHaveBeenLastCalledWith('/hub/users/assignees', {
      params: { q: 'seven', limit: 25 },
    });
  });

  it('loads active task objects and the controller directory for the extended create form', async () => {
    mockedClient.get
      .mockResolvedValueOnce({
        data: {
          items: [
            { id: 'object-1', project_id: 'project-1', name: 'Server room', is_active: true },
            { id: 'object-2', name: 'Retired office', is_active: false },
          ],
        },
      })
      .mockResolvedValueOnce({ data: { items: [{ id: 8, full_name: 'Controller Eight' }] } });

    await expect(getTaskObjects()).resolves.toEqual([
      { id: 'object-1', project_id: 'project-1', name: 'Server room', is_active: true },
    ]);
    await expect(searchTaskControllers('eight', 25)).resolves.toEqual([
      { id: 8, full_name: 'Controller Eight' },
    ]);
    expect(mockedClient.get).toHaveBeenNthCalledWith(1, '/hub/task-objects');
    expect(mockedClient.get).toHaveBeenNthCalledWith(2, '/hub/users/controllers', {
      params: { q: 'eight', limit: 25 },
    });
  });

  it('creates one task per selected assignee through the existing backend contract', async () => {
    mockedClient.post.mockResolvedValue({ data: { items: [{ id: 't1' }, { id: 't2' }], created: 2 } });
    await expect(createTask({
      title: 'Native task',
      assignee_user_ids: [7, 8],
      project_id: 'p1',
      protocol_date: '2026-08-24',
      due_at: '2026-08-25T18:00:00',
      email_deadline_remind_hours: 6,
      priority: 'normal',
    })).resolves.toEqual([{ id: 't1' }, { id: 't2' }]);
    expect(mockedClient.post).toHaveBeenCalledWith('/hub/tasks', expect.objectContaining({
      assignee_user_ids: [7, 8],
      project_id: 'p1',
      email_deadline_remind_hours: 6,
    }));
  });

  it('creates task projects and objects through their permission-protected backend endpoints', async () => {
    mockedClient.post
      .mockResolvedValueOnce({ data: { id: 'project-2', name: 'Project Two' } })
      .mockResolvedValueOnce({ data: { id: 'object-2', project_id: 'project-2', name: 'Room Two' } });
    await expect(createTaskProject({ name: 'Project Two', code: '', description: '', is_active: true }))
      .resolves.toMatchObject({ id: 'project-2' });
    await expect(createTaskObject({ project_id: 'project-2', name: 'Room Two', code: '', description: '', is_active: true }))
      .resolves.toMatchObject({ id: 'object-2', project_id: 'project-2' });
    expect(mockedClient.post).toHaveBeenNthCalledWith(1, '/hub/task-projects', {
      name: 'Project Two', code: '', description: '', is_active: true,
    });
    expect(mockedClient.post).toHaveBeenNthCalledWith(2, '/hub/task-objects', {
      project_id: 'project-2', name: 'Room Two', code: '', description: '', is_active: true,
    });
  });

  it('loads inactive taxonomy and updates project and object metadata', async () => {
    mockedClient.get
      .mockResolvedValueOnce({ data: { items: [{ id: 'p1', name: 'Project', is_active: false }] } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'o1', project_id: 'p1', name: 'Object', is_active: false }] } });
    mockedClient.patch
      .mockResolvedValueOnce({ data: { id: 'p1', name: 'Project 2', is_active: true } })
      .mockResolvedValueOnce({ data: { id: 'o1', project_id: 'p1', name: 'Object 2', is_active: true } });

    await expect(getTaskProjects({ includeInactive: true })).resolves.toHaveLength(1);
    await expect(getTaskObjects({ includeInactive: true, projectIds: ['p1'] })).resolves.toHaveLength(1);
    expect(mockedClient.get).toHaveBeenNthCalledWith(1, '/hub/task-projects', { params: { include_inactive: true } });
    expect(mockedClient.get).toHaveBeenNthCalledWith(2, '/hub/task-objects?include_inactive=true&project_id=p1');
    await updateTaskProject('project/1', { name: 'Project 2', is_active: true });
    await updateTaskObject('object/1', { name: 'Object 2', is_active: true });
    expect(mockedClient.patch).toHaveBeenNthCalledWith(1, '/hub/task-projects/project%2F1', { name: 'Project 2', is_active: true });
    expect(mockedClient.patch).toHaveBeenNthCalledWith(2, '/hub/task-objects/object%2F1', { name: 'Object 2', is_active: true });
  });

  it('updates task fields and checklist through the shared patch contract', async () => {
    mockedClient.patch.mockResolvedValue({ data: { id: 't1', title: 'Updated' } });
    await expect(updateTask('task/1', {
      title: 'Updated',
      checklist_items: [{ id: 'step-1', text: 'Check', done: true }],
    })).resolves.toEqual({ id: 't1', title: 'Updated' });
    expect(mockedClient.patch).toHaveBeenCalledWith('/hub/tasks/task%2F1', {
      title: 'Updated',
      checklist_items: [{ id: 'step-1', text: 'Check', done: true }],
    });
  });

  it('loads the status history and deletes a task through the canonical task path', async () => {
    mockedClient.get.mockResolvedValue({
      data: { items: [{ id: 'log-1', old_status: 'new', new_status: 'in_progress' }] },
    });
    mockedClient.delete.mockResolvedValue({ data: { ok: true, task_id: 'task/1' } });

    await expect(getTaskStatusLog('task/1')).resolves.toEqual([
      { id: 'log-1', old_status: 'new', new_status: 'in_progress' },
    ]);
    await expect(deleteTask('task/1')).resolves.toEqual({ ok: true, task_id: 'task/1' });
    expect(mockedClient.get).toHaveBeenCalledWith('/hub/tasks/task%2F1/status-log');
    expect(mockedClient.delete).toHaveBeenCalledWith('/hub/tasks/task%2F1');
  });

  it('uploads attachments and submits an optional report as multipart data', async () => {
    const originalFormData = global.FormData;
    const append = jest.fn();
    global.FormData = jest.fn(() => ({ append })) as unknown as typeof FormData;
    mockedClient.post
      .mockResolvedValueOnce({ data: { id: 'attachment-1', file_name: 'report.pdf' } })
      .mockResolvedValueOnce({ data: { id: 't1', status: 'review' } });
    const file = { uri: 'file:///report.pdf', name: 'report.pdf', mimeType: 'application/pdf', size: 512 };
    try {
      await uploadTaskAttachment('t1', file);
      await submitTask('t1', 'Готово', file);
    } finally {
      global.FormData = originalFormData;
    }
    expect(append).toHaveBeenCalledWith('file', expect.objectContaining({ uri: file.uri, name: file.name, type: file.mimeType }));
    expect(append).toHaveBeenCalledWith('comment', 'Готово');
    expect(mockedClient.post).toHaveBeenNthCalledWith(1, '/hub/tasks/t1/attachments', expect.anything(), {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    expect(mockedClient.post).toHaveBeenNthCalledWith(2, '/hub/tasks/t1/submit', expect.anything(), {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  });
});
