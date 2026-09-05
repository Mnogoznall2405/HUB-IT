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
import {
  getMailNotificationFeed,
  getMailUnreadSnapshot,
  pollHubNotifications,
} from '../api/notificationApi';
import { getConversationPage, listChatFolders } from '../api/chatApi';
import { getTasksPage } from '../api/taskApi';
import { getDocflowProfile, listDocflowTasks } from '../api/docflowApi';
import { getCompleteAddressBook } from '../api/addressBookApi';
import { listFeedPosts } from '../api/feedApi';
import { getMyFilesQuota, listMyFiles } from '../api/myFilesApi';
import { getCompanyStructureTree } from '../api/companyStructureApi';
import {
  readNativeSnapshot,
  writeNativeCollectionSnapshot,
  writeNativeSnapshot,
} from '../cache/nativeSnapshotCache';
import {
  readNativeAddressBookSnapshot,
  writeNativeAddressBookSnapshot,
} from '../cache/nativeAddressBookSnapshot';
import type { NativeMyFilesInboxSnapshot } from '../myFiles/nativeMyFilesSnapshot';
import type { NativeCompanyStructureTreeSnapshot } from '../companyStructure/nativeCompanyStructureSnapshot';
import { writeNativeChatInboxSnapshot } from '../chat/nativeChatInboxSnapshot';
import { refreshNativeReadCaches } from './nativeReadCacheRefresh';
import {
  readNativeOfflineCoverage,
  recordNativeOfflineCoverageFailure,
  recordNativeOfflineCoverageSuccess,
} from './nativeOfflineCoverage';

const FEED_PAGE_SIZE = 200;
const TASK_PAGE_SIZE = 200;
const CHAT_PAGE_SIZE = 200;
const MAIL_PAGE_SIZE = 200;
const DOCFLOW_PAGE_SIZE = 100;

export type PreparationOptions = {
  userId: number;
  isAdmin: boolean;
  dashboard: boolean;
  feed: boolean;
  tasks: boolean;
  chat?: boolean;
  notifications?: boolean;
  mail: boolean;
  docflow: boolean;
  addressBook: boolean;
  database: boolean;
  myFiles: boolean;
  companyStructure: boolean;
};

export type PreparationResult = {
  preparedModules: string[];
  failedModules: string[];
};

type PreparationMetric = {
  loaded: number;
  total?: number;
  unit: string;
  complete?: boolean;
};

