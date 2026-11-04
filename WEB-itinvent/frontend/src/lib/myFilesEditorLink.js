// The online editor lives on its own page so that it can open in a separate browser tab or Desktop window.
export const buildEditorRoute = (fileId) => `/my-files/edit/${encodeURIComponent(String(fileId || ''))}`;

export const buildEditorUrl = (fileId) => {
  const rawBase = String(import.meta.env.BASE_URL || '/');
  const base = rawBase === './' || rawBase === '.' ? '/' : rawBase;
  return `${base.endsWith('/') ? base.slice(0, -1) : base}${buildEditorRoute(fileId)}`;
};
