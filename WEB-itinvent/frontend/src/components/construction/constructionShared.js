export const OBJECT_TEAM_ROLES = [
  { key: 'project_lead', label: 'Руководитель проекта', hint: 'Отвечает за объект и итоговые решения' },
  { key: 'pto_manager', label: 'Менеджер ПТО', hint: 'Координирует техническую подготовку' },
  { key: 'umto_coordinator', label: 'Координатор УМТО', hint: 'Ведёт снабжение и движение заявок' },
  { key: 'chief_project_engineer', label: 'ГИП — главный инженер проекта', hint: 'Техническое руководство проектом' },
];

export const EMPTY_FILTER_VALUE = '__empty__';

export const OBJECT_PAGE_TABS = [
  ['overview', 'Обзор'],
  ['directions', 'Направления'],
  ['structure', 'Структура'],
];

export const DIRECTION_PAGE_TABS = [
  ['overview', 'Обзор'],
  ['work', 'Ход работ'],
  ['requests', 'Заявки'],
  ['supply', 'Снабжение'],
  ['structure', 'Структура'],
];

export const SCROLL_PANE_SX = {
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehaviorY: 'contain',
  WebkitOverflowScrolling: 'touch',
  scrollbarGutter: { xs: 'auto', lg: 'stable' },
  '&:focus-visible': {
    outline: '3px solid',
    outlineColor: 'primary.main',
    outlineOffset: -3,
  },
};

export const getConstructionErrorMessage = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail?.message) return String(detail.message);
  return error?.message || fallback;
};

export const isConstructionRequestCancelled = (error) => (
  error?.code === 'ERR_CANCELED'
  || error?.name === 'CanceledError'
  || error?.name === 'AbortError'
);

export const constructionObjectPath = (objectId) => (
  `/construction/objects/${encodeURIComponent(String(objectId || '').trim())}`
);

export const constructionDirectionPath = (objectId, groupRef) => (
  `${constructionObjectPath(objectId)}/directions/${encodeURIComponent(String(groupRef || '').trim())}`
);

export const constructionDirectionRequestPath = (objectId, groupRef, requestRef) => (
  `${constructionDirectionPath(objectId, groupRef)}/requests/${encodeURIComponent(String(requestRef || '').trim())}`
);

export const roleLabel = (roleKey) => (
  OBJECT_TEAM_ROLES.find((item) => item.key === roleKey)?.label || roleKey
);
