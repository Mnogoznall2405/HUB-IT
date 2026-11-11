import apiClient from './client';

export const fsEgressAPI = {
  listEvents({ computerName = '', channel = '', limit = 100, offset = 0, group = 0, includeNoise = 0 } = {}) {
    return apiClient.get('/inventory/fs-egress', {
      params: {
        computer_name: computerName,
        channel,
        limit,
        offset,
        group,
        include_noise: includeNoise,
      },
    });
  },
  listDlpHosts({ category = '' } = {}) {
    return apiClient.get('/inventory/dlp/hosts', { params: { category } });
  },
  getDlpSummary() {
    return apiClient.get('/inventory/dlp/summary');
  },
  getDlpAttention(day = '') {
    return apiClient.get('/inventory/dlp/attention', { params: { day } });
  },
  getDlpActivity(computerName, day = '') {
    return apiClient.get('/inventory/dlp/activity', {
      params: { computer_name: computerName, day },
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
  listBrowserHosts() {
    return apiClient.get('/inventory/browser-probe/hosts');
  },
  listBrowserDays(computerName, source = '') {
    return apiClient.get('/inventory/browser-probe/days', {
      params: { computer_name: computerName, source },
    });
  },
  listBrowserVisits({
    computerName = '',
    category = '',
    day = '',
    source = '',
    q = '',
    limit = 200,
    offset = 0,
    merge = 0,
  } = {}) {
    return apiClient.get('/inventory/browser-probe', {
      params: {
        computer_name: computerName,
        category,
        day,
        source,
        q,
        limit,
        offset,
        merge,
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
