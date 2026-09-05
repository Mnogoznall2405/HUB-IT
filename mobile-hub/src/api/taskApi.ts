import apiClient from './client';

export type TaskCapabilities = {
  can_edit?: boolean;
  can_start?: boolean;
  can_submit?: boolean;
  can_review?: boolean;
  can_close?: boolean;
  can_reopen?: boolean;
  can_upload_files?: boolean;
  can_update_checklist?: boolean;
  can_open_discussion?: boolean;
};

export type TaskChecklistItem = {
  id: string;
  text: string;
  done: boolean;
};

export type TaskAttachment = {
  id: string;
  file_name: string;
  file_mime?: string | null;
  file_size?: number | null;
  uploaded_by_username?: string | null;
  uploaded_at?: string | null;
};

export type TaskUploadFile = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
};

export type HubTask = {
  id: string;
  title?: string;
  description?: string | null;
  status?: string;
  due_at?: string | null;
  priority?: string | null;
  protocol_date?: string | null;
  is_overdue?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  assignee_full_name?: string | null;
  assignee_username?: string | null;
  controller_full_name?: string | null;
  controller_username?: string | null;
  created_by_user_id?: number | null;
  created_by_full_name?: string | null;
  created_by_username?: string | null;
  assignee_user_id?: number | null;
  assignee_user_ids?: number[];
  assignees?: Array<{
    user_id: number;
    username?: string | null;
    full_name?: string | null;
  }>;
  controller_user_id?: number | null;
  project_id?: string | null;
  project_name?: string | null;
  object_id?: string | null;
  object_name?: string | null;
  department_id?: string | null;
  visibility_scope?: string | null;
  observer_user_ids?: number[];
  email_deadline_remind_hours?: number | null;
  attachments?: TaskAttachment[];
  checklist_items?: TaskChecklistItem[];
  comments_count?: number;
  has_unread_comments?: boolean;
  capabilities?: TaskCapabilities;
  [key: string]: unknown;
};

export type TaskComment = {
  id: string;
  task_id?: string;
  user_id?: number;
  username?: string | null;
  full_name?: string | null;
  body: string;
  created_at?: string | null;
};

export type TaskStatusLog = {
  id?: string | null;
  task_id?: string | null;
  old_status?: string | null;
  new_status?: string | null;
  changed_by_user_id?: number | null;
  changed_by_username?: string | null;
  changed_at?: string | null;
};

