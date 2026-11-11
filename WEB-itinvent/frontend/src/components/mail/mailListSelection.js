export function resolveAdjacentMailListItem({ items, selectedId, delta } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  const currentId = String(selectedId || '');
  const index = list.findIndex((item) => String(item?.id || '') === currentId);
  const nextIndex = index < 0
    ? 0
    : Math.min(list.length - 1, Math.max(0, index + Number(delta || 0)));
  const next = list[nextIndex];
  const nextId = String(next?.id || '');
  if (!nextId || nextId === currentId) return null;
  return { next, nextId };
}
