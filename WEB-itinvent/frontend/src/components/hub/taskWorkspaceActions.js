const SYSTEM_PERSON_LABELS = {
  'announcement admin': 'Системный контролёр',
  feed_admin: 'Системный контролёр',
  'hub admin': 'Системный контролёр',
};

export function formatHubPersonDisplay(name, username = '') {
  const rawName = String(name || '').trim();
  const rawUsername = String(username || '').trim();
  const mapped = SYSTEM_PERSON_LABELS[rawName.toLowerCase()]
    || SYSTEM_PERSON_LABELS[rawUsername.toLowerCase()];
  const label = mapped || rawName || rawUsername || '-';
  return {
    label,
    tooltip: mapped && (rawName || rawUsername) ? (rawName || rawUsername) : '',
    isSystem: Boolean(mapped),
  };
}

export function resolveTaskActorRole(task, currentUser) {
  const userId = Number(currentUser?.id || 0);
  if (!userId) return 'guest';
  if (Number(task?.assignee_user_id) === userId) return 'assignee';
  if (Number(task?.controller_user_id) === userId) return 'controller';
  if (Number(task?.created_by_user_id) === userId) return 'creator';
  if (Boolean(task?.is_observer)) return 'observer';
  return 'participant';
}

function roleReason(role, expected) {
  if (expected === 'assignee' && role === 'creator') {
    return 'Недоступно: вы являетесь постановщиком, а не исполнителем';
  }
  if (expected === 'assignee' && role === 'controller') {
    return 'Недоступно: вы являетесь контролёром, а не исполнителем';
  }
  if (expected === 'assignee' && role === 'observer') {
    return 'Недоступно: вы наблюдатель этой задачи';
  }
  if (expected === 'assignee') {
    return 'Недоступно: отправить на проверку может только исполнитель';
  }
  if (expected === 'controller' && role === 'assignee') {
    return 'Недоступно: проверку выполняет контролёр, а не исполнитель';
  }
  if (expected === 'controller' && role === 'creator') {
    return 'Недоступно: вы являетесь постановщиком, а не контролёром';
  }
  if (expected === 'controller' && role === 'observer') {
    return 'Недоступно: вы наблюдатель этой задачи';
  }
  if (expected === 'controller') {
    return 'Недоступно: принять работу может только контролёр';
  }
  if (expected === 'closer' && role === 'assignee') {
    return 'Недоступно: закрыть может постановщик, а не исполнитель';
  }
  if (expected === 'closer' && role === 'observer') {
    return 'Недоступно: вы наблюдатель этой задачи';
  }
  if (expected === 'closer' && role === 'controller') {
    return 'Недоступно: закрыть может постановщик, руководитель отдела или администратор';
  }
  if (expected === 'closer') {
    return 'Недоступно: закрыть может постановщик, руководитель отдела или администратор';
  }
  return 'Недоступно для вашей роли';
}

export function buildTaskWorkspacePrimaryActions(task, currentUser) {
  const capabilities = task?.capabilities || {};
  const status = String(task?.status || '').trim().toLowerCase();
  const role = resolveTaskActorRole(task, currentUser);
  const actions = [];

  if (status === 'new' || status === 'in_progress') {
    if (status === 'new') {
      actions.push({
        key: 'start',
        label: 'В работу',
        variant: 'outlined',
        color: 'primary',
        enabled: Boolean(capabilities.can_start),
        reason: capabilities.can_start ? '' : roleReason(role, 'assignee'),
      });
    }
    actions.push({
      key: 'submit',
      label: 'Отправить на проверку',
      variant: 'contained',
      color: 'primary',
      enabled: Boolean(capabilities.can_submit),
      reason: capabilities.can_submit ? '' : roleReason(role, 'assignee'),
    });
  }

  if (status === 'review') {
    actions.push({
      key: 'approve',
      label: 'Принять',
      variant: 'contained',
      color: 'success',
      enabled: Boolean(capabilities.can_review),
      reason: capabilities.can_review ? '' : roleReason(role, 'controller'),
    });
    actions.push({
      key: 'reject',
      label: 'Вернуть на доработку',
      variant: 'outlined',
      color: 'warning',
      enabled: Boolean(capabilities.can_review),
      reason: capabilities.can_review ? '' : roleReason(role, 'controller'),
    });
  }

  if (status === 'new' || status === 'in_progress' || status === 'review') {
    actions.push({
      key: 'close',
      label: 'Закрыть',
      variant: 'outlined',
      color: 'primary',
      enabled: Boolean(capabilities.can_close),
      reason: capabilities.can_close ? '' : roleReason(role, 'closer'),
    });
  }

  if (status === 'done' && (capabilities.can_reopen || role === 'creator' || role === 'controller' || role === 'assignee')) {
    actions.push({
      key: 'reopen',
      label: 'Вернуть в работу',
      variant: 'outlined',
      color: 'primary',
      enabled: Boolean(capabilities.can_reopen),
      reason: capabilities.can_reopen ? '' : 'Недоступно: задачу уже нельзя вернуть в работу',
    });
  }

  return actions;
}

export function buildTaskHistoryItems(task) {
  const fromHistory = Array.isArray(task?.status_history) ? task.status_history : [];
  if (fromHistory.length) {
    return fromHistory
      .map((item, index) => ({
        id: String(item?.id || `${item?.status || 'event'}-${index}`),
        at: item?.at || item?.created_at || item?.changed_at || '',
        text: String(item?.text || item?.label || item?.comment || '').trim()
          || `Статус: ${item?.status || 'изменён'}`,
      }))
      .filter((item) => item.text);
  }

  const items = [];
  if (task?.created_at) {
    items.push({
      id: 'created',
      at: task.created_at,
      text: `Задача создана${task.created_by_full_name ? ` · ${formatHubPersonDisplay(task.created_by_full_name, task.created_by_username).label}` : ''}`,
    });
  }
  if (task?.submitted_at) {
    items.push({
      id: 'submitted',
      at: task.submitted_at,
      text: 'Отправлена на проверку',
    });
  }
  if (task?.reviewed_at) {
    items.push({
      id: 'reviewed',
      at: task.reviewed_at,
      text: 'Проверена контролёром',
    });
  }
  if (task?.completed_at) {
    items.push({
      id: 'completed',
      at: task.completed_at,
      text: 'Задача завершена',
    });
  }
  return items.sort((left, right) => new Date(left.at || 0) - new Date(right.at || 0));
}

export function formatRelativeUpdatedAt(value, now = new Date()) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const deltaMs = now.getTime() - parsed.getTime();
  if (deltaMs < 60 * 1000) return 'Обновлено только что';
  const minutes = Math.round(deltaMs / 60000);
  if (minutes < 60) return `Обновлено ${minutes} мин назад`;
  return `Обновлено ${parsed.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
}
