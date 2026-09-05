import apiClient from './client';

export const DOCFLOW_QUERY_TIMEOUT_MS = 95_000;

export type DocflowInboxSummary = {
  status: 'loading' | 'not_configured' | 'available' | 'unavailable';
  count: number | null;
  truncated?: boolean;
  as_of?: string | null;
};

export type DocflowCredentialProfile = {
  configured: boolean;
  login: string | null;
  status: 'not_configured' | 'configured' | 'valid' | 'invalid' | 'unavailable';
  last_error_code: string | null;
  last_verified_at: string | null;
  updated_at: string | null;
};

export type DocflowScope = 'inbox' | 'completed' | 'all';
export type DocflowActionCode =
  | 'acknowledge'
  | 'approve'
  | 'approve_with_comments'
  | 'reject'
  | 'complete'
  | 'accept_invitation'
  | 'decline_invitation';

export type DocflowTaskSummary = {
  ref: string;
  task_type: string;
  task_type_label: string;
  title: string;
  number: string | null;
  created_at: string | null;
  due_at: string | null;
  author: string | null;
  subject: string | null;
  description: string | null;
  result: string | null;
  business_state: string | null;
  importance: string | null;
  accepted: boolean | null;
  completed_at: string | null;
  completed: boolean;
};

export type DocflowTaskFile = {
  ref: string;
  name: string;
  extension: string;
  content_type: string;
  size: number;
  created_at: string | null;
  description: string | null;
  preview_supported: boolean;
};

export type DocflowFilePreviewState = {
  status: 'queued' | 'processing' | 'ready' | 'failed';
  retry_after_ms: number;
  pdf_filename: string | null;
  error_code: string | null;
};

export type DocflowAvailableAction = {
  code: DocflowActionCode;
  label: string;
  tone: 'primary' | 'success' | 'error' | 'warning';
  comment_mode: 'optional' | 'required';
};

export type DocflowRelatedObject = {
  ref: string;
  object_type: string | null;
  object_type_label: string | null;
  title: string;
};

export type DocflowTaskDetail = DocflowTaskSummary & {
  xdto_task_type: string | null;
  process_name: string | null;
  process_ref: string | null;
  process_type: string | null;
  process_type_label: string | null;
  xdto_process_type: string | null;
  dm_version: string | null;
  configuration_fingerprint: string | null;
  state_token: string | null;
  available_actions: DocflowAvailableAction[];
  action_unavailable_reason: string | null;
  requires_digital_signature: boolean;
  open_in_1c_url: string | null;
  related_objects: DocflowRelatedObject[];
  files: DocflowTaskFile[];
  files_incomplete: boolean;
};

export type DocflowTaskList = {
  items: DocflowTaskSummary[];
  returned: number;
  /** Present on normalized API results; optional keeps existing typed fixtures source-compatible. */
  offset?: number;
  total?: number | null;
  has_more?: boolean;
  next_offset?: number | null;
  scope: DocflowScope;
  source: 'live_1c';
  as_of: string;
  truncated: boolean;
};

export type DocflowCommandStatus = 'applied' | 'already_applied' | 'state_unknown' | 'rejected' | 'pending';
export type DocflowCommand = {
  command_id: string;
  status: DocflowCommandStatus;
  task: DocflowTaskDetail | null;
  correlation_id: string;
  error_code: string | null;
};

export type DocflowAssignmentCapability = {
  enabled: boolean;
  reason: string | null;
  document_types: Array<'internal' | 'incoming' | 'outgoing'>;
  test_only: boolean;
  required_title_prefix: string | null;
};

export type DocflowAssignmentDocument = {
  ref: string;
  document_type: 'internal' | 'incoming' | 'outgoing';
  document_type_label: string;
  title: string;
  number: string | null;
  date: string | null;
};

export type DocflowAssignmentAssignee = {
  ref: string;
  name: string;
  department: string | null;
};

export type DocflowAssignmentSearchResult<T> = {
  items: T[];
  returned: number;
  truncated: boolean;
  reason: string | null;
  as_of: string;
};

export type DocflowAssignmentCreatePayload = {
  document_type: DocflowAssignmentDocument['document_type'];
  document_ref: string;
  assignee_ref: string;
  controller_ref: string | null;
  due_at: string;
  importance: 'normal' | 'high';
  title: string;
  description: string;
};

