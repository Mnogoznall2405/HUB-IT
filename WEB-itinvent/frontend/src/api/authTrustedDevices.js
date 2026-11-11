import apiClient from './client';

export const authTrustedDevicesAPI = {
  getTrustedDevices: async () => {
    const response = await apiClient.get('/auth/trusted-devices');
    return response.data;
  },

  revokeTrustedDevice: async (deviceId) => {
    const response = await apiClient.delete(`/auth/trusted-devices/${encodeURIComponent(deviceId)}`);
    return response.data;
  },

  getTrustedDeviceRegistrationOptions: async (label, options = {}) => {
    const response = await apiClient.post('/auth/trusted-devices/register/options', {
      label: label || undefined,
      platform_only: Boolean(options?.platformOnly),
    });
    return response.data;
  },

  verifyTrustedDeviceRegistration: async (challengeId, credential, label) => {
    const response = await apiClient.post('/auth/trusted-devices/register/verify', {
      challenge_id: challengeId,
      credential,
      label: label || undefined,
    });
    return response.data;
  },

  getTrustedDeviceAuthOptions: async (loginChallengeId) => {
    const response = await apiClient.post('/auth/trusted-devices/auth/options', {
      login_challenge_id: loginChallengeId,
    }, { suppressAuthRequired: true });
    return response.data;
  },

  verifyTrustedDeviceAuth: async (loginChallengeId, challengeId, credential) => {
    const response = await apiClient.post('/auth/trusted-devices/auth/verify', {
      login_challenge_id: loginChallengeId,
      challenge_id: challengeId,
      credential,
    }, { suppressAuthRequired: true });
    return response.data;
  },
};

export default authTrustedDevicesAPI;
