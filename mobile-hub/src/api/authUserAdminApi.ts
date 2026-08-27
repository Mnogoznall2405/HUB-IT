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
