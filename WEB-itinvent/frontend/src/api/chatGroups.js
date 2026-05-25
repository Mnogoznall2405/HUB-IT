import apiClient from './client';

export const chatGroupsAPI = {
  createGroupConversation: async (payload) => {
    const response = await apiClient.post('/chat/conversations/group', payload);
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

  transferGroupOwnership: async (conversationId, ownerUserId) => {
    const response = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/ownership`, {
      owner_user_id: ownerUserId,
    });
    return response.data;
  },

  leaveGroup: async (conversationId) => {
    const response = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/leave`);
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
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return response.data;
  },
};

export default chatGroupsAPI;
