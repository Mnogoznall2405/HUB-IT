/**
 * Composed auth API facade.
 */

import { authAccountSecurityAPI } from './authAccountSecurity';
import { authPasskeyLoginAPI } from './authPasskeyLogin';
import { authPasswordLoginAPI } from './authPasswordLogin';
import { authSessionsAPI } from './authSessions';
import { authTrustedDevicesAPI } from './authTrustedDevices';
import { authUserAdminAPI } from './authUserAdmin';
import apiClient, { refreshAuthSession } from './http';

/**
 * Auth API methods
 */
export const authAPI = {
  get getLoginMode() {
    return authPasskeyLoginAPI.getLoginMode;
  },

  get login() {
    return authPasswordLoginAPI.login;
  },

  get startTwoFactorSetup() {
    return authPasswordLoginAPI.startTwoFactorSetup;
  },

  get verifyTwoFactorSetup() {
    return authPasswordLoginAPI.verifyTwoFactorSetup;
  },

  get verifyTwoFactorLogin() {
    return authPasswordLoginAPI.verifyTwoFactorLogin;
  },

  refresh: async () => {
    const response = await refreshAuthSession();
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('auth-token-refreshed'));
    }
    return response.data;
  },

  get regenerateBackupCodes() {
    return authAccountSecurityAPI.regenerateBackupCodes;
  },

  get getTrustedDevices() {
    return authTrustedDevicesAPI.getTrustedDevices;
  },

  get revokeTrustedDevice() {
    return authTrustedDevicesAPI.revokeTrustedDevice;
  },

  get getTrustedDeviceRegistrationOptions() {
    return authTrustedDevicesAPI.getTrustedDeviceRegistrationOptions;
  },

  get verifyTrustedDeviceRegistration() {
    return authTrustedDevicesAPI.verifyTrustedDeviceRegistration;
  },

  get getTrustedDeviceAuthOptions() {
    return authTrustedDevicesAPI.getTrustedDeviceAuthOptions;
  },

  get verifyTrustedDeviceAuth() {
    return authTrustedDevicesAPI.verifyTrustedDeviceAuth;
  },

  get getPasskeyLoginOptions() {
    return authPasskeyLoginAPI.getPasskeyLoginOptions;
  },

  get verifyPasskeyLogin() {
    return authPasskeyLoginAPI.verifyPasskeyLogin;
  },

  adminResetTwoFactor: async (userId) => {
    const response = await apiClient.post(`/auth/users/${encodeURIComponent(userId)}/reset-2fa`);
    return response.data;
  },

  get resetOwnTwoFactor() {
    return authAccountSecurityAPI.resetOwnTwoFactor;
  },

  get logout() {
    return authAccountSecurityAPI.logout;
  },

  get getCurrentUser() {
    return authAccountSecurityAPI.getCurrentUser;
  },

  get completeAboutOnboarding() {
    return authAccountSecurityAPI.completeAboutOnboarding;
  },

  changePassword: async (oldPassword, newPassword) => {
    const response = await apiClient.post('/auth/change-password', {
      old_password: oldPassword,
      new_password: newPassword,
    });
    return response.data;
  },

  uploadAvatar: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post('/auth/me/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  deleteAvatar: async () => {
    const response = await apiClient.delete('/auth/me/avatar');
    return response.data;
  },

  get getSessions() {
    return authSessionsAPI.getSessions;
  },

  get terminateSession() {
    return authSessionsAPI.terminateSession;
  },

  get cleanupSessions() {
    return authSessionsAPI.cleanupSessions;
  },

  get purgeInactiveSessions() {
    return authSessionsAPI.purgeInactiveSessions;
  },

  get normalizeSessionLimit() {
    return authSessionsAPI.normalizeSessionLimit;
  },

  get getUsers() {
    return authUserAdminAPI.getUsers;
  },

  get createUser() {
    return authUserAdminAPI.createUser;
  },

  get updateUser() {
    return authUserAdminAPI.updateUser;
  },

  get getTaskDelegates() {
    return authUserAdminAPI.getTaskDelegates;
  },

  get getTaskDelegatesBulk() {
    return authUserAdminAPI.getTaskDelegatesBulk;
  },

  get updateTaskDelegates() {
    return authUserAdminAPI.updateTaskDelegates;
  },

  get deleteUser() {
    return authUserAdminAPI.deleteUser;
  },

  syncAD: async () => {
    const response = await apiClient.post('/auth/sync-ad');
    return response.data;
  },
};
