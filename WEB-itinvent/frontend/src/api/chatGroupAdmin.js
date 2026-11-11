import apiClient from './client';

// Portal-admin management of group conversations (structure only, never message content).
export const chatGroupAdminAPI = {
  listOwnerlessGroups: async (params = {}) => {
    const response = await apiClient.get('/chat/admin/groups/ownerless', { params });
    return response.data;
  },

  getGroupStructure: async (conversationId) => {
    const response = await apiClient.get(`/chat/admin/groups/${encodeURIComponent(conversationId)}`);
    return response.data;
  },

  listGroupAudit: async (conversationId, params = {}) => {
    const response = await apiClient.get(`/chat/admin/groups/${encodeURIComponent(conversationId)}/audit`, { params });
    return response.data;
  },

  autoAssignOwners: async ({ dryRun = true, limit = 25 } = {}) => {
    const response = await apiClient.post('/chat/admin/groups/auto-owner', { dry_run: dryRun, limit });
    return response.data;
  },

  assignGroupOwner: async (conversationId, ownerUserId) => {
    const response = await apiClient.post(
      `/chat/admin/groups/${encodeURIComponent(conversationId)}/owner`,
      { owner_user_id: Number(ownerUserId) },
    );
    return response.data;
  },

  removeGroupMember: async (conversationId, userId) => {
    const response = await apiClient.delete(
      `/chat/admin/groups/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`,
    );
    return response.data;
  },
};
