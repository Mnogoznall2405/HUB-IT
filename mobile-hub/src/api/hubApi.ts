import apiClient from './client';

export type HubDashboard = {
  tasks_open?: number;
  tasks_overdue?: number;
  tickets_open?: number;
  notifications_unread?: number;
  [key: string]: unknown;
};

export async function getHubDashboard(): Promise<HubDashboard> {
  const { data } = await apiClient.get<HubDashboard>('/hub/dashboard');
  return data;
}

export type HubTask = {
  id: string;
  title?: string;
  status?: string;
  due_at?: string | null;
  priority?: string | null;
};

export async function getHubTasks(params?: { limit?: number }): Promise<HubTask[]> {
  const { data } = await apiClient.get<{ items?: HubTask[] } | HubTask[]>('/hub/tasks', {
    params: { limit: params?.limit ?? 30 },
  });
  if (Array.isArray(data)) return data;
  return data.items || [];
}
