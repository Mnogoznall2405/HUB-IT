import apiClient from './client';
import type { HubUser } from './types';

export type AdminUser = HubUser & {
  is_active: boolean;
  auth_source?: string | null;
  telegram_id?: number | string | null;
  assigned_database?: string | null;
  use_custom_permissions?: boolean;
  custom_permissions?: string[];
  email?: string | null;
  mailbox_email?: string | null;
  mailbox_login?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AdminUserWritePayload = {
  username?: string;
  password?: string;
  full_name?: string;
  department?: string;
  job_title?: string;
  email?: string;
  mailbox_email?: string;
  mailbox_login?: string;
  telegram_id?: number | string | null;
  auth_source?: string;
  assigned_database?: string | null;
  role?: string;
  is_active?: boolean;
  use_custom_permissions?: boolean;
  custom_permissions?: string[];
};

export type TaskDelegateLink = {
  owner_user_id: number;
  delegate_user_id: number;
  role_type: 'assistant' | 'deputy';
  is_active: boolean;
  delegate_username?: string | null;
  delegate_full_name?: string | null;
};

export type AdminUserSearchParams = {
  q?: string;
  limit?: number;
  offset?: number;
  status?: 'all' | 'active' | 'inactive';
  role?: 'all' | 'admin' | 'operator' | 'viewer';
  excludeUserId?: number;
  ids?: number[];
};

export type AdminUserSearchResponse = {
  items: AdminUser[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
};

function asUsers(data: unknown): AdminUser[] {
  if (Array.isArray(data)) return data as AdminUser[];
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: AdminUser[] }).items;
  }
  return [];
}

export async function listUsers(): Promise<AdminUser[]> {
  const { data } = await apiClient.get('/auth/users');
  return asUsers(data);
}

export async function searchUsers(params: AdminUserSearchParams = {}): Promise<AdminUserSearchResponse> {
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(params.limit || 50))));
  const offset = Math.max(0, Math.trunc(Number(params.offset || 0)));
  const { data } = await apiClient.get('/auth/users/search', {
    params: {
      q: String(params.q || '').trim(),
      limit,
      offset,
      status: params.status || 'all',
      role: params.role || 'all',
      ...(params.excludeUserId ? { exclude_user_id: params.excludeUserId } : {}),
      ...(params.ids?.length ? { ids: params.ids.join(',') } : {}),
    },
  });
  const items = asUsers(data);
  const total = Math.max(items.length, Number(data?.total || 0));
  return {
    items,
    total,
    limit: Number(data?.limit || limit),
    offset: Number(data?.offset || offset),
    has_more: data?.has_more == null ? offset + items.length < total : Boolean(data.has_more),
  };
}

export async function createUser(payload: AdminUserWritePayload): Promise<AdminUser> {
  const { data } = await apiClient.post<AdminUser>('/auth/users', payload);
  return data;
}

export async function updateUser(userId: number, payload: AdminUserWritePayload): Promise<AdminUser> {
  const { data } = await apiClient.patch<AdminUser>(`/auth/users/${userId}`, payload);
  return data;
}

export async function getTaskDelegates(userId: number): Promise<TaskDelegateLink[]> {
  const { data } = await apiClient.get<TaskDelegateLink[]>(`/auth/users/${userId}/task-delegates`);
  return Array.isArray(data) ? data : [];
}

export async function updateTaskDelegates(
  userId: number,
  items: Array<Pick<TaskDelegateLink, 'delegate_user_id' | 'role_type' | 'is_active'>>,
): Promise<TaskDelegateLink[]> {
  const { data } = await apiClient.put<TaskDelegateLink[]>(`/auth/users/${userId}/task-delegates`, { items });
  return Array.isArray(data) ? data : [];
}
