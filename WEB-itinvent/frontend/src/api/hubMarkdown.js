import apiClient from './http';

export const hubMarkdownAPI = {
  transformMarkdown: async ({ text, context }) => {
    const response = await apiClient.post('/hub/markdown/transform', {
      text: String(text || ''),
      context: String(context || ''),
    });
    return response.data;
  },
};

export default hubMarkdownAPI;
