import apiClient from './client';

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
};

export default hubAnnouncementsAPI;