export type DocflowCreatedAssignment = {
  process_ref: string;
  task_ref: string | null;
  title: string;
  state: string | null;
  task_completed: boolean | null;
};

export type DocflowAssignmentCommand = {
  command_id: string;
  status: DocflowCommandStatus;
  assignment: DocflowCreatedAssignment | null;
  correlation_id: string;
  error_code: string | null;
};

const ACTIONS = new Set<DocflowActionCode>([
  'acknowledge', 'approve', 'approve_with_comments', 'reject', 'complete',
  'accept_invitation', 'decline_invitation',
]);
const SCOPES = new Set<DocflowScope>(['inbox', 'completed', 'all']);
const COMMAND_STATUSES = new Set<DocflowCommandStatus>(['applied', 'already_applied', 'state_unknown', 'rejected', 'pending']);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, maxLength = 4_096): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function nullableText(value: unknown, maxLength = 4_096): string | null {
  return text(value, maxLength) || null;
}

export function normalizeDocflowOpenUrl(value: unknown): string | null {
  const raw = nullableText(value, 4_096);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function nonNegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function normalizeDocflowProfile(value: unknown): DocflowCredentialProfile {
  const row = record(value);
  const rawStatus = text(row.status, 64) as DocflowCredentialProfile['status'];
  const status = ['not_configured', 'configured', 'valid', 'invalid', 'unavailable'].includes(rawStatus)
    ? rawStatus
    : row.configured === true ? 'configured' : 'not_configured';
  return {
    configured: row.configured === true,
    login: nullableText(row.login, 128),
    status,
    last_error_code: nullableText(row.last_error_code, 128),
    last_verified_at: nullableText(row.last_verified_at, 128),
    updated_at: nullableText(row.updated_at, 128),
  };
}

export function normalizeDocflowTaskSummary(value: unknown): DocflowTaskSummary | null {
  const row = record(value);
  const ref = text(row.ref, 128);
  if (!ref) return null;
  return {
    ref,
    task_type: text(row.task_type, 128),
    task_type_label: text(row.task_type_label, 256),
    title: text(row.title) || 'Задание 1С',
    number: nullableText(row.number, 256),
    created_at: nullableText(row.created_at, 128),
    due_at: nullableText(row.due_at, 128),
    author: nullableText(row.author, 512),
    subject: nullableText(row.subject),
    description: nullableText(row.description, 32_000),
    result: nullableText(row.result, 8_000),
    business_state: nullableText(row.business_state, 512),
    importance: nullableText(row.importance, 256),
    accepted: nullableBoolean(row.accepted),
    completed_at: nullableText(row.completed_at, 128),
    completed: row.completed === true,
  };
}

function normalizeDocflowFile(value: unknown): DocflowTaskFile | null {
  const row = record(value);
  const ref = text(row.ref, 128);
  if (!ref) return null;
  return {
    ref,
    name: text(row.name, 512) || 'Документ 1С',
    extension: text(row.extension, 64),
    content_type: text(row.content_type, 256) || 'application/octet-stream',
    size: nonNegative(row.size),
    created_at: nullableText(row.created_at, 128),
    description: nullableText(row.description, 4_096),
    preview_supported: row.preview_supported === true,
  };
}

function normalizeDocflowAction(value: unknown): DocflowAvailableAction | null {
  const row = record(value);
  const code = text(row.code, 64) as DocflowActionCode;
  if (!ACTIONS.has(code)) return null;
  const tone = text(row.tone, 32) as DocflowAvailableAction['tone'];
  return {
    code,
    label: text(row.label, 256) || code,
    tone: ['primary', 'success', 'error', 'warning'].includes(tone) ? tone : 'primary',
    comment_mode: row.comment_mode === 'required' ? 'required' : 'optional',
  };
}

export function normalizeDocflowTaskDetail(value: unknown): DocflowTaskDetail | null {
  const row = record(value);
  const summary = normalizeDocflowTaskSummary(row);
  if (!summary) return null;
  const related = (Array.isArray(row.related_objects) ? row.related_objects : []).map((item) => {
    const relatedRow = record(item);
    const ref = text(relatedRow.ref, 128);
    const title = text(relatedRow.title);
    return ref && title ? {
      ref,
      object_type: nullableText(relatedRow.object_type, 128),
      object_type_label: nullableText(relatedRow.object_type_label, 256),
      title,
    } : null;
  }).filter((item): item is DocflowRelatedObject => Boolean(item));
  return {
    ...summary,
    xdto_task_type: nullableText(row.xdto_task_type, 256),
    process_name: nullableText(row.process_name),
    process_ref: nullableText(row.process_ref, 128),
    process_type: nullableText(row.process_type, 128),
    process_type_label: nullableText(row.process_type_label, 256),
    xdto_process_type: nullableText(row.xdto_process_type, 256),
    dm_version: nullableText(row.dm_version, 128),
    configuration_fingerprint: nullableText(row.configuration_fingerprint, 256),
    state_token: nullableText(row.state_token, 512),
    available_actions: (Array.isArray(row.available_actions) ? row.available_actions : [])
      .map(normalizeDocflowAction)
      .filter((item): item is DocflowAvailableAction => Boolean(item)),
    action_unavailable_reason: nullableText(row.action_unavailable_reason, 4_096),
    requires_digital_signature: row.requires_digital_signature === true,
    open_in_1c_url: normalizeDocflowOpenUrl(row.open_in_1c_url),
    related_objects: related,
    files: (Array.isArray(row.files) ? row.files : [])
      .map(normalizeDocflowFile)
      .filter((item): item is DocflowTaskFile => Boolean(item)),
    files_incomplete: row.files_incomplete === true,
  };
}

function normalizeDocflowCommand(value: unknown): DocflowCommand {
  const row = record(value);
  const rawStatus = text(row.status, 64) as DocflowCommandStatus;
  return {
    command_id: text(row.command_id, 128),
    status: COMMAND_STATUSES.has(rawStatus) ? rawStatus : 'rejected',
    task: normalizeDocflowTaskDetail(row.task),
    correlation_id: text(row.correlation_id, 128),
    error_code: nullableText(row.error_code, 128),
  };
}

function normalizeAssignmentDocument(value: unknown): DocflowAssignmentDocument | null {
  const row = record(value);
  const ref = text(row.ref, 128);
  const documentType = text(row.document_type, 32) as DocflowAssignmentDocument['document_type'];
  if (!ref || !['internal', 'incoming', 'outgoing'].includes(documentType)) return null;
  return {
    ref,
    document_type: documentType,
    document_type_label: text(row.document_type_label, 256) || 'Документ 1С',
    title: text(row.title, 2_000) || 'Документ 1С',
    number: nullableText(row.number, 256),
    date: nullableText(row.date, 128),
  };
}

function normalizeAssignmentAssignee(value: unknown): DocflowAssignmentAssignee | null {
  const row = record(value);
  const ref = text(row.ref, 128);
  const name = text(row.name, 512);
  if (!ref || !name) return null;
  return { ref, name, department: nullableText(row.department, 512) };
}

function normalizeAssignmentSearchResult<T>(
  value: unknown,
  normalizeItem: (item: unknown) => T | null,
): DocflowAssignmentSearchResult<T> {
  const row = record(value);
  const items = (Array.isArray(row.items) ? row.items : [])
    .map(normalizeItem)
    .filter((item): item is T => Boolean(item));
  return {
    items,
    returned: nonNegative(row.returned ?? items.length),
    truncated: row.truncated === true,
    reason: nullableText(row.reason, 4_096),
    as_of: text(row.as_of, 128),
  };
}

function normalizeAssignmentCommand(value: unknown): DocflowAssignmentCommand {
  const row = record(value);
  const assignmentRow = record(row.assignment);
  const processRef = text(assignmentRow.process_ref, 128);
  const rawStatus = text(row.status, 64) as DocflowCommandStatus;
  return {
    command_id: text(row.command_id, 128),
    status: COMMAND_STATUSES.has(rawStatus) ? rawStatus : 'rejected',
    assignment: processRef ? {
      process_ref: processRef,
      task_ref: nullableText(assignmentRow.task_ref, 128),
      title: text(assignmentRow.title, 2_000) || 'Поручение 1С',
      state: nullableText(assignmentRow.state, 512),
      task_completed: nullableBoolean(assignmentRow.task_completed),
    } : null,
    correlation_id: text(row.correlation_id, 128),
    error_code: nullableText(row.error_code, 128),
  };
}

const noStore = { headers: { 'Cache-Control': 'no-store' }, timeout: DOCFLOW_QUERY_TIMEOUT_MS };

export async function getInboxSummary(): Promise<DocflowInboxSummary> {
  const { data } = await apiClient.get<DocflowInboxSummary>('/docflow/inbox-summary', noStore);
  return {
    status: data?.status || 'unavailable',
    count: data?.count == null ? null : nonNegative(data.count),
    truncated: Boolean(data?.truncated),
    as_of: data?.as_of || null,
  };
}

export async function getDocflowProfile(): Promise<DocflowCredentialProfile> {
  const { data } = await apiClient.get('/docflow/profile', noStore);
  return normalizeDocflowProfile(data);
}

export async function testDocflowCredentials(login: string, password: string): Promise<void> {
  await apiClient.post('/docflow/profile/test', { login: text(login, 128), password: String(password || '') }, { timeout: DOCFLOW_QUERY_TIMEOUT_MS });
}

export async function saveDocflowCredentials(login: string, password: string): Promise<DocflowCredentialProfile> {
  const { data } = await apiClient.put('/docflow/profile/credentials', { login: text(login, 128), password: String(password || '') }, { timeout: DOCFLOW_QUERY_TIMEOUT_MS });
  return normalizeDocflowProfile(data);
}

export async function deleteDocflowCredentials(): Promise<void> {
  await apiClient.delete('/docflow/profile/credentials');
}

export async function listDocflowTasks(options: { scope?: DocflowScope; q?: string; limit?: number; offset?: number } = {}): Promise<DocflowTaskList> {
  const scope = SCOPES.has(options.scope || 'inbox') ? options.scope || 'inbox' : 'inbox';
  const q = text(options.q, 200);
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 50)));
  const offset = Math.min(10_000, Math.max(0, Math.trunc(options.offset ?? 0)));
  const { data } = await apiClient.get('/docflow/tasks', { params: { scope, q, limit, offset }, ...noStore });
  const row = record(data);
  const items = (Array.isArray(row.items) ? row.items : [])
    .map(normalizeDocflowTaskSummary)
    .filter((item): item is DocflowTaskSummary => Boolean(item));
  const responseOffset = nonNegative(row.offset ?? offset);
  const advertisedNextOffset = row.next_offset == null ? null : nonNegative(row.next_offset);
  const nextOffset = advertisedNextOffset != null && advertisedNextOffset > responseOffset
    ? advertisedNextOffset
    : null;
  const hasMore = row.has_more === true && nextOffset != null;
  return {
    items,
    returned: nonNegative(row.returned ?? items.length),
    offset: responseOffset,
    total: row.total == null ? null : nonNegative(row.total),
    has_more: hasMore,
    next_offset: hasMore ? nextOffset : null,
    scope,
    source: 'live_1c',
    as_of: text(row.as_of, 128),
    truncated: row.truncated === true,
  };
}

