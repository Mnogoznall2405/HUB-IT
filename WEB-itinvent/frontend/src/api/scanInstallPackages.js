import apiClient from './http';

export const scanInstallPackagesAPI = {
  getPackages: async (options = {}) => {
    const response = await apiClient.get('/scan/install-packages', { signal: options?.signal });
    return response.data;
  },

  getDeployment: async (packageId, options = {}) => {
    const response = await apiClient.get(
      `/scan/install-packages/${encodeURIComponent(packageId)}/deployment`,
      { signal: options?.signal },
    );
    return response.data;
  },
};

export default scanInstallPackagesAPI;
