import apiClient, { API_V1_BASE } from './client';

const callPath = (callId, action) => `/chat/calls/${encodeURIComponent(callId)}/${action}`;

export const chatCallsAPI = {
  getConfig: async () => {
    const response = await apiClient.get('/chat/calls/config');
    return response.data;
  },

  startCall: async (conversationId, media) => {
    const response = await apiClient.post(
      `/chat/conversations/${encodeURIComponent(conversationId)}/calls`,
      { media: media === 'video' ? 'video' : 'audio' },
    );
    return response.data;
  },

  joinCall: async (callId) => {
    const response = await apiClient.post(callPath(callId, 'join'));
    return response.data;
  },

  declineCall: async (callId) => {
    const response = await apiClient.post(callPath(callId, 'decline'));
    return response.data;
  },

  leaveCall: async (callId) => {
    const response = await apiClient.post(callPath(callId, 'leave'));
    return response.data;
  },

  getActiveCall: async (conversationId) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}/calls/active`,
    );
    return response.data;
  },
};

// Best effort: on tab close axios requests are cancelled, a keepalive fetch
// survives page unload. The session lives in an httpOnly cookie, so
// `credentials: include` is enough; the result is intentionally ignored.
export function leaveCallOnUnload(callId) {
  const id = String(callId || '').trim();
  if (!id || typeof globalThis.fetch !== 'function') return false;
  try {
    void globalThis.fetch(`${API_V1_BASE}${callPath(id, 'leave')}`, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export default chatCallsAPI;