export type TaskListParams = {
  q?: string;
  status?: string;
  focus_mode?: 'review' | 'overdue' | 'comments' | '';
  scope?: 'my' | 'department' | 'all';
  role_scope?: 'assignee' | 'creator' | 'controller' | 'both';
  assignee_user_id?: number;
  controller_user_id?: number;
  department_id?: string;
  has_attachments?: boolean;
  due_state?: 'overdue' | 'today' | 'upcoming' | 'none' | '';
  unread_comments_only?: boolean;
  sort_by?: 'status' | 'updated_at' | 'due_at';
  sort_dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

export type TaskListPage = {
  items: HubTask[];
  total: number;
  limit: number;
  offset: number;
};

export type TaskAnalyticsDateBasis = 'protocol_date' | 'completed_at' | 'due_at';

export type TaskAnalyticsMetrics = {
  total: number;
  new: number;
  in_progress: number;
  review: number;
  done: number;
  open: number;
  done_on_time: number;
  done_without_due: number;
  overdue: number;
  with_due_total: number;
  completion_percent: number;
  completion_on_time_percent: number;
};

export type TaskAnalyticsGroup = TaskAnalyticsMetrics & {
  participant_user_id?: number;
  participant_name?: string;
  project_id?: string | null;
  project_name?: string;
  object_id?: string | null;
  object_name?: string;
};

export type TaskAnalyticsTrendItem = {
  bucket_key: string;
  bucket_label: string;
  created: number;
  completed: number;
  completed_on_time: number;
};

export type TaskAnalyticsPayload = {
  summary: TaskAnalyticsMetrics;
  by_participant: TaskAnalyticsGroup[];
  by_project: TaskAnalyticsGroup[];
  by_object: TaskAnalyticsGroup[];
  status_breakdown: Array<{ status: string; label: string; value: number }>;
  trend: { granularity: 'day' | 'week' | 'month' | 'quarter'; items: TaskAnalyticsTrendItem[] };
  truncated: boolean;
  filters?: {
    start_date?: string | null;
    end_date?: string | null;
    date_basis?: TaskAnalyticsDateBasis;
    project_ids?: string[];
    object_ids?: string[];
    participant_user_ids?: number[];
  };
};

export type TaskAnalyticsParams = {
  start_date?: string;
  end_date?: string;
  date_basis?: TaskAnalyticsDateBasis;
  project_ids?: string[];
  object_ids?: string[];
  participant_user_ids?: number[];
};

export type TaskAssignee = {
  id: number;
  username?: string | null;
  full_name?: string | null;
  department?: string | null;
  job_title?: string | null;
};

export type TaskProject = {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  is_active?: boolean;
};

export type TaskObject = {
  id: string;
  project_id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  is_active?: boolean;
};

export type TaskProjectCreatePayload = {
  name: string;
  code?: string;
  description?: string;
  is_active?: boolean;
};

export type TaskObjectCreatePayload = TaskProjectCreatePayload & {
  project_id: string;
};

export type TaskCreatePayload = {
  title: string;
  description?: string;
  assignee_user_ids: number[];
  project_id: string;
  protocol_date: string;
  due_at?: string | null;
  email_deadline_remind_hours?: number;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  observer_user_ids?: number[];
  controller_user_id?: number | null;
  object_id?: string | null;
  department_id?: string | null;
  visibility_scope?: 'private' | 'department' | 'department_managers';
  checklist_items?: TaskChecklistItem[];
};

export type TaskUpdatePayload = Partial<Pick<HubTask,
  | 'title'
  | 'description'
  | 'due_at'
  | 'priority'
  | 'checklist_items'
  | 'assignee_user_id'
  | 'assignee_user_ids'
  | 'controller_user_id'
  | 'observer_user_ids'
  | 'project_id'
  | 'object_id'
  | 'department_id'
  | 'visibility_scope'
  | 'protocol_date'
  | 'email_deadline_remind_hours'
>>;

export type TaskDiscussion = {
  conversation_id?: string | null;
  id?: string | null;
  conversation?: { id?: string | null } | null;
};

function taskPath(taskId: string): string {
  return `/hub/tasks/${encodeURIComponent(taskId)}`;
}

export function taskAnalyticsPath(
  endpoint: '/hub/tasks/analytics' | '/hub/tasks/analytics/export',
  params: TaskAnalyticsParams = {},
): string {
  const query = new URLSearchParams();
  if (params.start_date) query.set('start_date', params.start_date);
  if (params.end_date) query.set('end_date', params.end_date);
  query.set('date_basis', params.date_basis || 'protocol_date');
  (params.project_ids || []).forEach((value) => query.append('project_id', value));
  (params.object_ids || []).forEach((value) => query.append('object_id', value));
  (params.participant_user_ids || []).forEach((value) => query.append('participant_user_id', String(value)));
  return `${endpoint}?${query.toString()}`;
}

export async function getTasksPage(params: TaskListParams = {}): Promise<TaskListPage> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const { data } = await apiClient.get<{
    items?: HubTask[];
    total?: number;
    count?: number;
    limit?: number;
    offset?: number;
  } | HubTask[]>('/hub/tasks', {
    params: {
      scope: params.scope || 'my',
      role_scope: params.role_scope || 'both',
      sort_by: params.sort_by || 'updated_at',
      sort_dir: params.sort_dir || 'desc',
      limit,
      offset,
      ...(params.q ? { q: params.q } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.focus_mode ? { focus_mode: params.focus_mode } : {}),
      ...(params.assignee_user_id ? { assignee_user_id: params.assignee_user_id } : {}),
      ...(params.controller_user_id ? { controller_user_id: params.controller_user_id } : {}),
      ...(params.department_id ? { department_id: params.department_id } : {}),
      ...(params.has_attachments ? { has_attachments: true } : {}),
      ...(params.due_state ? { due_state: params.due_state } : {}),
      ...(params.unread_comments_only ? { unread_comments_only: true } : {}),
    },
  });
  const items = Array.isArray(data) ? data : data.items || [];
  return {
    items,
    total: Array.isArray(data) ? items.length : Number(data.total ?? data.count ?? items.length),
    limit: Array.isArray(data) ? limit : Number(data.limit ?? limit),
    offset: Array.isArray(data) ? offset : Number(data.offset ?? offset),
  };
}

