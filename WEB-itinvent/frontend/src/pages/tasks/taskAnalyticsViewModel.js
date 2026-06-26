import { formatMetricCountPercent } from './taskFormatters';
import { analyticsStatusColors } from './taskAnalyticsModel';

const chipBg = (color, alpha = 0.12) => {
  if (color === '#2563eb') return 'rgba(37,99,235,0.12)';
  if (color === '#059669') return 'rgba(5,150,105,0.12)';
  return `rgba(100,116,139,${alpha})`;
};

export const buildProjectObjectCounts = (taskObjects = []) => {
  const counts = {};
  taskObjects.forEach((item) => {
    const key = String(item?.project_id || '').trim();
    if (!key) return;
    counts[key] = Number(counts[key] || 0) + 1;
  });
  return counts;
};

export const buildSelectedAnalyticsParticipant = ({
  participantId = '',
  byParticipant = [],
  fallbackUser = null,
} = {}) => {
  const selectedId = String(participantId || '').trim();
  if (!selectedId) return null;
  const byId = byParticipant.find(
    (item) => String(item?.participant_user_id || '') === selectedId,
  );
  if (byId) return byId;
  if (!fallbackUser) return null;
  return {
    participant_user_id: Number(selectedId),
    participant_name: fallbackUser.full_name || fallbackUser.username || 'Участник',
    total: 0,
    new: 0,
    in_progress: 0,
    review: 0,
    open: 0,
    done: 0,
    done_on_time: 0,
    done_without_due: 0,
    overdue: 0,
    completion_percent: 0,
    completion_on_time_percent: 0,
  };
};

export const buildAnalyticsParticipantSectionMeta = ({
  selectedObjects = [],
  selectedProjects = [],
} = {}) => {
  if (selectedObjects.length === 1) {
    return {
      title: 'По участникам выбранного объекта',
      subtitle: selectedObjects[0]?.name || '',
    };
  }
  if (selectedObjects.length > 1) {
    return {
      title: 'По участникам выбранных объектов',
      subtitle: selectedObjects.map((item) => item?.name).filter(Boolean).join(', '),
    };
  }
  if (selectedProjects.length === 1) {
    return {
      title: 'По участникам выбранного проекта',
      subtitle: selectedProjects[0]?.name || '',
    };
  }
  if (selectedProjects.length > 1) {
    return {
      title: 'По участникам выбранных проектов',
      subtitle: selectedProjects.map((item) => item?.name).filter(Boolean).join(', '),
    };
  }
  return {
    title: 'По участникам',
    subtitle: '',
  };
};

export const buildAnalyticsProjectSectionMeta = ({ selectedProjects = [] } = {}) => {
  if (selectedProjects.length === 1) {
    return {
      title: 'Срез по проекту',
      subtitle: selectedProjects[0]?.name || '',
    };
  }
  if (selectedProjects.length > 1) {
    return {
      title: 'Срез по проектам',
      subtitle: selectedProjects.map((item) => item?.name).filter(Boolean).join(', '),
    };
  }
  return null;
};

export const buildAnalyticsFocusMeta = ({
  selectedObjects = [],
  selectedProjects = [],
} = {}) => {
  if (selectedObjects.length === 1) {
    return {
      title: 'Сейчас считаем по объекту',
      description: 'Ниже вся аналитика уже отфильтрована по выбранному объекту.',
      chips: selectedObjects.map((item) => ({ key: `object-${item.id}`, label: item.name, color: '#2563eb', bg: chipBg('#2563eb') })),
    };
  }
  if (selectedObjects.length > 1) {
    return {
      title: 'Сейчас считаем по выбранным объектам',
      description: 'Ниже вся аналитика уже отфильтрована по выбранным объектам.',
      chips: selectedObjects.map((item) => ({ key: `object-${item.id}`, label: item.name, color: '#2563eb', bg: chipBg('#2563eb') })),
    };
  }
  if (selectedProjects.length === 1) {
    return {
      title: 'Сейчас считаем по проекту',
      description: 'Ниже вся аналитика уже отфильтрована по выбранному проекту.',
      chips: selectedProjects.map((item) => ({ key: `project-${item.id}`, label: item.name, color: '#059669', bg: chipBg('#059669') })),
    };
  }
  if (selectedProjects.length > 1) {
    return {
      title: 'Сейчас считаем по выбранным проектам',
      description: 'Ниже вся аналитика уже отфильтрована по выбранным проектам.',
      chips: selectedProjects.map((item) => ({ key: `project-${item.id}`, label: item.name, color: '#059669', bg: chipBg('#059669') })),
    };
  }
  return {
    title: 'Сейчас считаем по всем задачам',
    description: 'Чтобы увидеть срез по проекту, выберите проект. Чтобы сузить отчёт до объекта, после этого выберите объект.',
    chips: [],
  };
};