export type OfflinePreparationProgressEvent = {
  key: keyof typeof MODULE_LABELS;
  label: string;
  status: 'loading' | 'completed' | 'failed';
  completedModules: number;
  totalModules: number;
  loaded?: number;
  total?: number;
  unit?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type OfflinePreparationProgressListener = (event: OfflinePreparationProgressEvent) => void;

class OfflinePreparationStageError extends Error {
  constructor(
    readonly code: string,
    readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = 'OfflinePreparationStageError';
  }
}

type DashboardSnapshot = {
  payload: Awaited<ReturnType<typeof getHubDashboard>>;
  communicationCounts: { chat: number; mail: number };
  docflowSummary?: unknown;
};

const MODULE_LABELS = {
  chat: 'Chat',
  notifications: 'Уведомления',
  dashboard: 'Главная',
  feed: 'Лента',
  tasks: 'Задачи',
  mail: 'Почта',
  docflow: '1С ДО',
  addressBook: 'Адресная книга',
  database: 'Инвентарь',
  myFiles: 'Мои файлы',
  companyStructure: 'Структура компании',
} as const;

function reportProgress(
  listener: OfflinePreparationProgressListener | undefined,
  event: OfflinePreparationProgressEvent,
): void {
  try {
    listener?.(event);
  } catch {
    // UI reporting must never interrupt cache preparation.
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function uniqueByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function prepareDashboard(userId: number): Promise<PreparationMetric> {
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
  return { loaded: 1, total: 1, unit: 'экран' };
}

async function prepareFeed(userId: number): Promise<PreparationMetric> {
  const request = {
    q: '',
    unread_only: false,
    priority: '',
    bookmarked_only: false,
    category_id: '',
    tag: '',
    limit: FEED_PAGE_SIZE,
    offset: 0,
  };
  let page = await listFeedPosts(request);
  const signature = JSON.stringify({ filter: 'all', q: '', categoryId: '', tag: '' });
  let items = uniqueByKey(page.items, (item) => String(item.id || ''));
  const unreadTotal = Number(page.unread_total || 0);
  let stored = await writeNativeCollectionSnapshot('feed-inbox', userId, signature, {
    signature,
    items,
    total: page.total,
    unreadTotal,
  });
  if (!stored) throw new Error('Лента слишком большая для автономного хранения');

  let nextOffset = Math.max(0, Number(page.offset || 0)) + page.items.length;
  while (items.length < page.total && page.items.length > 0) {
    const requestedOffset = nextOffset;
    const nextPage = await listFeedPosts({ ...request, offset: requestedOffset });
    const nextItems = uniqueByKey([...items, ...nextPage.items], (item) => String(item.id || ''));
    if (nextItems.length <= items.length) break;
    stored = await writeNativeCollectionSnapshot('feed-inbox', userId, signature, {
      signature,
      items: nextItems,
      total: nextPage.total,
      unreadTotal,
    });
    if (!stored) break;
    items = nextItems;
    page = nextPage;
    nextOffset = Math.max(requestedOffset, Number(nextPage.offset ?? requestedOffset)) + nextPage.items.length;
    if (nextOffset <= requestedOffset) break;
    await yieldToEventLoop();
  }
  return { loaded: items.length, total: page.total, unit: 'публикаций', complete: items.length >= page.total };
}

async function prepareTasks(userId: number, isAdmin: boolean): Promise<PreparationMetric> {
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
  let page = await getTasksPage(request);
  const signature = JSON.stringify({ ...request, offset: 0 });
  let items = uniqueByKey(page.items, (item) => String(item.id || ''));
  let stored = await writeNativeCollectionSnapshot('tasks-inbox', userId, signature, {
    signature,
    page: { ...page, items, offset: 0, limit: items.length },
  });
  if (!stored) throw new Error(`Список задач «${viewMode}» слишком большой`);

  let nextOffset = Math.max(0, Number(page.offset || 0)) + page.items.length;
  while (items.length < page.total && page.items.length > 0) {
    const requestedOffset = nextOffset;
    const nextPage = await getTasksPage({ ...request, offset: requestedOffset });
    const nextItems = uniqueByKey([...items, ...nextPage.items], (item) => String(item.id || ''));
    if (nextItems.length <= items.length) break;
    stored = await writeNativeCollectionSnapshot('tasks-inbox', userId, signature, {
      signature,
      page: { ...nextPage, items: nextItems, offset: 0, limit: nextItems.length },
    });
    if (!stored) break;
    items = nextItems;
    page = nextPage;
    nextOffset = Math.max(requestedOffset, Number(nextPage.offset || requestedOffset)) + nextPage.items.length;
    if (nextOffset <= requestedOffset) break;
    await yieldToEventLoop();
  }
  return { loaded: items.length, total: page.total, unit: 'задач', complete: items.length >= page.total };
}

async function prepareChat(userId: number): Promise<PreparationMetric> {
  const [firstPage, folders] = await Promise.all([
    getConversationPage({ limit: CHAT_PAGE_SIZE }),
    listChatFolders(),
  ]);
  let page = {
    ...firstPage,
    items: uniqueByKey(firstPage.items, (item) => String(item.id || '')),
  };
  let [inboxStored, foldersStored] = await Promise.all([
    writeNativeChatInboxSnapshot(userId, page),
    writeNativeSnapshot('chat-folders', userId, folders),
  ]);
  if (!inboxStored || !foldersStored) {
    throw new Error('Не удалось сохранить диалоги для автономного режима');
  }
  const seenCursors = new Set<string>();
  while (page.has_more && page.next_cursor) {
    const cursor = String(page.next_cursor);
    if (seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
    const nextPage = await getConversationPage({ cursor, limit: CHAT_PAGE_SIZE });
    const nextItems = uniqueByKey([...page.items, ...nextPage.items], (item) => String(item.id || ''));
    if (nextItems.length <= page.items.length) break;
    const candidate = { ...nextPage, items: nextItems };
    inboxStored = await writeNativeChatInboxSnapshot(userId, candidate);
    if (!inboxStored) break;
    page = candidate;
    await yieldToEventLoop();
  }
  return {
    loaded: page.items.length,
    total: page.has_more ? undefined : page.items.length,
    unit: 'диалогов',
    complete: page.has_more !== true,
  };
}

async function prepareNotifications(userId: number, includeMail: boolean): Promise<PreparationMetric> {
  const [hub, mail] = await Promise.all([
    pollHubNotifications({ limit: 200, unreadOnly: false }),
    includeMail ? getMailNotificationFeed(50) : Promise.resolve(null),
  ]);
  const stored = await writeNativeSnapshot('notifications', userId, {
    hubItems: hub.items,
    mailItems: mail?.items || [],
    hubUnread: Math.max(0, Number(hub.unread_counts?.notifications_unread_total || 0)),
    mailUnread: Math.max(0, Number(mail?.total_unread || 0)),
  });
  if (!stored) throw new Error('Не удалось сохранить уведомления для автономного режима');
  const loaded = hub.items.length + (mail?.items.length || 0);
  return { loaded, total: loaded, unit: 'уведомлений' };
}

async function prepareMail(userId: number): Promise<PreparationMetric> {
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
  const [firstPage, summary, folderTree, mailboxItems, preferences] = await Promise.all([
    getMailMessages(filters),
    getMailFolderSummary(''),
    getMailFolderTree('').catch(() => ({ items: [] })),
    listMailboxes(true),
    getNativeMailPreferences().catch(() => DEFAULT_NATIVE_MAIL_PREFERENCES),
  ]);
  let page = firstPage;
  let items = page.items.map((value: MailMessagePreview) => ({
    kind: 'message' as const,
    key: `m:${value.id}`,
    value,
  }));
  const signature = JSON.stringify({ ...filters, offset: 0, view: 'messages' });
  const snapshot = () => ({
    signature,
    items,
    total: page.total,
    hasMore: page.has_more,
    summary,
    folderTree: folderTree.items,
    mailboxes: mailboxItems.filter((item) => item.is_active !== false),
    preferences,
  });
  let stored = await writeNativeCollectionSnapshot('mail-inbox', userId, signature, snapshot());
  if (!stored) throw new Error('Список писем слишком большой');

  let nextOffset = Number(page.next_offset ?? (Number(page.offset || 0) + page.items.length));
  while (page.has_more && page.items.length > 0) {
    const requestedOffset = nextOffset;
    if (!Number.isInteger(requestedOffset) || requestedOffset <= 0) break;
    const nextPage = await getMailMessages({ ...filters, offset: requestedOffset });
    const nextItems = uniqueByKey([
      ...items,
      ...nextPage.items.map((value: MailMessagePreview) => ({
        kind: 'message' as const,
        key: `m:${value.id}`,
        value,
      })),
    ], (item) => item.key);
    if (nextItems.length <= items.length) break;
    const previousItems = items;
    const previousPage = page;
    items = nextItems;
    page = nextPage;
    stored = await writeNativeCollectionSnapshot('mail-inbox', userId, signature, snapshot());
    if (!stored) {
      items = previousItems;
      page = previousPage;
      break;
    }
    nextOffset = Number(nextPage.next_offset ?? (Number(nextPage.offset || requestedOffset) + nextPage.items.length));
    if (!Number.isInteger(nextOffset) || nextOffset <= requestedOffset) break;
    await yieldToEventLoop();
  }
  return {
    loaded: items.length,
    total: page.total,
    unit: 'писем',
    complete: page.has_more !== true && items.length >= Number(page.total || 0),
  };
}

async function prepareDocflow(userId: number): Promise<PreparationMetric> {
  const profile = await getDocflowProfile();
  if (!profile.configured) throw new Error('Учётная запись 1С ДО не настроена');
  const signature = JSON.stringify({ scope: 'inbox', query: '' });
  let page = await listDocflowTasks({ scope: 'inbox', q: '', limit: DOCFLOW_PAGE_SIZE, offset: 0 });
  let items = uniqueByKey(page.items, (item) => String(item.ref || ''));
  const snapshot = () => ({
    signature,
    profile,
    result: {
      ...page,
      items,
      returned: items.length,
      offset: 0,
    },
  });
  let stored = await writeNativeCollectionSnapshot('docflow-inbox', userId, signature, snapshot());
  if (!stored) throw new Error('Список заданий 1С ДО слишком большой');
  const seenOffsets = new Set<number>();
  while (page.has_more && page.next_offset != null) {
    const nextOffset = Number(page.next_offset);
    if (!Number.isInteger(nextOffset) || nextOffset <= 0 || seenOffsets.has(nextOffset)) break;
    seenOffsets.add(nextOffset);
    const nextPage = await listDocflowTasks({ scope: 'inbox', q: '', limit: DOCFLOW_PAGE_SIZE, offset: nextOffset });
    const nextItems = uniqueByKey([...items, ...nextPage.items], (item) => String(item.ref || ''));
    if (nextItems.length <= items.length) break;
    const previousItems = items;
    const previousPage = page;
    items = nextItems;
    page = nextPage;
    stored = await writeNativeCollectionSnapshot('docflow-inbox', userId, signature, snapshot());
    if (!stored) {
      items = previousItems;
      page = previousPage;
      break;
    }
    await yieldToEventLoop();
  }
  const total = page.total == null ? undefined : Math.max(items.length, Number(page.total || 0));
  return {
    loaded: items.length,
    total,
    unit: 'заданий',
    complete: page.has_more !== true && page.truncated !== true && (total == null || items.length >= total),
  };
}

async function prepareAddressBook(userId: number): Promise<PreparationMetric> {
  let directory: Awaited<ReturnType<typeof getCompleteAddressBook>>;
  try {
    directory = await getCompleteAddressBook();
  } catch {
    throw new OfflinePreparationStageError(
      'address-book-download',
      'Не удалось скачать адресную книгу',
    );
  }
  if (
    directory.has_more === true
    || !Array.isArray(directory.items)
    || directory.items.length !== Number(directory.total || 0)
  ) {
    throw new OfflinePreparationStageError(
      'address-book-validation',
      'Сервер вернул неполную адресную книгу',
    );
  }
  let stored = false;
  try {
    stored = await writeNativeAddressBookSnapshot(userId, directory);
  } catch {
    stored = false;
  }
  if (!stored) {
    throw new OfflinePreparationStageError(
      'address-book-storage',
      'Не удалось записать защищённый кэш',
    );
  }
  const verified = await readNativeAddressBookSnapshot<typeof directory>(userId).catch(() => null);
  if (
    !verified
    || !Array.isArray(verified.data.items)
    || verified.data.items.length !== directory.items.length
    || Number(verified.data.total || 0) !== Number(directory.total || 0)
  ) {
    throw new OfflinePreparationStageError(
      'address-book-verification',
      'Не удалось проверить сохранённый кэш',
    );
  }
  return { loaded: directory.items.length, total: directory.total, unit: 'сотрудников' };
}

async function prepareDatabase(userId: number): Promise<PreparationMetric> {
  const result = await refreshNativeReadCaches({
    userId,
    permissions: ['database.read'],
    force: true,
  });
  if (result.failed.includes('Инвентарь')) {
    throw new Error('Не удалось сохранить полный каталог инвентаря');
  }
  const coverage = await readNativeOfflineCoverage(userId);
  const metric = coverage?.entries.database;
  return metric
    ? { loaded: metric.loaded, total: metric.total ?? undefined, unit: metric.unit, complete: metric.availableStatus === 'complete' }
    : { loaded: 1, total: 1, unit: 'каталог' };
}

async function prepareMyFiles(userId: number): Promise<PreparationMetric> {
  const [items, quota] = await Promise.all([listMyFiles(), getMyFilesQuota()]);
  const stored = await writeNativeSnapshot<NativeMyFilesInboxSnapshot>('my-files-inbox', userId, {
    items,
    quota,
  });
  if (!stored) throw new Error('Список файлов слишком большой для автономного хранения');
  return { loaded: items.length, total: items.length, unit: 'файлов' };
}

async function prepareCompanyStructure(userId: number): Promise<PreparationMetric> {
  const tree = await getCompanyStructureTree();
  const stored = await writeNativeSnapshot<NativeCompanyStructureTreeSnapshot>(
    'company-structure-tree',
    userId,
    tree,
  );
  if (!stored) throw new Error('Структура компании слишком большая для автономного хранения');
  return { loaded: Number(tree.count || tree.items.length), total: Number(tree.count || tree.items.length), unit: 'узлов' };
}

export async function prepareNativeOfflineData(
  options: PreparationOptions,
  onProgress?: OfflinePreparationProgressListener,
): Promise<PreparationResult> {
  const userId = Number(options.userId || 0);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Authenticated user is required');
  const requested = [
    options.dashboard ? ['dashboard', () => prepareDashboard(userId)] as const : null,
    options.feed ? ['feed', () => prepareFeed(userId)] as const : null,
    options.tasks ? ['tasks', () => prepareTasks(userId, options.isAdmin)] as const : null,
    options.chat ? ['chat', () => prepareChat(userId)] as const : null,
    options.notifications ? ['notifications', () => prepareNotifications(userId, options.mail)] as const : null,
    options.mail ? ['mail', () => prepareMail(userId)] as const : null,
    options.docflow ? ['docflow', () => prepareDocflow(userId)] as const : null,
    options.addressBook ? ['addressBook', () => prepareAddressBook(userId)] as const : null,
    options.database ? ['database', () => prepareDatabase(userId)] as const : null,
    options.myFiles ? ['myFiles', () => prepareMyFiles(userId)] as const : null,
    options.companyStructure ? ['companyStructure', () => prepareCompanyStructure(userId)] as const : null,
  ].filter((item): item is readonly [keyof typeof MODULE_LABELS, () => Promise<PreparationMetric>] => Boolean(item));
  if (requested.length === 0) throw new Error('Нет доступных разделов для автономной подготовки.');

  let completedModules = 0;
  const result: PreparationResult = { preparedModules: [], failedModules: [] };
  for (const [key, prepare] of requested) {
    reportProgress(onProgress, {
      key,
      label: MODULE_LABELS[key],
      status: 'loading',
      completedModules,
      totalModules: requested.length,
    });
    try {
      const metric = await prepare();
      await recordNativeOfflineCoverageSuccess(userId, key, {
        status: metric.complete === false ? 'partial' : 'complete',
        loaded: metric.loaded,
        total: metric.total ?? null,
        unit: metric.unit,
      });
      completedModules += 1;
      reportProgress(onProgress, {
        key,
        label: MODULE_LABELS[key],
        status: 'completed',
        completedModules,
        totalModules: requested.length,
        ...metric,
      });
      result.preparedModules.push(MODULE_LABELS[key]);
    } catch (error) {
      completedModules += 1;
      const failure = error instanceof OfflinePreparationStageError
        ? error
        : new OfflinePreparationStageError(
          `${key}-failed`,
          `Не удалось загрузить раздел «${MODULE_LABELS[key]}»`,
        );
      await recordNativeOfflineCoverageFailure(userId, key, {
        errorCode: failure.code,
        errorMessage: failure.safeMessage,
      });
      reportProgress(onProgress, {
        key,
        label: MODULE_LABELS[key],
        status: 'failed',
        completedModules,
        totalModules: requested.length,
        errorCode: failure.code,
        errorMessage: failure.safeMessage,
      });
      result.failedModules.push(MODULE_LABELS[key]);
    }
  }
  return result;
}