export async function getDocflowTask(taskRef: string, includeRelated = true): Promise<DocflowTaskDetail> {
  const ref = text(taskRef, 128);
  if (!ref) throw new Error('Не выбрано задание 1С');
  const { data } = await apiClient.get(`/docflow/tasks/${encodeURIComponent(ref)}`, {
    params: { include_related: includeRelated ? 1 : 0 },
    ...noStore,
  });
  const task = normalizeDocflowTaskDetail(data);
  if (!task) throw new Error('1С вернула некорректную карточку задания');
  return task;
}

export async function getDocflowFilePreviewState(
  taskRef: string,
  fileRef: string,
  signal?: AbortSignal,
): Promise<DocflowFilePreviewState> {
  const safeTaskRef = text(taskRef, 128);
  const safeFileRef = text(fileRef, 128);
  if (!safeTaskRef || !safeFileRef) throw new Error('Не выбран файл задания 1С');
  const { data } = await apiClient.get(
    `/docflow/tasks/${encodeURIComponent(safeTaskRef)}/files/${encodeURIComponent(safeFileRef)}/preview`,
    { ...noStore, signal },
  );
  const row = record(data);
  const rawStatus = text(row.status, 32);
  const status: DocflowFilePreviewState['status'] = (
    rawStatus === 'processing' || rawStatus === 'ready' || rawStatus === 'failed'
      ? rawStatus
      : 'queued'
  );
  return {
    status,
    retry_after_ms: Math.min(5_000, Math.max(100, Math.trunc(nonNegative(row.retry_after_ms) || 500))),
    pdf_filename: nullableText(row.pdf_filename, 512),
    error_code: nullableText(row.error_code, 128),
  };
}

