import apiClient from './client';

export const authPasskeyLoginAPI = {
  getLoginMode: async () => {
    const response = await apiClient.get('/auth/login-mode', { suppressAuthRequired: true });
    return response.data;
  },

  getPasskeyLoginOptions: async () => {
    const response = await apiClient.post('/auth/passkey-login/options', null, { suppressAuthRequired: true });
    return response.data;
  },

  verifyPasskeyLogin: async (challengeId, credential) => {
    const response = await apiClient.post('/auth/passkey-login/verify', {
      challenge_id: challengeId,
      credential,
    }, { suppressAuthRequired: true });
    return response.data;
  },
};

export default authPasskeyLoginAPI;
