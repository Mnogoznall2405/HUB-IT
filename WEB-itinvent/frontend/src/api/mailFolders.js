import apiClient from './client';

const normalizeMailboxId = (value) => {
  const normalized = String(value || '').trim();
  return normalized || '';
};

const withMailboxQuery = (params = {}, mailboxId) => {
  const normalizedMailboxId = normalizeMailboxId(mailboxId ?? params?.mailbox_id ?? params?.mailboxId);
  const nextParams = { ...(params || {}) };
  delete nextParams.mailboxId;
  if (normalizedMailboxId) {
    nextParams.mailbox_id = normalizedMailboxId;
  } else {
    delete nextParams.mailbox_id;
  }
  return nextParams;
};

export const mailFoldersAPI = {
  getFolderSummary: async (params = {}) => {
    const response = await apiClient.get('/mail/folders/summary', { params: withMailboxQuery(params) });
    return response.data;
  },

  getFolderTree: async (params = {}) => {
    const response = await apiClient.get('/mail/folders/tree', { params: withMailboxQuery(params) });
    return response.data;
  },

  createFolder: async (payload) => {
    const response = await apiClient.post('/mail/folders', payload);
    return response.data;
  },

  renameFolder: async (folderId, payload = {}, mailboxId = '') => {
    const body = { ...(payload || {}) };
    const resolvedMailboxId = normalizeMailboxId(mailboxId || body?.mailbox_id);
    delete body.mailbox_id;
    const response = await apiClient.patch(
      `/mail/folders/${encodeURIComponent(folderId)}`,
      body,
      { params: withMailboxQuery({}, resolvedMailboxId) },
    );
    return response.data;
  },

  deleteFolder: async (folderId, mailboxId = '') => {
    const response = await apiClient.delete(
      `/mail/folders/${encodeURIComponent(folderId)}`,
      { params: withMailboxQuery({}, mailboxId) },
    );
    return response.data;
  },

  setFolderFavorite: async (folderId, favorite, mailboxId = '') => {
    const response = await apiClient.post(`/mail/folders/${encodeURIComponent(folderId)}/favorite`, {
      favorite,
      mailbox_id: normalizeMailboxId(mailboxId) || undefined,
    });
    return response.data;
  },
};

export default mailFoldersAPI;
