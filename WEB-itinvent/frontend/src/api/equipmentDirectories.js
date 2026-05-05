import apiClient from './client';

export const equipmentDirectoriesAPI = {
  getBranches: async () => {
    const response = await apiClient.get('/equipment/branches');
    return response.data;
  },

  getBranchesList: async () => {
    const response = await apiClient.get('/equipment/branches-list');
    return response.data;
  },

  getLocations: async (branchNo) => {
    const normalizedBranchNo = branchNo === undefined || branchNo === null || String(branchNo).trim() === ''
      ? undefined
      : branchNo;
    const response = await apiClient.get('/equipment/locations', {
      params: normalizedBranchNo !== undefined ? { branch_no: normalizedBranchNo } : {},
    });
    return response.data;
  },

  getTypes: async () => {
    const response = await apiClient.get('/equipment/types');
    return response.data;
  },

  getModels: async (typeNo, ciType = 1) => {
    const response = await apiClient.get('/equipment/models', {
      params: { type_no: typeNo, ci_type: ciType },
    });
    return response.data;
  },

  getStatuses: async () => {
    const response = await apiClient.get('/equipment/statuses');
    return response.data;
  },

  searchOwners: async (query, limit = 20) => {
    const response = await apiClient.get('/equipment/owners/search', {
      params: { q: query, limit },
    });
    return response.data;
  },

  getOwnerDepartments: async (limit = 500) => {
    const response = await apiClient.get('/equipment/owners/departments', {
      params: { limit },
    });
    return response.data;
  },
};

export default equipmentDirectoriesAPI;
