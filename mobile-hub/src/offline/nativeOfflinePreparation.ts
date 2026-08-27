import { getHubDashboard } from '../api/hubApi';
import {
  getMailFolderSummary,
  getMailFolderTree,
  getMailMessages,
  type MailMessagePreview,
} from '../api/mailApi';
import {
  DEFAULT_NATIVE_MAIL_PREFERENCES,
  getNativeMailPreferences,
} from '../api/mailConfigApi';
import { listMailboxes } from '../api/mailMailboxesApi';
import { getMailUnreadSnapshot } from '../api/notificationApi';
import { getTasksPage } from '../api/taskApi';
import { readNativeSnapshot, writeNativeSnapshot } from '../cache/nativeSnapshotCache';

const TASK_PAGE_SIZE = 40;
const MAIL_PAGE_SIZE = 50;

type PreparationOptions = {
  userId: number;
  isAdmin: boolean;
  dashboard: boolean;
  tasks: boolean;
  mail: boolean;
};

type PreparationResult = {
  preparedModules: string[];
  failedModules: string[];
};

type DashboardSnapshot = {
  payload: Awaited<ReturnType<typeof getHubDashboard>>;
  communicationCounts: { chat: number; mail: number };
  docflowSummary?: unknown;
};

const MODULE_LABELS = {
  dashboard: 'Главная',
  tasks: 'Задачи',
  mail: 'Почта',
} as const;

async function prepareDashboard(userId: number): Promise<void> {
  const previous = await readNativeSnapshot<DashboardSnapshot>('dashboard', userId);
  const [payload, mailUnread] = await Promise.all([
    getHubDashboard(),
    getMailUnreadSnapshot().catch(() => null),
  ]);
  const stored = await writeNativeSnapshot<DashboardSnapshot>('dashboard', userId, {
    payload,
    communicationCounts: {
      chat: Math.max(0, Number(previous?.data.communicationCounts?.chat || 0)),
      mail: mailUnread
        ? Math.max(0, Number(mailUnread.unread_count || 0))
        : Math.max(0, Number(previous?.data.communicationCounts?.mail || 0)),
    },
    docflowSummary: previous?.data.docflowSummary,
  });
  if (!stored) throw new Error('Снимок главной страницы слишком большой');
}

async function prepareTasks(userId: number, isAdmin: boolean): Promise<void> {
  const viewMode = isAdmin ? 'all' : 'assignee';
  const request = {
    q: '',
    status: '',
    focus_mode: '' as const,
    scope: isAdmin ? 'all' as const : 'my' as const,
    role_scope: isAdmin ? 'both' as const : 'assignee' as const,
    due_state: '' as const,
    department_id: '',
    controller_user_id: undefined,
    assignee_user_id: undefined,
    has_attachments: false,
    unread_comments_only: false,
    sort_by: 'updated_at' as const,
    sort_dir: 'desc' as const,
    limit: TASK_PAGE_SIZE,
    offset: 0,
  };
  const page = await getTasksPage(request);
  const signature = JSON.stringify({ ...request, offset: 0 });
  const stored = await writeNativeSnapshot('tasks-inbox', userId, { signature, page });
  if (!stored) throw new Error(`Список задач «${viewMode}» слишком большой`);
}

async function prepareMail(userId: number): Promise<void> {
  const filters = {
    mailboxId: '',
    folder: 'inbox',
    folderScope: 'current' as const,
    q: '',
    unreadOnly: false,
    hasAttachments: false,
    dateFrom: '',
    dateTo: '',
    from: '',
    to: '',
    subject: '',
    body: '',
    importance: '',
    limit: MAIL_PAGE_SIZE,
    offset: 0,
  };
  const [page, summary, folderTree, mailboxItems, preferences] = await Promise.all([
    getMailMessages(filters),
    getMailFolderSummary(''),
    getMailFolderTree('').catch(() => ({ items: [] })),
    listMailboxes(true),
    getNativeMailPreferences().catch(() => DEFAULT_NATIVE_MAIL_PREFERENCES),
  ]);
  const items = page.items.map((value: MailMessagePreview) => ({
    kind: 'message' as const,
    key: `m:${value.id}`,
    value,
  }));
  const signature = JSON.stringify({ ...filters, offset: 0, view: 'messages' });
  const stored = await writeNativeSnapshot('mail-inbox', userId, {
    signature,
    items,
    total: page.total,
    hasMore: page.has_more,
    summary,
    folderTree: folderTree.items,
    mailboxes: mailboxItems.filter((item) => item.is_active !== false),
    preferences,
  });
  if (!stored) throw new Error('Список писем слишком большой');
}

export async function prepareNativeOfflineData(options: PreparationOptions): Promise<PreparationResult> {
  const userId = Number(options.userId || 0);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Authenticated user is required');
  const requested = [
    options.dashboard ? ['dashboard', () => prepareDashboard(userId)] as const : null,
    options.tasks ? ['tasks', () => prepareTasks(userId, options.isAdmin)] as const : null,
    options.mail ? ['mail', () => prepareMail(userId)] as const : null,
  ].filter((item): item is readonly [keyof typeof MODULE_LABELS, () => Promise<void>] => Boolean(item));
  if (requested.length === 0) throw new Error('Нет доступных разделов для автономной подготовки.');

  const settled = await Promise.allSettled(requested.map(([, prepare]) => prepare()));
  return requested.reduce<PreparationResult>((result, [module], index) => {
    const target = settled[index].status === 'fulfilled' ? result.preparedModules : result.failedModules;
    target.push(MODULE_LABELS[module]);
    return result;
  }, { preparedModules: [], failedModules: [] });
}
