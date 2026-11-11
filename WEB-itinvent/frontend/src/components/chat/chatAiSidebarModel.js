export const GENERAL_AI_OPENING_ID = '__general-ai__';

export const groupAiSidebarRowsByDate = (rows, nowValue = new Date()) => {
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const groups = [
    { key: 'today', label: 'Сегодня', items: [] },
    { key: 'yesterday', label: 'Вчера', items: [] },
    { key: 'earlier', label: 'Ранее', items: [] },
  ];
  (Array.isArray(rows) ? rows : []).forEach((item) => {
    const timestamp = Date.parse(String(item?.last_message_at || item?.updated_at || ''));
    const group = Number.isFinite(timestamp) && timestamp >= todayStart
      ? groups[0]
      : (Number.isFinite(timestamp) && timestamp >= yesterdayStart ? groups[1] : groups[2]);
    group.items.push(item);
  });
  groups.forEach((group) => {
    group.items.sort((left, right) => {
      const pinnedDelta = Number(Boolean(right?.is_pinned)) - Number(Boolean(left?.is_pinned));
      if (pinnedDelta) return pinnedDelta;
      return Date.parse(String(right?.last_message_at || right?.updated_at || ''))
        - Date.parse(String(left?.last_message_at || left?.updated_at || ''));
    });
  });
  return groups.filter((group) => group.items.length > 0);
};
