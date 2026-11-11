import apiClient from './client';

export type AuthSession = {
  session_id: string;
  user_id: number;
  username: string;
  role?: string;
  ip_address?: string;
  user_agent?: string;
  created_at?: string;
  last_seen_at?: string;
  expires_at?: string;
  idle_expires_at?: string;
  status?: string;
  is_active?: boolean;
  device_label?: string | null;
};

export type SessionCleanupResult = {
  deleted?: number;
  deactivated?: number;
  limit?: number;
  users_affected?: number;
  sessions_to_close?: number;
  sessions_closed?: number;
};

function asSessions(data: unknown): AuthSession[] {
  if (Array.isArray(data)) return data as AuthSession[];
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: AuthSession[] }).items;
  }
  return [];
}

export async function listSessions(): Promise<AuthSession[]> {
  const { data } = await apiClient.get('/auth/sessions');
  return asSessions(data);
}

export async function terminateSession(sessionId: string): Promise<void> {
  await apiClient.delete(`/auth/sessions/${encodeURIComponent(sessionId)}`);
}

export async function cleanupSessions(): Promise<SessionCleanupResult> {
  const { data } = await apiClient.post<SessionCleanupResult>('/auth/sessions/cleanup');
  return data || {};
}

export async function purgeInactiveSessions(): Promise<SessionCleanupResult> {
  const { data } = await apiClient.post<SessionCleanupResult>('/auth/sessions/purge-inactive');
  return data || {};
}

export async function normalizeSessionLimit(apply = true): Promise<SessionCleanupResult> {
  const { data } = await apiClient.post<SessionCleanupResult>('/auth/sessions/normalize-limit', {
    apply: Boolean(apply),
  });
  return data || {};
}
