import apiClient from './http';

export const workspaceDiscoveryAPI = {
  identifyWorkspace: async () => {
    const response = await apiClient.get('/discovery/identify-workspace');
    return response.data;
  },
};

export default workspaceDiscoveryAPI;
