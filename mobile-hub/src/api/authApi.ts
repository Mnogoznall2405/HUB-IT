import apiClient, { withMobileAuthHeaders } from './client';
import type { HubUser, LoginResponse } from './types';
import * as tokenStore from '../auth/tokenStore';

export async function login(username: string, password: string): Promise<LoginResponse> {
  const clientDeviceId = await tokenStore.getClientDeviceId();
  const { data } = await apiClient.post<LoginResponse>(
    '/auth/login',
    { username, password },
    { headers: withMobileAuthHeaders(clientDeviceId) },
  );
  return data;
}

export async function verifyTwoFactorLogin(
  loginChallengeId: string,
  payload: { totp_code?: string; backup_code?: string },
): Promise<LoginResponse> {
  const clientDeviceId = await tokenStore.getClientDeviceId();
  const { data } = await apiClient.post<LoginResponse>(
    '/auth/verify-2fa-login',
    { login_challenge_id: loginChallengeId, ...payload },
    { headers: withMobileAuthHeaders(clientDeviceId) },
  );
  return data;
}

export async function fetchMe(): Promise<HubUser> {
  const { data } = await apiClient.get<HubUser>('/auth/me');
  return data;
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await apiClient.post('/auth/change-password', {
    old_password: oldPassword,
    new_password: newPassword,
  });
}

export async function logout(refreshToken: string | null): Promise<void> {
  const clientDeviceId = await tokenStore.getClientDeviceId();
  await apiClient.post(
    '/auth/logout',
    refreshToken ? { refresh_token: refreshToken } : {},
    { headers: withMobileAuthHeaders(clientDeviceId) },
  );
}

export async function uploadAvatar(formData: FormData): Promise<HubUser> {
  const { data } = await apiClient.post<HubUser>('/auth/me/avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function deleteAvatar(): Promise<HubUser> {
  const { data } = await apiClient.delete<HubUser>('/auth/me/avatar');
  return data;
}
