import apiClient from './client';

export const companyStructureAPI = {
  getTree: async ({ includeInactive = false } = {}) => {
    const { data } = await apiClient.get('/company-structure/tree', {
      params: { include_inactive: includeInactive },
    });
    return data;
  },
  createNode: async (payload) => {
    const { data } = await apiClient.post('/company-structure/nodes', payload);
    return data;
  },
  updateNode: async (nodeId, payload) => {
    const { data } = await apiClient.patch(
      `/company-structure/nodes/${encodeURIComponent(nodeId)}`,
      payload,
    );
    return data;
  },
  moveNode: async (nodeId, { parentId = null, position }) => {
    const { data } = await apiClient.put(
      `/company-structure/nodes/${encodeURIComponent(nodeId)}/position`,
      { parent_id: parentId, position },
    );
    return data;
  },
  setParent: async (nodeId, payload) => {
    const { data } = await apiClient.put(
      `/company-structure/nodes/${encodeURIComponent(nodeId)}/parent`,
      payload,
    );
    return data;
  },
  setDepartmentCodes: async (nodeId, departmentCodes) => {
    const { data } = await apiClient.put(
      `/company-structure/nodes/${encodeURIComponent(nodeId)}/department-codes`,
      { department_codes: departmentCodes },
    );
    return data;
  },
  deleteNode: async (nodeId, { force = false } = {}) => {
    const { data } = await apiClient.delete(
      `/company-structure/nodes/${encodeURIComponent(nodeId)}`,
      { params: { force } },
    );
    return data;
  },
  getNodePeople: async (nodeId, { limit = 500 } = {}) => {
    const { data } = await apiClient.get(
      `/company-structure/nodes/${encodeURIComponent(nodeId)}/people`,
      { params: { limit } },
    );
    return data;
  },
  search: async ({ q, limit = 30 }) => {
    const { data } = await apiClient.get('/company-structure/search', {
      params: { q, limit },
    });
    return data;
  },
  importFromZup: async ({ parentId = null, departments }) => {
    const { data } = await apiClient.post('/company-structure/import-from-zup', {
      parent_id: parentId,
      departments,
    });
    return data;
  },
  searchDepartmentCodes: async ({ q = '', limit = 50 } = {}) => {
    const { data } = await apiClient.get('/company-structure/department-codes', {
      params: { q, limit },
    });
    return data;
  },
  searchDepartmentNames: async ({ q = '', limit = 50 } = {}) => {
    const { data } = await apiClient.get('/company-structure/department-names', {
      params: { q, limit },
    });
    return data;
  },
};

export default companyStructureAPI;
