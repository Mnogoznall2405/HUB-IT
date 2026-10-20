import apiClient from './client';

// Cross-database equipment transfer between ITINVENT databases.
// Dictionary lookups (owners/branches/locations) point at the *target* DB via
// an explicit X-Database-ID header — the request interceptor must not
// overwrite it with the user's currently selected database.
const targetDbHeaders = (dbId) => ({ 'X-Database-ID': String(dbId || '').trim() });

export const equipmentDbTransferAPI = {
  transferToDb: async (payload) => {
    const response = await apiClient.post('/equipment/transfer/to-db', payload, { timeout: 180_000 });
    return response.data;
  },

  downloadAct: async (dbId, fileNo) => apiClient.get(
    `/equipment/transfer/to-db/${encodeURIComponent(dbId)}/files/${fileNo}`,
    { responseType: 'blob' },
  ),

  emailAct: async (dbId, fileNo, recipientEmail) => {
    const response = await apiClient.post(
      `/equipment/transfer/to-db/${encodeURIComponent(dbId)}/files/${fileNo}/email`,
      { recipient_email: recipientEmail },
    );
    return response.data;
  },

  searchTargetOwners: async (dbId, query, limit = 30) => {
    const response = await apiClient.get('/equipment/owners/search', {
      params: { q: query, limit },
      headers: targetDbHeaders(dbId),
    });
    return response.data;
  },

  getTargetBranches: async (dbId) => {
    const response = await apiClient.get('/equipment/branches', {
      headers: targetDbHeaders(dbId),
    });
    return response.data;
  },

  getTargetLocations: async (dbId, branchNo) => {
    const normalizedBranchNo = branchNo === undefined || branchNo === null || String(branchNo).trim() === ''
      ? undefined
      : branchNo;
    const response = await apiClient.get('/equipment/locations', {
      params: normalizedBranchNo !== undefined ? { branch_no: normalizedBranchNo } : {},
      headers: targetDbHeaders(dbId),
    });
    return response.data;
  },
};

export default equipmentDbTransferAPI;
