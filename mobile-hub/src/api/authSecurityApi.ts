import apiClient from './client';

export type TrustedDevice = {
  id: string;
  label?: string | null;
  created_at?: string | null;
  last_used_at?: string | null;
  is_active?: boolean;
  is_current_device?: boolean;
};

function asDevices(data: unknown): TrustedDevice[] {
  if (Array.isArray(data)) return data as TrustedDevice[];
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: TrustedDevice[] }).items;
  }
  return [];
}

export async function listTrustedDevices(): Promise<TrustedDevice[]> {
  const { data } = await apiClient.get('/auth/trusted-devices');
  return asDevices(data);
}

export async function revokeTrustedDevice(deviceId: string): Promise<void> {
  await apiClient.delete(`/auth/trusted-devices/${encodeURIComponent(deviceId)}`);
}

export async function regenerateBackupCodes(): Promise<string[]> {
  const { data } = await apiClient.post<{ backup_codes?: unknown }>('/auth/backup-codes/regenerate');
  return Array.isArray(data?.backup_codes)
    ? data.backup_codes.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

export async function resetOwnTwoFactor(): Promise<void> {
  await apiClient.post('/auth/reset-2fa-self');
}
