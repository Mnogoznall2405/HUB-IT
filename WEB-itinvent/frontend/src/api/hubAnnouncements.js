import apiClient, { API_V1_BASE } from './client';

export const hubAnnouncementsAPI = {
  getAnnouncements: async (params = {}) => {
    const response = await apiClient.get('/hub/announcements', { params });
    return response.data;
  },

  getAnnouncement: async (announcementId) => {
    const response = await apiClient.get(`/hub/announcements/${encodeURIComponent(announcementId)}`);
    return response.data;
  },

  createAnnouncement: async (payload, files = []) => {
    const hasFiles = Array.isArray(files) && files.length > 0;
    if (!hasFiles) {
      const response = await apiClient.post('/hub/announcements', payload);
      return response.data;
    }
    const formData = new FormData();
    formData.append('title', String(payload?.title || ''));
    formData.append('preview', String(payload?.preview || ''));
    formData.append('body', String(payload?.body || ''));
    formData.append('priority', String(payload?.priority || 'normal'));
    formData.append('audience_scope', String(payload?.audience_scope || 'all'));
    formData.append('audience_roles', JSON.stringify(Array.isArray(payload?.audience_roles) ? payload.audience_roles : []));
    formData.append('audience_user_ids', JSON.stringify(Array.isArray(payload?.audience_user_ids) ? payload.audience_user_ids : []));
    formData.append('requires_ack', payload?.requires_ack ? '1' : '0');
    formData.append('is_pinned', payload?.is_pinned ? '1' : '0');
    formData.append('pinned_until', String(payload?.pinned_until || ''));
    formData.append('published_from', String(payload?.published_from || ''));
    formData.append('expires_at', String(payload?.expires_at || ''));
    formData.append('is_active', payload?.is_active === false ? '0' : '1');
    formData.append('status', String(payload?.status || 'published'));
    formData.append('comments_enabled', payload?.comments_enabled === false ? '0' : '1');
    formData.append('reactions_enabled', payload?.reactions_enabled === false ? '0' : '1');
    formData.append('category_id', String(payload?.category_id || ''));
    formData.append('tags', JSON.stringify(Array.isArray(payload?.tags) ? payload.tags : []));
    formData.append('poll', payload?.poll ? JSON.stringify(payload.poll) : '');
    files.forEach((file) => {
      if (file) {
        formData.append('files', file);
      }
    });
    const response = await apiClient.post('/hub/announcements', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  updateAnnouncement: async (announcementId, payload) => {
    const response = await apiClient.patch(`/hub/announcements/${encodeURIComponent(announcementId)}`, payload);
    return response.data;
  },

  deleteAnnouncement: async (announcementId) => {
    const response = await apiClient.delete(`/hub/announcements/${encodeURIComponent(announcementId)}`);
    return response.data;
  },

  markAnnouncementRead: async (announcementId) => {
    const response = await apiClient.post(`/hub/announcements/${encodeURIComponent(announcementId)}/mark-as-read`);
    return response.data;
  },

  acknowledgeAnnouncement: async (announcementId) => {
    const response = await apiClient.post(`/hub/announcements/${encodeURIComponent(announcementId)}/ack`);
    return response.data;
  },

  getAnnouncementReads: async (announcementId) => {
    const response = await apiClient.get(`/hub/announcements/${encodeURIComponent(announcementId)}/reads`);
    return response.data;
  },

  downloadAnnouncementAttachment: async (announcementId, attachmentId) => {
    const response = await apiClient.get(
      `/hub/announcements/${encodeURIComponent(announcementId)}/attachments/${encodeURIComponent(attachmentId)}/file`,
      { responseType: 'blob' },
    );
    return response;
  },

  getAnnouncementRecipients: async () => {
    const response = await apiClient.get('/hub/users/announcement-recipients');
    return response.data;
  },

  createDraft: async (payload = {}) => {
    const response = await apiClient.post('/hub/announcements/drafts', payload);
    return response.data;
  },

  getManagedAnnouncements: async (status, params = {}) => {
    const response = await apiClient.get('/hub/announcements/manage', { params: { ...params, status } });
    return response.data;
  },

  publishAnnouncement: async (announcementId) => {
    const response = await apiClient.post(`/hub/announcements/${encodeURIComponent(announcementId)}/publish`);
    return response.data;
  },

  archiveAnnouncement: async (announcementId) => {
    const response = await apiClient.post(`/hub/announcements/${encodeURIComponent(announcementId)}/archive`);
    return response.data;
  },

  setReaction: async (announcementId, reactionType) => {
    const response = await apiClient.put(`/hub/announcements/${encodeURIComponent(announcementId)}/reaction`, { reaction_type: reactionType });
    return response.data;
  },

  removeReaction: async (announcementId) => {
    const response = await apiClient.delete(`/hub/announcements/${encodeURIComponent(announcementId)}/reaction`);
    return response.data;
  },

  getReactionUsers: async (announcementId, reactionType = '') => {
    const response = await apiClient.get(`/hub/announcements/${encodeURIComponent(announcementId)}/reactions`, { params: { reaction_type: reactionType } });
    return response.data;
  },

  setBookmark: async (announcementId, bookmarked) => {
    const response = await apiClient[bookmarked ? 'put' : 'delete'](`/hub/announcements/${encodeURIComponent(announcementId)}/bookmark`);
    return response.data;
  },

  votePoll: async (announcementId, optionIds = []) => {
    const response = await apiClient.put(`/hub/announcements/${encodeURIComponent(announcementId)}/poll/vote`, {
      option_ids: Array.isArray(optionIds) ? optionIds : [],
    });
    return response.data;
  },

  getAnalytics: async (announcementId) => {
    const response = await apiClient.get(`/hub/announcements/${encodeURIComponent(announcementId)}/analytics`);
    return response.data;
  },

  getCategories: async (params = {}) => {
    const response = await apiClient.get('/hub/announcement-categories', { params });
    return response.data;
  },

  createCategory: async (payload) => {
    const response = await apiClient.post('/hub/announcement-categories', payload);
    return response.data;
  },

  updateCategory: async (categoryId, payload) => {
    const response = await apiClient.patch(`/hub/announcement-categories/${encodeURIComponent(categoryId)}`, payload);
    return response.data;
  },

  deleteCategory: async (categoryId) => {
    const response = await apiClient.delete(`/hub/announcement-categories/${encodeURIComponent(categoryId)}`);
    return response.data;
  },

  getTags: async () => {
    const response = await apiClient.get('/hub/announcement-tags');
    return response.data;
  },

  uploadAttachment: async (announcementId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post(`/hub/announcements/${encodeURIComponent(announcementId)}/attachments`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
    return response.data;
  },

  reorderAttachments: async (announcementId, attachmentIds, coverAttachmentId) => {
    const response = await apiClient.patch(`/hub/announcements/${encodeURIComponent(announcementId)}/attachments/order`, {
      attachment_ids: attachmentIds,
      cover_attachment_id: coverAttachmentId || '',
    });
    return response.data;
  },

  deleteAttachment: async (announcementId, attachmentId) => {
    const response = await apiClient.delete(`/hub/announcements/${encodeURIComponent(announcementId)}/attachments/${encodeURIComponent(attachmentId)}`);
    return response.data;
  },

  likeAnnouncement: async (announcementId) => {
    const response = await apiClient.put(`/hub/announcements/${encodeURIComponent(announcementId)}/like`);
    return response.data;
  },

  unlikeAnnouncement: async (announcementId) => {
    const response = await apiClient.delete(`/hub/announcements/${encodeURIComponent(announcementId)}/like`);
    return response.data;
  },

  getComments: async (announcementId, params = {}) => {
    const response = await apiClient.get(
      `/hub/announcements/${encodeURIComponent(announcementId)}/comments`,
      { params },
    );
    return response.data;
  },

  createComment: async (announcementId, input = {}) => {
    const options = typeof input === 'string' ? { body: input } : (input || {});
    const {
      body = '', parentCommentId = '', mentionedUserIds = [], files = [],
    } = options;
    const hasFiles = Array.isArray(files) && files.length > 0;
    let payload = { body, parent_comment_id: parentCommentId, mentioned_user_ids: mentionedUserIds };
    if (hasFiles) {
      payload = new FormData();
      payload.append('body', body);
      payload.append('parent_comment_id', parentCommentId);
      payload.append('mentioned_user_ids', JSON.stringify(mentionedUserIds));
      files.forEach((file) => payload.append('files', file));
    }
    const response = await apiClient.post(
      `/hub/announcements/${encodeURIComponent(announcementId)}/comments`,
      payload,
      hasFiles ? { headers: { 'Content-Type': 'multipart/form-data' } } : undefined,
    );
    return response.data;
  },

  updateComment: async (announcementId, commentId, body) => {
    const response = await apiClient.patch(
      `/hub/announcements/${encodeURIComponent(announcementId)}/comments/${encodeURIComponent(commentId)}`,
      { body },
    );
    return response.data;
  },

  deleteComment: async (announcementId, commentId) => {
    const response = await apiClient.delete(
      `/hub/announcements/${encodeURIComponent(announcementId)}/comments/${encodeURIComponent(commentId)}`,
    );
    return response.data;
  },

  setCommentReaction: async (announcementId, commentId, reactionType) => {
    const path = `/hub/announcements/${encodeURIComponent(announcementId)}/comments/${encodeURIComponent(commentId)}/reaction`;
    const response = reactionType
      ? await apiClient.put(path, { reaction_type: reactionType })
      : await apiClient.delete(path);
    return response.data;
  },

  buildCommentAttachmentUrl: (announcementId, commentId, attachmentId) => (
    `${String(API_V1_BASE || '/api/v1').replace(/\/$/, '')}/hub/announcements/`
    + `${encodeURIComponent(announcementId)}/comments/${encodeURIComponent(commentId)}/attachments/${encodeURIComponent(attachmentId)}/file`
  ),

  buildAttachmentUrl: (announcementId, attachmentId) => (
    `${String(API_V1_BASE || '/api/v1').replace(/\/$/, '')}/hub/announcements/`
    + `${encodeURIComponent(announcementId)}/attachments/${encodeURIComponent(attachmentId)}/file`
  ),
};

export default hubAnnouncementsAPI;
