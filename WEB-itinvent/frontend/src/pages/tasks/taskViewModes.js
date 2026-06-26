export const TASK_MODE_OPTIONS = [
  { value: 'list', label: 'Список' },
  { value: 'deadlines', label: 'Сроки' },
  { value: 'calendar', label: 'Календарь' },
  { value: 'gantt', label: 'Гант' },
  { value: 'board', label: 'Доска' },
  { value: 'analytics', label: 'Аналитика' },
];

const TASK_MODE_VALUES = new Set(TASK_MODE_OPTIONS.map((item) => item.value));
const DEPRECATED_TASK_MODE_VALUES = new Set(['plan']);

export const normalizeTaskMode = (value, fallback = 'list') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (DEPRECATED_TASK_MODE_VALUES.has(normalized)) return 'list';
  return TASK_MODE_VALUES.has(normalized) ? normalized : fallback;
};

export const parseTaskDate = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const isTaskDone = (task) => String(task?.status || '').trim().toLowerCase() === 'done';

export const isTaskOpen = (task) => !isTaskDone(task);

export const startOfLocalDay = (value) => {
  const date = parseTaskDate(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const endOfLocalDay = (value) => {
  const date = startOfLocalDay(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const addDays = (value, days) => {
  const date = parseTaskDate(value) || new Date();
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + Number(days || 0));
  return next;
};

const endOfLocalWeek = (value) => {
  const date = startOfLocalDay(value);
  const day = date.getDay() || 7;
  const end = new Date(date);
  end.setDate(date.getDate() + (7 - day));
  end.setHours(23, 59, 59, 999);
  return end;
};

const startOfLocalWeek = (value) => {
  const date = startOfLocalDay(value);
  const day = date.getDay() || 7;
  const start = new Date(date);
  start.setDate(date.getDate() - day + 1);
  return start;
};

const dateAtHour = (value, hour = 18) => {
  const date = startOfLocalDay(value);
  date.setHours(hour, 0, 0, 0);
  return date;
};

export const toLocalDateTimeInput = (value) => {
  const parsed = parseTaskDate(value);
  if (!parsed) return '';
  const local = new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
};


export const CREATE_DUE_DEFAULT_TIME = '19:00';
export const CREATE_DUE_HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
export const CREATE_DUE_MINUTE_OPTIONS = ['00', '15', '30', '45'];

export const splitLocalDateTimeInput = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return { date: '', time: CREATE_DUE_DEFAULT_TIME };
  }
  const [date = '', time = CREATE_DUE_DEFAULT_TIME] = normalized.split('T');
  return { date, time: time.slice(0, 5) || CREATE_DUE_DEFAULT_TIME };
};

export const joinLocalDateTimeInput = (date, time) => {
  const normalizedDate = String(date || '').trim();
  const normalizedTime = String(time || '').trim();
  if (!normalizedDate || !normalizedTime) return '';
  return `${normalizedDate}T${normalizedTime}`;
};

const WORK_END_HOUR = 19;

const dateAtWorkEnd = (value) => {
  const date = startOfLocalDay(value);
  date.setHours(WORK_END_HOUR, 0, 0, 0);
  return date;
};

const nextFridayAtWorkEnd = (value) => {
  const source = parseTaskDate(value) || new Date();
  const target = dateAtWorkEnd(source);
  const normalizedDay = target.getDay() || 7;
  let daysUntilFriday = 5 - normalizedDay;
  if (daysUntilFriday < 0) daysUntilFriday += 7;
  if (daysUntilFriday === 0 && source.getTime() > target.getTime()) daysUntilFriday = 7;
  target.setDate(target.getDate() + daysUntilFriday);
  return target;
};

export const buildCreateDuePresets = (now = new Date()) => {
  const today = dateAtWorkEnd(now);
  const tomorrow = dateAtWorkEnd(addDays(now, 1));
  const nextWeekEnd = nextFridayAtWorkEnd(now);

  return [
    {
      key: 'today',
      label: 'Сегодня',
      description: today.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }),
      value: toLocalDateTimeInput(today),
    },
    {
      key: 'tomorrow',
      label: 'Завтра',
      description: tomorrow.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }),
      value: toLocalDateTimeInput(tomorrow),
    },
    {
      key: 'next_week_end',
      label: 'В конце следующей недели',
      description: nextWeekEnd.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }),
      value: toLocalDateTimeInput(nextWeekEnd),
    },
    {
      key: 'none',
      label: 'Без срока',
      description: '',
      value: '',
    },
  ];
};

