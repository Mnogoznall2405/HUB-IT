import apiClient from './client';

export type DepartmentRecord = {
  id: string | number;
  name?: string | null;
  members_count?: number;
  managers_count?: number;
  member_count?: number;
  manager_count?: number;
};

export type DepartmentMember = {
  user_id: number;
  role?: string | null;
  is_active?: boolean;
  user?: {
    id?: number;
    username?: string | null;
    full_name?: string | null;
    job_title?: string | null;
  } | null;
};

function asItems<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}

export async function listDepartments(): Promise<DepartmentRecord[]> {
  const { data } = await apiClient.get('/departments');
  return asItems<DepartmentRecord>(data).map((item) => ({
    ...item,
    members_count: item.members_count ?? item.member_count,
    managers_count: item.managers_count ?? item.manager_count,
  }));
}

export async function getDepartmentMembers(departmentId: string | number): Promise<DepartmentMember[]> {
  const { data } = await apiClient.get(`/departments/${encodeURIComponent(String(departmentId))}/members`);
  return asItems<DepartmentMember>(data);
}

export async function setDepartmentManagers(
  departmentId: string | number,
  managerUserIds: number[],
): Promise<void> {
  await apiClient.put(`/departments/${encodeURIComponent(String(departmentId))}/managers`, {
    manager_user_ids: managerUserIds,
  });
}

export async function syncDepartmentsFromUsers(): Promise<void> {
  await apiClient.post('/departments/sync-from-users');
}

export async function syncDepartmentsFromAd(): Promise<void> {
  await apiClient.post('/departments/sync-from-ad');
}
