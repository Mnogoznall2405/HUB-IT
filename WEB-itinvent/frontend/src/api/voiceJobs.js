import apiClient from './client';

export const voiceJobsAPI = {
  getOverview: async () => {
    const response = await apiClient.get('/voice/overview');
    return response.data;
  },

  getOptions: async () => {
    const response = await apiClient.get('/voice/options');
    return response.data;
  },

  listJobs: async (params = {}, options = {}) => {
    const response = await apiClient.get('/voice/jobs', { params, signal: options?.signal });
    return response.data;
  },

  getJob: async (jobId, options = {}) => {
    const response = await apiClient.get(`/voice/jobs/${encodeURIComponent(jobId)}`, { signal: options?.signal });
    return response.data;
  },

  getJobLog: async (jobId) => {
    const response = await apiClient.get(`/voice/jobs/${encodeURIComponent(jobId)}/log`);
    return response.data;
  },

  uploadJob: async (file, settings = {}, onProgress) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('settings_json', JSON.stringify(settings || {}));
    const response = await apiClient.post('/voice/jobs', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 10 * 60 * 1000,
      onUploadProgress: onProgress,
    });
    return response.data;
  },

  cancelJob: async (jobId) => {
    const response = await apiClient.post(`/voice/jobs/${encodeURIComponent(jobId)}/cancel`);
    return response.data;
  },

  retryJob: async (jobId) => {
    const response = await apiClient.post(`/voice/jobs/${encodeURIComponent(jobId)}/retry`);
    return response.data;
  },

  deleteJob: async (jobId, deleteFiles = false) => {
    const response = await apiClient.delete(`/voice/jobs/${encodeURIComponent(jobId)}`, {
      params: { delete_files: deleteFiles },
    });
    return response.data;
  },

  listMeetings: async (params = {}, options = {}) => {
    const response = await apiClient.get('/voice/meetings', { params, signal: options?.signal });
    return response.data;
  },

  getMeeting: async (base, options = {}) => {
    const response = await apiClient.get(`/voice/meetings/${encodeURIComponent(base)}`, { signal: options?.signal });
    return response.data;
  },

  deleteMeeting: async (base) => {
    const response = await apiClient.delete(`/voice/meetings/${encodeURIComponent(base)}`);
    return response.data;
  },

  updateMeetingMeta: async (base, payload) => {
    const response = await apiClient.put(`/voice/meetings/${encodeURIComponent(base)}/meta`, payload);
    return response.data;
  },

  createShareLink: async (base, ttlHours) => {
    const response = await apiClient.post(
      `/voice/meetings/${encodeURIComponent(base)}/share`,
      { ttl_hours: ttlHours },
    );
    return response.data;
  },

  revokeShareLink: async (token) => {
    const response = await apiClient.delete(`/voice/share/${encodeURIComponent(token)}`);
    return response.data;
  },

  resolveShareLink: async (token, options = {}) => {
    const response = await apiClient.get(`/voice/share/${encodeURIComponent(token)}`, { signal: options?.signal });
    return response.data;
  },

  exportReportsZip: async ({ dateFrom, dateTo } = {}) => {
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return apiClient.get('/voice/export/reports.zip', { params, responseType: 'blob' });
  },

  getAssignmentStatuses: async (base) => {
    const response = await apiClient.get(`/voice/meetings/${encodeURIComponent(base)}/assignments/status`);
    return response.data;
  },

  // ref: { num, key } — key (стабильный id поручения) переживает пересборку реестра;
  // строка/число — старый вызов только по номеру.
  updateAssignmentStatus: async (base, ref, status, comment = '', { taskId } = {}) => {
    const target = ref && typeof ref === 'object' ? ref : { num: ref };
    const payload = { num: String(target.num), status, comment };
    if (target.key) payload.key = target.key;
    if (taskId !== undefined && taskId !== null && taskId !== '') payload.task_id = String(taskId);
    const response = await apiClient.put(`/voice/meetings/${encodeURIComponent(base)}/assignments/status`, payload);
    return response.data;
  },

  getAssignments: async (base, options = {}) => {
    const response = await apiClient.get(`/voice/meetings/${encodeURIComponent(base)}/assignments`, { signal: options?.signal });
    return response.data;
  },

  getTranscript: async (base, params = {}, options = {}) => {
    const response = await apiClient.get(`/voice/meetings/${encodeURIComponent(base)}/transcript`, {
      params,
      signal: options?.signal,
    });
    return response.data;
  },

  getTopics: async (base, options = {}) => {
    const response = await apiClient.get(`/voice/meetings/${encodeURIComponent(base)}/topics`, {
      signal: options?.signal,
    });
    return response.data;
  },

  assignSpeakers: async (base, assignments, enrollNew = []) => {
    const response = await apiClient.post(
      `/voice/meetings/${encodeURIComponent(base)}/speakers/assign`,
      { assignments, enroll_new: enrollNew },
    );
    return response.data;
  },

  reportUrl: (base, name, download = false) => (
    `/api/v1/voice/meetings/${encodeURIComponent(base)}/reports/${encodeURIComponent(name)}${download ? '?download=1' : ''}`
  ),

  clipUrl: (base, name) => (
    `/api/v1/voice/meetings/${encodeURIComponent(base)}/clips/${encodeURIComponent(name)}`
  ),

  mediaUrl: (base) => `/api/v1/voice/meetings/${encodeURIComponent(base)}/media`,

  speakerSampleUrl: (base, speaker) => (
    `/api/v1/voice/meetings/${encodeURIComponent(base)}/speakers/${encodeURIComponent(speaker)}/sample`
  ),
};

export default voiceJobsAPI;
