import apiClient, { withMobileAuthHeaders } from './client';
import type {
  HubUser,
  LoginResponse,
  MobileBiometricEnrollResponse,
  TwoFactorSetupResponse,
  TwoFactorSetupVerifyResponse,
} from './types';
import * as tokenStore from '../auth/tokenStore';

export async function login(username: string, password: string): Promise<LoginResponse> {
  const clientDeviceId = await tokenStore.getOrCreateClientDeviceId();
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
  const clientDeviceId = await tokenStore.getOrCreateClientDeviceId();
  const { data } = await apiClient.post<LoginResponse>(
    '/auth/verify-2fa-login',
    { login_challenge_id: loginChallengeId, ...payload },
    { headers: withMobileAuthHeaders(clientDeviceId) },
  );
  return data;
}

export async function fetchMe(options: { timeoutMs?: number } = {}): Promise<HubUser> {
  const { data } = await apiClient.get<HubUser>('/auth/me', {
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
  });
  return data;
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await apiClient.post('/auth/change-password', {
    old_password: oldPassword,
    new_password: newPassword,
  });
}

export async function logout(refreshToken: string | null): Promise<void> {
  const clientDeviceId = await tokenStore.getOrCreateClientDeviceId();
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

export async function completeAboutOnboarding(): Promise<HubUser> {
  const { data } = await apiClient.post<HubUser>('/auth/me/about-onboarding/complete');
  return data;
}

export async function startTwoFactorSetup(loginChallengeId: string): Promise<TwoFactorSetupResponse> {
  const clientDeviceId = await tokenStore.getOrCreateClientDeviceId();
  const { data } = await apiClient.post<TwoFactorSetupResponse>(
    '/auth/enable-2fa',
    { login_challenge_id: loginChallengeId },
    { headers: withMobileAuthHeaders(clientDeviceId) },
  );
  return data;
}

export async function verifyTwoFactorSetup(
  loginChallengeId: string,
  totpCode: string,
): Promise<TwoFactorSetupVerifyResponse> {
  const clientDeviceId = await tokenStore.getOrCreateClientDeviceId();
  const { data } = await apiClient.post<TwoFactorSetupVerifyResponse>(
    '/auth/verify-2fa',
    { login_challenge_id: loginChallengeId, totp_code: totpCode },
    { headers: withMobileAuthHeaders(clientDeviceId) },
  );
  return data;
}

export async function enrollMobileBiometricSession(enrollmentCode: string): Promise<string> {
  const clientDeviceId = await tokenStore.getOrCreateClientDeviceId();
  const { data } = await apiClient.post<MobileBiometricEnrollResponse>(
    '/auth/mobile-biometric/enroll',
    { enrollment_code: enrollmentCode },
    { headers: withMobileAuthHeaders(clientDeviceId) },
  );
  const renewalToken = String(data.renewal_token || '').trim();
  if (!renewalToken) throw new Error('Сервер не выдал ключ входа по отпечатку');
  return renewalToken;
}

export async function renewMobileBiometricSession(renewalToken: string): Promise<LoginResponse> {
  const clientDeviceId = await tokenStore.getOrCreateClientDeviceId();
  const { data } = await apiClient.post<LoginResponse>(
    '/auth/mobile-biometric/session',
    { renewal_token: renewalToken },
    { headers: withMobileAuthHeaders(clientDeviceId) },
  );
  return data;
}

export async function revokeMobileBiometricSession(): Promise<void> {
  const clientDeviceId = await tokenStore.getOrCreateClientDeviceId();
  await apiClient.delete('/auth/mobile-biometric', {
    headers: withMobileAuthHeaders(clientDeviceId),
  });
}