export const formatCreateDueLabel = (value, now = new Date()) => {
  const parsed = parseTaskDate(value);
  if (!parsed) return 'Без срока';

  const valueKey = toLocalDateKey(parsed);
  const todayKey = toLocalDateKey(now);
  const tomorrowKey = toLocalDateKey(addDays(now, 1));
  const time = parsed.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  if (valueKey === todayKey) return `сегодня в ${time}`;
  if (valueKey === tomorrowKey) return `завтра в ${time}`;
  return `${parsed.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} в ${time}`;
};

export const toLocalDateKey = (value) => {
  const date = parseTaskDate(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const compareTasksByDueThenUpdated = (left, right) => {
  const leftDue = parseTaskDate(left?.due_at)?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightDue = parseTaskDate(right?.due_at)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (leftDue !== rightDue) return leftDue - rightDue;
  const leftUpdated = parseTaskDate(left?.updated_at || left?.created_at)?.getTime() ?? 0;
  const rightUpdated = parseTaskDate(right?.updated_at || right?.created_at)?.getTime() ?? 0;
  return rightUpdated - leftUpdated;
};

const sortBucketItems = (items) => [...items].sort(compareTasksByDueThenUpdated);

const createBucketMap = (buckets) => new Map(
  buckets.map((bucket) => [bucket.key, { ...bucket, items: [] }]),
);

const getMobileFeedRank = (task, now = new Date()) => {
  if (isTaskDone(task)) return 6;

  const dueAt = parseTaskDate(task?.due_at);
  const todayStart = startOfLocalDay(now);
  const todayEnd = endOfLocalDay(now);
  const status = String(task?.status || '').trim().toLowerCase();

  if (task?.is_overdue || (dueAt && dueAt < todayStart)) return 0;
  if (dueAt && dueAt <= todayEnd) return 1;
  if (task?.has_unread_comments) return 2;
  if (status === 'review') return 3;
  if (status === 'in_progress') return 4;
  return 5;
};

export const buildMobileTaskFeed = (tasks, now = new Date()) => (
  [...(Array.isArray(tasks) ? tasks : [])].sort((left, right) => {
    const leftRank = getMobileFeedRank(left, now);
    const rightRank = getMobileFeedRank(right, now);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return compareTasksByDueThenUpdated(left, right);
  })
);


export const buildTaskListSections = (tasks, now = new Date()) => {
  const source = Array.isArray(tasks) ? tasks : [];
  const active = buildMobileTaskFeed(source.filter(isTaskOpen), now);
  const completed = buildMobileTaskFeed(source.filter(isTaskDone), now);
  return {
    active: { items: active },
    completed: { items: completed },
  };
};

export const buildMobileTaskActionState = (task, options = {}) => {
  const status = String(task?.status || '').trim().toLowerCase();
  const canUploadAct = Boolean(options.canOpenTransferActUpload);
  const canStart = Boolean(options.canStart);
  const canSubmit = Boolean(options.canSubmit);
  const canReview = Boolean(options.canReview);

  if (canUploadAct) {
    return {
      key: 'upload_act',
      stepLabel: 'Загрузить акт',
      actionLabel: 'Загрузить акт',
      hint: 'Загрузите подписанный акт, чтобы закрыть напоминание.',
      tone: 'primary',
    };
  }

  if (status === 'done' && Boolean(options.canReopen)) {
    return {
      key: 'reopen',
      stepLabel: 'Вернуть в работу',
      actionLabel: 'Вернуть в работу',
      hint: 'Верните задачу в работу, если нужно продолжить выполнение.',
      tone: 'primary',
    };
  }

  if (status === 'done') {
    return {
      key: 'done',
      stepLabel: 'Завершено',
      actionLabel: '',
      hint: 'Задача завершена.',
      tone: 'success',
    };
  }

  if (status === 'review') {
    if (canReview) {
      return {
        key: 'review',
        stepLabel: 'Проверить результат',
        actionLabel: 'Проверить',
        hint: 'Проверьте результат и примите или верните задачу.',
        tone: 'review',
      };
    }

    return {
      key: 'waiting_review',
      stepLabel: 'На проверке',
      actionLabel: '',
      hint: 'Результат отправлен на проверку. Ожидайте решения контролёра.',
      tone: 'review',
      passive: true,
    };
  }

  if (status === 'new' || canStart) {
    return {
      key: 'start',
      stepLabel: 'Взять в работу',
      actionLabel: canStart ? 'Начать' : '',
      hint: 'Начните задачу, когда готовы выполнять.',
      tone: 'primary',
    };
  }

  if (status === 'in_progress' || canSubmit) {
    return {
      key: 'submit',
      stepLabel: 'Сдать результат',
      actionLabel: canSubmit ? 'Сдать' : '',
      hint: 'Нажмите "Сдать", добавьте комментарий и файл при необходимости.',
      tone: 'warning',
    };
  }

  return {
    key: 'open',
    stepLabel: 'Открыть детали',
    actionLabel: '',
    hint: 'Откройте карточку, чтобы посмотреть детали задачи.',
    tone: 'neutral',
  };
};

const DEADLINE_BUCKETS = [
  { key: 'overdue', label: 'Просрочены', color: '#ef4444', createDueAt: null },
  { key: 'today', label: 'На сегодня', color: '#84cc16', createDueAt: null },
  { key: 'this_week', label: 'На этой неделе', color: '#06b6d4', createDueAt: null },
  { key: 'next_week', label: 'На следующей неделе', color: '#22d3ee', createDueAt: null },
  { key: 'no_due', label: 'Без срока', color: '#94a3b8', createDueAt: '' },
  { key: 'later', label: 'Больше двух недель', color: '#3b82f6', createDueAt: null },
  { key: 'done', label: 'Завершены', color: '#64748b', createDueAt: null },
];

export const buildDeadlineBuckets = (tasks, now = new Date()) => {
  const todayStart = startOfLocalDay(now);
  const todayEnd = endOfLocalDay(now);
  const thisWeekEnd = endOfLocalWeek(now);
  const nextWeekEnd = endOfLocalWeek(addDays(thisWeekEnd, 1));
  const bucketMap = createBucketMap(DEADLINE_BUCKETS.map((bucket) => {
    if (bucket.key === 'today') return { ...bucket, createDueAt: dateAtHour(todayStart) };
    if (bucket.key === 'this_week') return { ...bucket, createDueAt: dateAtHour(thisWeekEnd) };
    if (bucket.key === 'next_week') return { ...bucket, createDueAt: dateAtHour(nextWeekEnd) };
    if (bucket.key === 'later') return { ...bucket, createDueAt: dateAtHour(addDays(nextWeekEnd, 1)) };
    return bucket;
  }));

  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    let bucketKey = 'no_due';
    const dueAt = parseTaskDate(task?.due_at);

    if (isTaskDone(task)) bucketKey = 'done';
    else if (!dueAt) bucketKey = 'no_due';
    else if (dueAt < todayStart) bucketKey = 'overdue';
    else if (dueAt <= todayEnd) bucketKey = 'today';
    else if (dueAt <= thisWeekEnd) bucketKey = 'this_week';
    else if (dueAt <= nextWeekEnd) bucketKey = 'next_week';
    else bucketKey = 'later';

    bucketMap.get(bucketKey)?.items.push(task);
  });

  return DEADLINE_BUCKETS.map((bucket) => {
    const nextBucket = bucketMap.get(bucket.key);
    return { ...nextBucket, items: sortBucketItems(nextBucket?.items || []) };
  });
};