export async function applyDocflowTaskAction(
  taskRef: string,
  payload: { action: DocflowActionCode; comment: string; state_token: string },
  idempotencyKey: string,
): Promise<DocflowCommand> {
  const ref = text(taskRef, 128);
  if (!ref || !ACTIONS.has(payload.action)) throw new Error('Некорректное действие задания 1С');
  const { data } = await apiClient.post(
    `/docflow/tasks/${encodeURIComponent(ref)}/actions`,
    { action: payload.action, comment: text(payload.comment, 2_000), state_token: text(payload.state_token, 512) },
    { headers: { 'Idempotency-Key': text(idempotencyKey, 128) }, timeout: DOCFLOW_QUERY_TIMEOUT_MS },
  );
  return normalizeDocflowCommand(data);
}

export async function getDocflowCommand(commandId: string): Promise<DocflowCommand> {
  const id = text(commandId, 128);
  if (!id) throw new Error('Не выбрана команда 1С');
  const { data } = await apiClient.get(`/docflow/commands/${encodeURIComponent(id)}`, noStore);
  return normalizeDocflowCommand(data);
}

export async function getDocflowAssignmentCapability(): Promise<DocflowAssignmentCapability> {
  const { data } = await apiClient.get('/docflow/assignments/capability', noStore);
  const row = record(data);
  const allowed = new Set(['internal', 'incoming', 'outgoing']);
  return {
    enabled: row.enabled === true,
    reason: nullableText(row.reason, 4_096),
    document_types: (Array.isArray(row.document_types) ? row.document_types : [])
      .map((value) => text(value, 32))
      .filter((value): value is 'internal' | 'incoming' | 'outgoing' => allowed.has(value)),
    test_only: row.test_only !== false,
    required_title_prefix: nullableText(row.required_title_prefix, 256),
  };
}

