import apiClient from './client';

export type OwnDevice = {
  id: string;
  label: string;
  is_current: boolean;
  biometric_enabled: boolean;
  last_seen_at: string | null;
  sessions: {
    session_id: string;
    created_at: string;
    last_seen_at: string;
    ip_address: string;
    device_label: string;
    is_current: boolean;
  }[];
};

export type DeviceActionResult = {
  success: boolean;
  closed_sessions: number;
  revoked_biometric_credentials: number;
  current_session_closed: boolean;
};

export async function listOwnDevices(): Promise<OwnDevice[]> {
  return (await apiClient.get('/auth/my-devices')).data;
}

export async function removeOwnDevice(id: string): Promise<DeviceActionResult> {
  return (await apiClient.delete(`/auth/my-devices/${encodeURIComponent(id)}`)).data;
}

export async function terminateOwnSession(id: string): Promise<DeviceActionResult> {
  return (await apiClient.delete(`/auth/my-devices/sessions/${encodeURIComponent(id)}`)).data;
}

export async function terminateOtherDevices(): Promise<DeviceActionResult> {
  return (await apiClient.post('/auth/my-devices/terminate-others')).data;
}
