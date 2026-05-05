import apiClient from './client';

export const authPasswordLoginAPI = {
  login: async (username, password) => {
    const response = await apiClient.post('/auth/login', { username, password }, { suppressAuthRequired: true });
    return response.data;
  },

  startTwoFactorSetup: async (loginChallengeId) => {
    const response = await apiClient.post('/auth/enable-2fa', {
      login_challenge_id: loginChallengeId,
    }, { suppressAuthRequired: true });
    return response.data;
  },

  verifyTwoFactorSetup: async (loginChallengeId, totpCode) => {
    const response = await apiClient.post('/auth/verify-2fa', {
      login_challenge_id: loginChallengeId,
      totp_code: totpCode,
    }, { suppressAuthRequired: true });
    return response.data;
  },

  verifyTwoFactorLogin: async (loginChallengeId, payload = {}) => {
    const response = await apiClient.post('/auth/verify-2fa-login', {
      login_challenge_id: loginChallengeId,
      totp_code: payload?.totp_code || undefined,
      backup_code: payload?.backup_code || undefined,
    }, { suppressAuthRequired: true });
    return response.data;
  },
};

export default authPasswordLoginAPI;
