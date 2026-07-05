export const getFileIdentity = (file) => (
  `${String(file?.name || '')}:${Number(file?.size || 0)}:${Number(file?.lastModified || 0)}`
);

export const getCreatedTaskItems = (response) => {
  if (Array.isArray(response?.items)) return response.items;
  if (response?.id) return [response];
  return [];
};
