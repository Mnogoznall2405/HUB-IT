import apiClient from './client';

export const chatGroupsAPI = {
  createGroupConversation: async (payload) => {
    const response = await apiClient.post('/chat/conversations/group', payload);
    return response.data;
  },

  getGroupActivity: async (conversationId, params = {}) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}/activity`,
      { params },
    );
    return response.data;
  },

  addGroupMembers: async (conversationId, memberUserIds) => {
    const response = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/members`, {
      member_user_ids: Array.isArray(memberUserIds) ? memberUserIds : [],
    });
    return response.data;
  },

  removeGroupMember: async (conversationId, userId) => {
    const response = await apiClient.delete(
      `/chat/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`,
    );
    return response.data;
  },

  updateGroupMemberRole: async (conversationId, userId, memberRole) => {
    const response = await apiClient.patch(
      `/chat/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}/role`,
      { member_role: memberRole },
    );
    return response.data;
  },

  // `durationSeconds` is 3600 / 86400 / 604800; omitted restricts until the restriction is lifted.
  restrictGroupMember: async (conversationId, userId, durationSeconds = null) => {
    const response = await apiClient.put(
      `/chat/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}/restriction`,
      { duration_seconds: durationSeconds || null },
    );
    return response.data;
  },

  liftGroupMemberRestriction: async (conversationId, userId) => {
    const response = await apiClient.delete(
      `/chat/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}/restriction`,
    );
    return response.data;
  },

  transferGroupOwnership: async (conversationId, ownerUserId) => {
    const response = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/ownership`, {
      owner_user_id: ownerUserId,
    });
    return response.data;
  },

  // An owner passes `successorUserId`: ownership moves to that member and the owner leaves.
  leaveGroup: async (conversationId, { successorUserId } = {}) => {
    const url = `/chat/conversations/${encodeURIComponent(conversationId)}/leave`;
    const response = successorUserId
      ? await apiClient.post(url, { successor_user_id: Number(successorUserId) })
      : await apiClient.post(url);
    return response.data;
  },

  // The token is returned only when the link is created; a new link revokes the previous one.
  createGroupInvite: async (conversationId) => {
    const response = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/invite-link`);
    return response.data;
  },

  revokeGroupInvites: async (conversationId) => {
    const response = await apiClient.delete(`/chat/conversations/${encodeURIComponent(conversationId)}/invite-link`);
    return response.data;
  },

  previewGroupInvite: async (token) => {
    const response = await apiClient.get(`/chat/invite-links/${encodeURIComponent(token)}`);
    return response.data;
  },

  joinGroupByInvite: async (token) => {
    const response = await apiClient.post(`/chat/invite-links/${encodeURIComponent(token)}/join`);
    return response.data;
  },

  updateGroupProfile: async (conversationId, payload) => {
    const response = await apiClient.patch(
      `/chat/conversations/${encodeURIComponent(conversationId)}/profile`,
      payload,
    );
    return response.data;
  },

  uploadGroupAvatar: async (conversationId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post(
      `/chat/conversations/${encodeURIComponent(conversationId)}/avatar`,
      formData,
    );
    return response.data;
  },

  deleteGroupAvatar: async (conversationId) => {
    const response = await apiClient.delete(
      `/chat/conversations/${encodeURIComponent(conversationId)}/avatar`,
    );
    return response.data;
  },
};

export default chatGroupsAPI;