export const buildAnalyticsStatusChartData = ({ statusBreakdown = [], summary = {} } = {}) => {
  const rawItems = Array.isArray(statusBreakdown) ? statusBreakdown : [];
  const base = rawItems.length > 0 ? rawItems : [
    { status: 'new', label: 'Новые', value: Number(summary?.new || 0) },
    { status: 'in_progress', label: 'В работе', value: Number(summary?.in_progress || 0) },
    { status: 'review', label: 'На проверке', value: Number(summary?.review || 0) },
    { status: 'done', label: 'Выполнено', value: Number(summary?.done || 0) },
  ];
  return base.map((item) => ({
    ...item,
    value: Number(item?.value || 0),
    color: analyticsStatusColors[item?.status] || '#64748b',
  }));
};

export const buildAnalyticsParticipantChartData = (byParticipant = []) => (
  Array.isArray(byParticipant)
    ? byParticipant
      .slice(0, 8)
      .map((item) => ({
        name: item?.participant_name || 'Не назначен',
        open: Number(item?.open || 0),
        done: Number(item?.done || 0),
        overdue: Number(item?.overdue || 0),
      }))
    : []
);

export const buildAnalyticsScopeChart = ({
  objectIds = [],
  projectIds = [],
  byObject = [],
  byProject = [],
} = {}) => {
  const hasObjectFocus = Array.isArray(objectIds) && objectIds.length > 0;
  const singleProjectFocus = Array.isArray(projectIds) && projectIds.length === 1;
  const useObjects = hasObjectFocus || singleProjectFocus;
  const sourceRows = useObjects ? byObject : byProject;
  return {
    title: useObjects ? 'По объектам' : 'По проектам',
    rows: Array.isArray(sourceRows)
      ? sourceRows.slice(0, 8).map((item) => ({
        name: useObjects ? (item?.object_name || 'Без объекта') : (item?.project_name || 'Без проекта'),
        open: Number(item?.open || 0),
        done: Number(item?.done || 0),
        overdue: Number(item?.overdue || 0),
      }))
      : [],
  };
};

export const buildAnalyticsTrendItems = (trend = {}) => (
  Array.isArray(trend?.items)
    ? trend.items.map((item) => ({
      name: item?.bucket_label || '',
      created: Number(item?.created || 0),
      completed: Number(item?.completed || 0),
      completed_on_time: Number(item?.completed_on_time || 0),
    }))
    : []
);

export const buildAnalyticsKpis = (summary = {}) => ([
  { title: 'Всего задач', value: Number(summary?.total || 0), color: '#2563eb', helper: 'Все задачи по фильтрам' },
  { title: 'Открыто', value: Number(summary?.open || 0), color: '#d97706', helper: `Новые ${Number(summary?.new || 0)} · В работе ${Number(summary?.in_progress || 0)} · На проверке ${Number(summary?.review || 0)}` },
  { title: 'Выполнено', value: formatMetricCountPercent(summary?.done, summary?.completion_percent), color: '#059669', helper: 'Общий процент выполнения' },
  { title: 'В срок', value: formatMetricCountPercent(summary?.done_on_time, summary?.completion_on_time_percent), color: '#7c3aed', helper: `Со сроком: ${Number(summary?.with_due_total || 0)}` },
  { title: 'Просрочено', value: Number(summary?.overdue || 0), color: '#dc2626', helper: 'Открытые задачи с истекшим сроком' },
  { title: 'Выполнено без срока', value: Number(summary?.done_without_due || 0), color: '#0f766e', helper: 'Не попадают в KPI "В срок"' },
]);

export const resolveAnalyticsObjectOptions = ({
  activeTaskObjects = [],
  projectIds = [],
} = {}) => {
  const selectedProjects = Array.isArray(projectIds) ? projectIds : [];
  if (!selectedProjects.length) return activeTaskObjects;
  const allowed = new Set(selectedProjects.map((id) => String(id)));
  return activeTaskObjects.filter((item) => allowed.has(String(item?.project_id || '')));
};

export const pruneAnalyticsObjectIds = (objectIds = [], allowedOptions = []) => {
  const allowedIds = new Set(allowedOptions.map((item) => String(item?.id || '')));
  const current = Array.isArray(objectIds) ? objectIds : [];
  const next = current.filter((id) => allowedIds.has(String(id)));
  return next.length === current.length ? null : next;
};