export async function searchDocflowAssignmentDocuments(
  query: string,
  limit = 20,
): Promise<DocflowAssignmentSearchResult<DocflowAssignmentDocument>> {
  const q = text(query, 200);
  if (q.length < 3) throw new Error('Введите не менее 3 символов для поиска документов');
  const { data } = await apiClient.get('/docflow/assignments/documents', {
    params: { q, limit: Math.min(50, Math.max(1, Math.trunc(limit))) },
    ...noStore,
  });
  return normalizeAssignmentSearchResult(data, normalizeAssignmentDocument);
}

export async function searchDocflowAssignmentAssignees(
  query = '',
  limit = 20,
): Promise<DocflowAssignmentSearchResult<DocflowAssignmentAssignee>> {
  const { data } = await apiClient.get('/docflow/assignments/assignees', {
    params: { q: text(query, 200), limit: Math.min(50, Math.max(1, Math.trunc(limit))) },
    ...noStore,
  });
  return normalizeAssignmentSearchResult(data, normalizeAssignmentAssignee);
}

export async function createDocflowAssignment(
  payload: DocflowAssignmentCreatePayload,
  idempotencyKey: string,
): Promise<DocflowAssignmentCommand> {
  const title = text(payload.title, 200);
  const description = text(payload.description, 2_000);
  const key = text(idempotencyKey, 128);
  if (!payload.document_ref || !payload.assignee_ref || !payload.due_at || !title || !description || key.length < 8) {
    throw new Error('Заполните обязательные поля поручения 1С');
  }
  const { data } = await apiClient.post('/docflow/assignments', {
    document_type: payload.document_type,
    document_ref: text(payload.document_ref, 128),
    assignee_ref: text(payload.assignee_ref, 128),
    controller_ref: nullableText(payload.controller_ref, 128),
    due_at: text(payload.due_at, 128),
    importance: payload.importance === 'high' ? 'high' : 'normal',
    title,
    description,
  }, {
    headers: { 'Idempotency-Key': key },
    timeout: DOCFLOW_QUERY_TIMEOUT_MS,
  });
  return normalizeAssignmentCommand(data);
}

export async function getDocflowAssignmentCommand(commandId: string): Promise<DocflowAssignmentCommand> {
  const id = text(commandId, 128);
  if (!id) throw new Error('Не выбрана команда создания поручения 1С');
  const { data } = await apiClient.get(`/docflow/assignments/commands/${encodeURIComponent(id)}`, noStore);
  return normalizeAssignmentCommand(data);
}
