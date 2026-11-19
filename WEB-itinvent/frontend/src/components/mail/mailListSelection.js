export function resolveAdjacentMailListItem({ items, selectedId, delta, mode } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  // Режим «Цепочки» ключует строки по conversation_id; у сообщений ключ — id
  // (conversation_id у message-строки тоже есть, поэтому ключ зависит от режима).
  const itemKey = (item) => String(
    mode === 'conversations' ? (item?.conversation_id || item?.id || '') : (item?.id || ''),
  );
  const currentId = String(selectedId || '');
  const index = list.findIndex((item) => itemKey(item) === currentId);
  const nextIndex = index < 0
    ? 0
    : Math.min(list.length - 1, Math.max(0, index + Number(delta || 0)));
  const next = list[nextIndex];
  const nextId = itemKey(next);
  if (!nextId || nextId === currentId) return null;
  return { next, nextId };
}