export async function getTasks(params: TaskListParams = {}): Promise<HubTask[]> {
  return (await getTasksPage(params)).items;
}

export async function getTaskAnalytics(params: TaskAnalyticsParams = {}): Promise<TaskAnalyticsPayload> {
  const { data } = await apiClient.get<TaskAnalyticsPayload>(taskAnalyticsPath('/hub/tasks/analytics', params));
  return data;
}

export async function searchTaskAssignees(q = '', limit = 50): Promise<TaskAssignee[]> {
  const { data } = await apiClient.get<{ items?: TaskAssignee[] } | TaskAssignee[]>(
    '/hub/users/assignees',
    { params: { q: String(q || '').trim(), limit } },
  );
  return Array.isArray(data) ? data : data.items || [];
}

export async function searchTaskControllers(q = '', limit = 50): Promise<TaskAssignee[]> {
  const { data } = await apiClient.get<{ items?: TaskAssignee[] } | TaskAssignee[]>(
    '/hub/users/controllers',
    { params: { q: String(q || '').trim(), limit } },
  );
  return Array.isArray(data) ? data : data.items || [];
}

export async function getTaskProjects(options: { includeInactive?: boolean } = {}): Promise<TaskProject[]> {
  const request = options.includeInactive
    ? apiClient.get<{ items?: TaskProject[] } | TaskProject[]>('/hub/task-projects', { params: { include_inactive: true } })
    : apiClient.get<{ items?: TaskProject[] } | TaskProject[]>('/hub/task-projects');
  const { data } = await request;
  const items = Array.isArray(data) ? data : data.items || [];
  return options.includeInactive ? items : items.filter((item) => item.is_active !== false);
}

export async function getTaskObjects(options: { includeInactive?: boolean; projectIds?: string[] } = {}): Promise<TaskObject[]> {
  const query = new URLSearchParams();
  if (options.includeInactive) query.set('include_inactive', 'true');
  (options.projectIds || []).forEach((projectId) => query.append('project_id', projectId));
  const suffix = query.toString();
  const { data } = await apiClient.get<{ items?: TaskObject[] } | TaskObject[]>(`/hub/task-objects${suffix ? `?${suffix}` : ''}`);
  const items = Array.isArray(data) ? data : data.items || [];
  return options.includeInactive ? items : items.filter((item) => item.is_active !== false);
}

export async function createTaskProject(payload: TaskProjectCreatePayload): Promise<TaskProject> {
  const { data } = await apiClient.post<TaskProject>('/hub/task-projects', payload);
  return data;
}

export async function createTaskObject(payload: TaskObjectCreatePayload): Promise<TaskObject> {
  const { data } = await apiClient.post<TaskObject>('/hub/task-objects', payload);
  return data;
}

export async function updateTaskProject(
  projectId: string,
  payload: Partial<TaskProjectCreatePayload>,
): Promise<TaskProject> {
  const { data } = await apiClient.patch<TaskProject>(
    `/hub/task-projects/${encodeURIComponent(projectId)}`,
    payload,
  );
  return data;
}

