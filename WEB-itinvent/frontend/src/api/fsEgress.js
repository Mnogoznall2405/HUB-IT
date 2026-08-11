import apiClient from './client';

export const fsEgressAPI = {
  listEvents({ computerName = '', channel = '', limit = 100, offset = 0 } = {}) {
    return apiClient.get('/inventory/fs-egress', {
      params: {
        computer_name: computerName,
        channel,
        limit,
        offset,
      },
    });
  },
  listTelegramChats({ computerName = '', limit = 100 } = {}) {
    return apiClient.get('/inventory/telegram-probe', {
      params: { computer_name: computerName, limit },
    });
  },
  getTelegramReport(computerName) {
    return apiClient.get('/inventory/telegram-probe/report', {
      params: { computer_name: computerName },
      responseType: 'text',
    });
  },
  getTelegramMedia(computerName, fileName) {
    const host = encodeURIComponent(String(computerName || '').trim());
    const name = encodeURIComponent(String(fileName || '').replace(/\\/g, '/').split('/').pop() || '');
    return apiClient.get(`/inventory/telegram-probe/media/${host}/${name}`, {
      responseType: 'blob',
    });
  },
  listBrowserVisits({ computerName = '', category = '', limit = 200, offset = 0 } = {}) {
    return apiClient.get('/inventory/browser-probe', {
      params: {
        computer_name: computerName,
        category,
        limit,
        offset,
      },
    });
  },
  getBrowserMedia(computerName, fileName) {
    const host = encodeURIComponent(String(computerName || '').trim());
    const name = encodeURIComponent(String(fileName || '').replace(/\\/g, '/').split('/').pop() || '');
    return apiClient.get(`/inventory/browser-probe/media/${host}/${name}`, {
      responseType: 'blob',
    });
  },
  listMaxChats({ computerName = '', limit = 100 } = {}) {
    return apiClient.get('/inventory/max-probe', {
      params: { computer_name: computerName, limit },
    });
  },
  getMaxMedia(computerName, fileName) {
    const host = encodeURIComponent(String(computerName || '').trim());
    const name = encodeURIComponent(String(fileName || '').replace(/\\/g, '/').split('/').pop() || '');
    return apiClient.get(`/inventory/max-probe/media/${host}/${name}`, {
      responseType: 'blob',
    });
  },
};

export default fsEgressAPI;
