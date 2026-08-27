import apiClient from './client';
import {
  applyDocflowTaskAction,
  createDocflowAssignment,
  DOCFLOW_QUERY_TIMEOUT_MS,
  getDocflowAssignmentCommand,
  getDocflowFilePreviewState,
  getDocflowTask,
  listDocflowTasks,
  normalizeDocflowOpenUrl,
  searchDocflowAssignmentAssignees,
  searchDocflowAssignmentDocuments,
} from './docflowApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const client = apiClient as unknown as { get: jest.Mock; post: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('accepts only absolute HTTPS links for opening the official 1C client', () => {
  expect(normalizeDocflowOpenUrl('https://docflow.example/1c/task')).toBe('https://docflow.example/1c/task');
  expect(normalizeDocflowOpenUrl('http://docflow.example/1c/task')).toBeNull();
  expect(normalizeDocflowOpenUrl('javascript:alert(1)')).toBeNull();
  expect(normalizeDocflowOpenUrl('/relative/task')).toBeNull();
});

it('loads live tasks with the 1C timeout and drops malformed rows', async () => {
  client.get.mockResolvedValue({
    data: {
      items: [{ ref: ' task-1 ', title: ' Согласовать договор ', completed: false }, { title: 'invalid' }],
      returned: '1',
      scope: 'inbox',
      source: 'live_1c',
      as_of: '2026-08-24T10:00:00+05:00',
      truncated: true,
    },
  });
  await expect(listDocflowTasks({ scope: 'inbox', q: ' договор ', limit: 500 })).resolves.toMatchObject({
    items: [{ ref: 'task-1', title: 'Согласовать договор' }],
    returned: 1,
    truncated: true,
  });
  expect(client.get).toHaveBeenCalledWith('/docflow/tasks', expect.objectContaining({
    params: { scope: 'inbox', q: 'договор', limit: 100 },
    timeout: DOCFLOW_QUERY_TIMEOUT_MS,
  }));
});

it('encodes a task ref and makes progressive detail explicit', async () => {
  client.get.mockResolvedValue({ data: { ref: 'task/1', title: 'Карточка', files: [], related_objects: [] } });
  await expect(getDocflowTask('task/1', false)).resolves.toMatchObject({ ref: 'task/1', title: 'Карточка' });
  expect(client.get).toHaveBeenCalledWith('/docflow/tasks/task%2F1', expect.objectContaining({
    params: { include_related: 0 },
    timeout: DOCFLOW_QUERY_TIMEOUT_MS,
  }));
});

it('loads bounded async preview state through the authenticated API client', async () => {
  const controller = new AbortController();
  client.get.mockResolvedValue({ data: { status: 'processing', retry_after_ms: 99_999 } });
  await expect(getDocflowFilePreviewState('task/1', 'file 2', controller.signal)).resolves.toEqual({
    status: 'processing',
    retry_after_ms: 5_000,
    pdf_filename: null,
    error_code: null,
  });
  expect(client.get).toHaveBeenCalledWith(
    '/docflow/tasks/task%2F1/files/file%202/preview',
    expect.objectContaining({ signal: controller.signal, timeout: DOCFLOW_QUERY_TIMEOUT_MS }),
  );
});

it('sends only server action data with the stable idempotency key', async () => {
  client.post.mockResolvedValue({ data: { command_id: 'cmd-1', status: 'pending', correlation_id: 'corr-1' } });
  await expect(applyDocflowTaskAction('task-1', {
    action: 'approve',
    comment: ' Готово ',
    state_token: 'state-token-1234567890',
  }, 'same-key-123')).resolves.toMatchObject({ status: 'pending', command_id: 'cmd-1' });
  expect(client.post).toHaveBeenCalledWith('/docflow/tasks/task-1/actions', {
    action: 'approve',
    comment: 'Готово',
    state_token: 'state-token-1234567890',
  }, {
    headers: { 'Idempotency-Key': 'same-key-123' },
    timeout: DOCFLOW_QUERY_TIMEOUT_MS,
  });
});

it('searches assignment documents and assignees with bounded server queries', async () => {
  client.get
    .mockResolvedValueOnce({ data: { items: [{ ref: 'doc-1', document_type: 'internal', title: 'Договор', document_type_label: 'Внутренний' }], returned: 1, truncated: false } })
    .mockResolvedValueOnce({ data: { items: [{ ref: 'user-1', name: 'Иванов Иван', department: 'ИТ' }], returned: 1, truncated: true, reason: 'Уточните ФИО' } });
  await expect(searchDocflowAssignmentDocuments(' договор ', 100)).resolves.toMatchObject({ items: [{ ref: 'doc-1', title: 'Договор' }] });
  await expect(searchDocflowAssignmentAssignees(' Иванов ', 100)).resolves.toMatchObject({ items: [{ ref: 'user-1', name: 'Иванов Иван' }], truncated: true });
  expect(client.get).toHaveBeenNthCalledWith(1, '/docflow/assignments/documents', expect.objectContaining({ params: { q: 'договор', limit: 50 } }));
  expect(client.get).toHaveBeenNthCalledWith(2, '/docflow/assignments/assignees', expect.objectContaining({ params: { q: 'Иванов', limit: 50 } }));
  await expect(searchDocflowAssignmentDocuments('ab')).rejects.toThrow('не менее 3');
});

it('creates an assignment once and checks the resulting command by encoded id', async () => {
  client.post.mockResolvedValueOnce({ data: { command_id: 'command-1', status: 'pending', correlation_id: 'corr-1' } });
  client.get.mockResolvedValueOnce({ data: { command_id: 'command-1', status: 'applied', correlation_id: 'corr-1', assignment: { process_ref: 'process-1', title: 'Проверить договор' } } });
  await expect(createDocflowAssignment({
    document_type: 'internal',
    document_ref: '11111111-1111-1111-1111-111111111111',
    assignee_ref: '22222222-2222-2222-2222-222222222222',
    controller_ref: null,
    due_at: '2026-08-25T12:00:00+05:00',
    importance: 'high',
    title: 'HUB-IT TEST · Проверить договор',
    description: 'Проверьте условия.',
  }, 'assignment-key-1')).resolves.toMatchObject({ status: 'pending', command_id: 'command-1' });
  expect(client.post).toHaveBeenCalledWith('/docflow/assignments', expect.objectContaining({
    document_type: 'internal',
    importance: 'high',
  }), expect.objectContaining({ headers: { 'Idempotency-Key': 'assignment-key-1' } }));
  await expect(getDocflowAssignmentCommand('command/1')).resolves.toMatchObject({ status: 'applied', assignment: { process_ref: 'process-1' } });
  expect(client.get).toHaveBeenCalledWith('/docflow/assignments/commands/command%2F1', expect.anything());
});