export const buildCalendarDays = (tasks, month = new Date()) => {
  const monthDate = parseTaskDate(month) || new Date();
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
  const gridStart = startOfLocalWeek(monthStart);
  const dayMap = new Map();
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);
    const dateKey = toLocalDateKey(date);
    const day = {
      date,
      dateKey,
      inMonth: date.getMonth() === monthStart.getMonth(),
      isToday: dateKey === toLocalDateKey(new Date()),
      items: [],
    };
    dayMap.set(dateKey, day);
    return day;
  });

  let noDueCount = 0;
  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    const dueAt = parseTaskDate(task?.due_at);
    if (!dueAt) {
      if (isTaskOpen(task)) noDueCount += 1;
      return;
    }
    const day = dayMap.get(toLocalDateKey(dueAt));
    if (day) day.items.push(task);
  });

  days.forEach((day) => {
    day.items = sortBucketItems(day.items);
  });

  return { days, monthStart, monthEnd, noDueCount };
};

const inferGanttRange = (rows) => {
  const timestamps = rows.flatMap((row) => [
    row.rawStart.getTime(),
    row.rawEnd.getTime(),
  ]);
  if (timestamps.length === 0) {
    const start = startOfLocalWeek(new Date());
    return { start, end: addDays(start, 42) };
  }
  const min = new Date(Math.min(...timestamps));
  const max = new Date(Math.max(...timestamps));
  return {
    start: startOfLocalWeek(min),
    end: endOfLocalDay(addDays(endOfLocalWeek(max), 7)),
  };
};