export async function updateTaskObject(
  objectId: string,
  payload: Partial<TaskObjectCreatePayload>,
): Promise<TaskObject> {
  const { data } = await apiClient.patch<TaskObject>(
    `/hub/task-objects/${encodeURIComponent(objectId)}`,
    payload,
  );
  return data;
}

export async function createTask(payload: TaskCreatePayload): Promise<HubTask[]> {
  const { data } = await apiClient.post<{ items?: HubTask[]; created?: number } | HubTask>(
    '/hub/tasks',
    payload,
  );
  if (data && typeof data === 'object' && 'items' in data && Array.isArray(data.items)) {
    return data.items;
  }
  return data && typeof data === 'object' && 'id' in data ? [data as HubTask] : [];
}

export async function getTask(taskId: string): Promise<HubTask> {
  const { data } = await apiClient.get<HubTask>(taskPath(taskId));
  return data;
}

export async function updateTask(taskId: string, payload: TaskUpdatePayload): Promise<HubTask> {
  const { data } = await apiClient.patch<HubTask>(taskPath(taskId), payload);
  return data;
}

export async function deleteTask(taskId: string): Promise<{ ok?: boolean; task_id?: string }> {
  const { data } = await apiClient.delete<{ ok?: boolean; task_id?: string }>(taskPath(taskId));
  return data;
}

export async function startTask(taskId: string): Promise<HubTask> {
  const { data } = await apiClient.post<HubTask>(`${taskPath(taskId)}/start`);
  return data;
}

export async function submitTask(taskId: string, comment: string, file?: TaskUploadFile | null): Promise<HubTask> {
  const formData = new FormData();
  formData.append('comment', comment);
  if (file) {
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType,
    } as unknown as Blob);
  }
  const { data } = await apiClient.post<HubTask>(`${taskPath(taskId)}/submit`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function uploadTaskAttachment(taskId: string, file: TaskUploadFile): Promise<TaskAttachment> {
  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);
  const { data } = await apiClient.post<TaskAttachment>(`${taskPath(taskId)}/attachments`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function reviewTask(
  taskId: string,
  decision: 'approve' | 'reject',
  comment: string,
): Promise<HubTask> {
  const { data } = await apiClient.post<HubTask>(`${taskPath(taskId)}/review`, {
    decision,
    comment,
  });
  return data;
}

export async function completeTask(taskId: string, comment: string): Promise<HubTask> {
  const { data } = await apiClient.post<HubTask>(`${taskPath(taskId)}/complete`, { comment });
  return data;
}

export async function reopenTask(taskId: string): Promise<HubTask> {
  const { data } = await apiClient.post<HubTask>(`${taskPath(taskId)}/reopen`, {});
  return data;
}

export async function getTaskComments(taskId: string): Promise<TaskComment[]> {
  const { data } = await apiClient.get<{ items?: TaskComment[] }>(`${taskPath(taskId)}/comments`);
  return data.items || [];
}

export async function getTaskStatusLog(taskId: string): Promise<TaskStatusLog[]> {
  const { data } = await apiClient.get<{ items?: TaskStatusLog[] }>(`${taskPath(taskId)}/status-log`);
  return Array.isArray(data.items) ? data.items : [];
}

export async function addTaskComment(taskId: string, body: string): Promise<TaskComment> {
  const { data } = await apiClient.post<TaskComment>(`${taskPath(taskId)}/comments`, { body });
  return data;
}

export async function markTaskCommentsSeen(taskId: string): Promise<void> {
  await apiClient.post(`${taskPath(taskId)}/comments/mark-seen`);
}

export async function openTaskDiscussion(taskId: string): Promise<TaskDiscussion> {
  const { data } = await apiClient.post<TaskDiscussion>(`${taskPath(taskId)}/discussion`);
  return data;
}
