import { hubDashboardAPI } from '../api/hubDashboard';
import { hubTasksAPI } from '../api/hubTasks';
import { mailMessageListAPI } from '../api/mailMessageList';
import { readStoredSelectedMailboxId } from '../components/mail/mailMailboxModel';
import {
  resolveInitialViewMode,
  safeReadStoredTaskMode,
} from '../pages/tasks/taskUrlState';
import {
  getMobileOfflineCacheInventory,
  getMobileOfflineState,
  waitForPendingMobileOfflineCacheWrites,
} from './mobileOfflineCache';

const MODULE_LABELS = {
  dashboard: 'Главная',
  tasks: 'Задачи',
  mail: 'Почта',
};

const buildTaskPrefetchParams = (tasksManageAll) => {
  const viewMode = resolveInitialViewMode('', tasksManageAll);
  const pageMode = safeReadStoredTaskMode() || 'list';
  const deadlineMode = ['deadlines', 'calendar', 'gantt'].includes(pageMode);
  return {
    scope: viewMode === 'all' ? 'all' : (viewMode === 'department' ? 'department' : 'my'),
    role_scope: viewMode === 'all' || viewMode === 'department' ? 'both' : viewMode,
    status: undefined,
    q: undefined,
    due_state: undefined,
    has_attachments: undefined,
    assignee_user_id: undefined,
    controller_user_id: undefined,
    department_id: undefined,
    unread_comments_only: undefined,
    focus_mode: undefined,
    sort_by: pageMode === 'board' ? 'status' : (deadlineMode ? 'due_at' : 'updated_at'),
    sort_dir: deadlineMode || pageMode === 'board' ? 'asc' : 'desc',
    limit: 150,
    offset: 0,
  };
};

const createPrefetchers = ({ tasksManageAll }) => ({
  dashboard: () => hubDashboardAPI.getDashboard({
    announcements_limit: 12,
    tasks_limit: 40,
  }),
  tasks: () => hubTasksAPI.getTasks(buildTaskPrefetchParams(tasksManageAll)),
  mail: () => mailMessageListAPI.getBootstrap({
    limit: 20,
    mailbox_id: readStoredSelectedMailboxId() || undefined,
    refresh: 'auto',
  }),
});

export const prepareMobileOfflineData = async ({
  dashboard = false,
  tasks = false,
  mail = false,
  tasksManageAll = false,
} = {}) => {
  const offlineState = getMobileOfflineState();
  if (!offlineState.enabled) throw new Error('Подготовка доступна только в APK HUB-IT.');
  if (offlineState.readOnly) throw new Error('Подключитесь к HUB-IT, чтобы обновить автономные данные.');

  const prefetchers = createPrefetchers({ tasksManageAll });
  const requestedModules = Object.keys(prefetchers).filter((module) => ({ dashboard, tasks, mail })[module]);
  if (requestedModules.length === 0) throw new Error('Нет доступных разделов для автономной подготовки.');

  const startedAt = Date.now();
  const settled = await Promise.allSettled(requestedModules.map((module) => prefetchers[module]()));
  await waitForPendingMobileOfflineCacheWrites();
  const inventory = await getMobileOfflineCacheInventory();
  const detailByModule = new Map(
    (inventory.moduleDetails || []).map((item) => [String(item.module || ''), item]),
  );
  const results = requestedModules.map((module, index) => {
    const detail = detailByModule.get(module);
    const fresh = settled[index].status === 'fulfilled' && Number(detail?.lastSyncAt || 0) >= startedAt;
    return {
      module,
      label: MODULE_LABELS[module],
      status: fresh ? 'prepared' : 'failed',
    };
  });
  const preparedModules = results.filter((item) => item.status === 'prepared');
  const failedModules = results.filter((item) => item.status === 'failed');
  if (preparedModules.length === 0) {
    throw new Error('Не удалось сохранить автономные данные. Проверьте подключение и доступ к разделам.');
  }
  return { preparedModules, failedModules, inventory };
};
