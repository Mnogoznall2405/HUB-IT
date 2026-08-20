import apiClient from './client';
import { normalizeMailboxId, withMailboxQuery } from './mailMailboxQuery';

const withSignal = (config, signal) => (signal ? { ...config, signal } : config);

export const mailFoldersAPI = {
  getFolderSummary: async (params = {}, options = {}) => {
    const response = await apiClient.get('/mail/folders/summary', withSignal({
      params: withMailboxQuery(params),
    }, options?.signal));
    return response.data;
  },

  getFolderTree: async (params = {}, options = {}) => {
    const response = await apiClient.get('/mail/folders/tree', withSignal({
      params: withMailboxQuery(params),
    }, options?.signal));
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
