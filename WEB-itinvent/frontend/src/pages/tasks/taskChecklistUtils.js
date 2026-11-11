export const createChecklistItemId = () => (
  globalThis.crypto?.randomUUID?.() || `checklist-${Date.now()}-${Math.random().toString(16).slice(2)}`
);

export const createEmptyChecklistItem = () => ({
  id: createChecklistItemId(),
  text: '',
  done: false,
});

export const normalizeChecklistItems = (items) => (
  (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: String(item?.id || createChecklistItemId()),
      text: String(item?.text || '').trim(),
      done: Boolean(item?.done),
    }))
    .filter((item) => item.text.length > 0)
);