export const buildGanttRows = (tasks, range = {}) => {
  const noDueItems = [];
  const rawRows = [];

  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    const dueAt = parseTaskDate(task?.due_at);
    if (!dueAt) {
      if (isTaskOpen(task)) noDueItems.push(task);
      return;
    }

    const startAt = parseTaskDate(task?.protocol_date)
      || parseTaskDate(task?.created_at)
      || dueAt;
    const rawStart = startAt > dueAt ? dueAt : startAt;
    const rawEnd = dueAt;
    rawRows.push({ task, rawStart, rawEnd });
  });

  const inferredRange = inferGanttRange(rawRows);
  const rangeStart = startOfLocalDay(range.start || inferredRange.start);
  const rangeEnd = endOfLocalDay(range.end || inferredRange.end);
  const totalMs = Math.max(1, rangeEnd.getTime() - rangeStart.getTime());

  const rows = rawRows
    .sort((left, right) => left.rawEnd.getTime() - right.rawEnd.getTime())
    .map((row) => {
      const clampedStart = new Date(Math.max(row.rawStart.getTime(), rangeStart.getTime()));
      const clampedEnd = new Date(Math.min(row.rawEnd.getTime(), rangeEnd.getTime()));
      const leftPercent = Math.max(0, Math.min(100, ((clampedStart.getTime() - rangeStart.getTime()) / totalMs) * 100));
      const rawWidth = ((clampedEnd.getTime() - clampedStart.getTime()) / totalMs) * 100;
      const widthPercent = Math.max(3, Math.min(100 - leftPercent, rawWidth || 3));
      return {
        ...row,
        start: row.rawStart,
        end: row.rawEnd,
        leftPercent,
        widthPercent,
        startKey: toLocalDateKey(row.rawStart),
        endKey: toLocalDateKey(row.rawEnd),
      };
    });

  return {
    rows,
    rangeStart,
    rangeEnd,
    noDueItems: sortBucketItems(noDueItems),
  };
};
