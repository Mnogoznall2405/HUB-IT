import apiClient from './http';

export const windowsSsoAPI = {
  getAuthorizeUrl: async () =>
    (await apiClient.get('/auth/sso/begin', { params: { mode: 'json' } })).data.authorize_url,
};
