import { getHubDashboard } from '../api/hubApi';
import {
  getMailFolderSummary,
  getMailFolderTree,
  getMailMessages,
} from '../api/mailApi';
import { getNativeMailPreferences } from '../api/mailConfigApi';
import { listMailboxes } from '../api/mailMailboxesApi';
import { getMailNotificationFeed, getMailUnreadSnapshot, pollHubNotifications } from '../api/notificationApi';
import { getConversationPage, listChatFolders } from '../api/chatApi';
import { getTasksPage } from '../api/taskApi';
import { getDocflowProfile, listDocflowTasks } from '../api/docflowApi';
import { getCompleteAddressBook } from '../api/addressBookApi';
import { listFeedPosts } from '../api/feedApi';
import { getCurrentDatabase, listAvailableDatabases, listEquipment } from '../api/databaseApi';
import { getMyFilesQuota, listMyFiles } from '../api/myFilesApi';
import { getCompanyStructureTree } from '../api/companyStructureApi';
import { writeNativeCollectionSnapshot, writeNativeSnapshot } from '../cache/nativeSnapshotCache';
import {
  readNativeAddressBookSnapshot,
  writeNativeAddressBookSnapshot,
} from '../cache/nativeAddressBookSnapshot';
import { prepareNativeOfflineData } from './nativeOfflinePreparation';
import { refreshNativeReadCaches } from './nativeReadCacheRefresh';
import { writeNativeChatInboxSnapshot } from '../chat/nativeChatInboxSnapshot';
import {
  readNativeOfflineCoverage,
  recordNativeOfflineCoverageFailure,
  recordNativeOfflineCoverageSuccess,
} from './nativeOfflineCoverage';

jest.mock('../api/hubApi', () => ({ getHubDashboard: jest.fn() }));
jest.mock('../api/taskApi', () => ({ getTasksPage: jest.fn() }));
jest.mock('../api/mailApi', () => ({
  getMailMessages: jest.fn(),
  getMailFolderSummary: jest.fn(),
  getMailFolderTree: jest.fn(),
}));
jest.mock('../api/mailConfigApi', () => ({
  DEFAULT_NATIVE_MAIL_PREFERENCES: {
    reading_pane: 'right',
    density: 'comfortable',
    mark_read_on_select: false,
    show_preview_snippets: true,
    show_favorites_first: true,
  },
  getNativeMailPreferences: jest.fn(),
}));
jest.mock('../api/mailMailboxesApi', () => ({ listMailboxes: jest.fn() }));
jest.mock('../api/notificationApi', () => ({
  getMailUnreadSnapshot: jest.fn(),
  getMailNotificationFeed: jest.fn(),
  pollHubNotifications: jest.fn(),
}));
jest.mock('../api/chatApi', () => ({
  getConversationPage: jest.fn(),
  listChatFolders: jest.fn(),
}));
jest.mock('../api/docflowApi', () => ({
  getDocflowProfile: jest.fn(),
  listDocflowTasks: jest.fn(),
}));
jest.mock('../api/addressBookApi', () => ({ getCompleteAddressBook: jest.fn() }));
jest.mock('../api/feedApi', () => ({ listFeedPosts: jest.fn() }));
jest.mock('../api/databaseApi', () => ({
  getCurrentDatabase: jest.fn(),
  listAvailableDatabases: jest.fn(),
  listEquipment: jest.fn(),
}));
jest.mock('../api/myFilesApi', () => ({
  getMyFilesQuota: jest.fn(),
  listMyFiles: jest.fn(),
}));
jest.mock('../api/companyStructureApi', () => ({ getCompanyStructureTree: jest.fn() }));
jest.mock('../cache/nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(async () => ({ savedAt: 1, data: {} })),
  writeNativeCollectionSnapshot: jest.fn(async () => true),
  writeNativeSnapshot: jest.fn(async () => true),
}));
jest.mock('../cache/nativeAddressBookSnapshot', () => ({
  readNativeAddressBookSnapshot: jest.fn(),
  writeNativeAddressBookSnapshot: jest.fn(async () => true),
}));
jest.mock('./nativeReadCacheRefresh', () => ({
  refreshNativeReadCaches: jest.fn(async () => ({ refreshed: ['Инвентарь'], failed: [] })),
}));
jest.mock('../chat/nativeChatInboxSnapshot', () => ({
  writeNativeChatInboxSnapshot: jest.fn(async () => true),
}));
jest.mock('./nativeOfflineCoverage', () => ({
  readNativeOfflineCoverage: jest.fn(async () => null),
  recordNativeOfflineCoverageSuccess: jest.fn(async () => true),
  recordNativeOfflineCoverageFailure: jest.fn(async () => true),
}));

const mockDashboard = jest.mocked(getHubDashboard);
const mockTasks = jest.mocked(getTasksPage);
const mockMailMessages = jest.mocked(getMailMessages);
const mockMailSummary = jest.mocked(getMailFolderSummary);
const mockMailTree = jest.mocked(getMailFolderTree);
const mockMailboxes = jest.mocked(listMailboxes);
const mockMailPreferences = jest.mocked(getNativeMailPreferences);
const mockMailUnread = jest.mocked(getMailUnreadSnapshot);
const mockMailNotificationFeed = jest.mocked(getMailNotificationFeed);
const mockHubNotifications = jest.mocked(pollHubNotifications);
const mockConversationPage = jest.mocked(getConversationPage);
const mockChatFolders = jest.mocked(listChatFolders);
const mockDocflowProfile = jest.mocked(getDocflowProfile);
const mockDocflowTasks = jest.mocked(listDocflowTasks);
const mockAddressBook = jest.mocked(getCompleteAddressBook);
const mockFeedPosts = jest.mocked(listFeedPosts);
const mockCurrentDatabase = jest.mocked(getCurrentDatabase);
const mockAvailableDatabases = jest.mocked(listAvailableDatabases);
const mockEquipment = jest.mocked(listEquipment);
const mockMyFiles = jest.mocked(listMyFiles);
const mockMyFilesQuota = jest.mocked(getMyFilesQuota);
const mockCompanyStructure = jest.mocked(getCompanyStructureTree);
const mockWriteSnapshot = jest.mocked(writeNativeSnapshot);
const mockWriteCollectionSnapshot = jest.mocked(writeNativeCollectionSnapshot);
const mockWriteAddressBookSnapshot = jest.mocked(writeNativeAddressBookSnapshot);
const mockReadAddressBookSnapshot = jest.mocked(readNativeAddressBookSnapshot);
const mockRefreshNativeReadCaches = jest.mocked(refreshNativeReadCaches);
const mockWriteChatInboxSnapshot = jest.mocked(writeNativeChatInboxSnapshot);
const mockReadCoverage = jest.mocked(readNativeOfflineCoverage);
const mockCoverageSuccess = jest.mocked(recordNativeOfflineCoverageSuccess);
const mockCoverageFailure = jest.mocked(recordNativeOfflineCoverageFailure);

describe('prepareNativeOfflineData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadCoverage.mockResolvedValue(null);
    mockDashboard.mockResolvedValue({ summary: {}, announcements: { items: [], total: 0 } });
    mockTasks.mockResolvedValue({ items: [{ id: 'task-1' }], total: 1, limit: 40, offset: 0 });
    mockMailMessages.mockResolvedValue({
      items: [{ id: 'mail-1', subject: 'Письмо' }],
      folder: 'inbox',
      total: 1,
      limit: 50,
      offset: 0,
      has_more: false,
    });
    mockMailSummary.mockResolvedValue({ inbox: { total: 1, unread: 1 } });
    mockMailTree.mockResolvedValue({ items: [] });
    mockMailboxes.mockResolvedValue([{ id: 'mailbox-1', is_primary: true }]);
    mockMailPreferences.mockResolvedValue({
      reading_pane: 'right',
      density: 'comfortable',
      mark_read_on_select: false,
      show_preview_snippets: true,
      show_favorites_first: true,
    });
    mockMailUnread.mockResolvedValue({ unread_count: 1, state: 'fresh' });
    mockMailNotificationFeed.mockResolvedValue({ items: [], total_unread: 0, limit: 50 });
    mockHubNotifications.mockResolvedValue({
      items: [{ id: 'notification-1', unread: true }],
      unread_counts: { notifications_unread_total: 1 },
      limit: 200,
      unread_only: false,
    });
    mockConversationPage.mockResolvedValue({
      items: [{ id: 'conversation-1', kind: 'direct', title: 'Диалог' }],
      has_more: false,
      next_cursor: null,
    });
    mockChatFolders.mockResolvedValue({
      items: [],
      conversation_ids_by_folder: {},
      folder_unread_counts: {},
    });
    mockDocflowProfile.mockResolvedValue({
      configured: true,
      login: 'ivanov',
      status: 'valid',
      last_error_code: null,
      last_verified_at: null,
      updated_at: null,
    });
    mockDocflowTasks.mockResolvedValue({
      items: [{ ref: 'docflow-1', title: 'Согласовать договор' } as never],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
      scope: 'inbox',
      source: 'live_1c',
      as_of: '2026-08-29T10:00:00+05:00',
      truncated: false,
    });
    mockAddressBook.mockResolvedValue({
      items: [{ full_name: 'Employee' }],
      total: 1,
      has_more: false,
      updated_at: '2026-08-31T10:00:00+05:00',
    });
    mockFeedPosts.mockResolvedValue({
      items: [{ id: 'feed-1', title: 'Новости' } as never],
      total: 1,
      unread_total: 1,
    });
    mockCurrentDatabase.mockResolvedValue({ id: 'ITINVENT', name: 'Основная', locked: false });
    mockAvailableDatabases.mockResolvedValue([{ id: 'ITINVENT', name: 'Основная' }]);
    mockEquipment.mockResolvedValue({
      equipment: [{ inv_no: 'INV-1', model_name: 'OptiPlex' } as never],
      total: 1,
      page: 1,
      pages: 1,
    });
    mockMyFiles.mockResolvedValue([{ id: 'file-1', original_file_name: 'report.pdf' } as never]);
    mockMyFilesQuota.mockResolvedValue({ used_bytes: 1024, limit_bytes: 2048, remaining_bytes: 1024 });
    mockCompanyStructure.mockResolvedValue({ items: [{ id: 'root', title: 'Компания' } as never], count: 1 });
    mockReadAddressBookSnapshot.mockResolvedValue({
      savedAt: Date.now(),
      data: {
        items: [{ full_name: 'Employee' }],
        total: 1,
        has_more: false,
        updated_at: '2026-08-31T10:00:00+05:00',
      },
    });
  });

  it('does not report the address book as prepared when its encrypted snapshot cannot be read back', async () => {
    mockReadAddressBookSnapshot.mockResolvedValueOnce(null);

    await expect(prepareNativeOfflineData({
      userId: 17,
      isAdmin: false,
      dashboard: false,
      feed: false,
      tasks: false,
      mail: false,
      docflow: false,
      addressBook: true,
      database: false,
      myFiles: false,
      companyStructure: false,
    })).resolves.toEqual({
      preparedModules: [],
      failedModules: ['Адресная книга'],
    });
  });

  it('prepares and verifies all 5000 address-book entries', async () => {
    const items = Array.from({ length: 5_000 }, (_, index) => ({
      full_name: `Employee ${index}`,
      employee_code: `E${index}`,
    }));
    const directory = { items, total: items.length, has_more: false };
    mockAddressBook.mockResolvedValueOnce(directory);
    mockReadAddressBookSnapshot.mockResolvedValueOnce({ savedAt: Date.now(), data: directory });
    const onProgress = jest.fn();

    await expect(prepareNativeOfflineData({
      userId: 17,
      isAdmin: false,
      dashboard: false,
      feed: false,
      tasks: false,
      mail: false,
      docflow: false,
      addressBook: true,
      database: false,
      myFiles: false,
      companyStructure: false,
    }, onProgress)).resolves.toEqual({
      preparedModules: ['Адресная книга'],
      failedModules: [],
    });
    expect(mockWriteAddressBookSnapshot).toHaveBeenCalledWith(17, directory);
    expect(onProgress.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({
        key: 'addressBook',
        label: 'Адресная книга',
        status: 'loading',
        completedModules: 0,
        totalModules: 1,
      }),
      expect.objectContaining({
        key: 'addressBook',
        label: 'Адресная книга',
        status: 'completed',
        loaded: 5_000,
        total: 5_000,
        unit: 'сотрудников',
        completedModules: 1,
        totalModules: 1,
      }),
    ]);
  });

  it('does not start the heavy inventory refresh until the address book is stored and verified', async () => {
    let resolveAddressBook: ((value: { items: Array<{ full_name: string }>; total: number; has_more: boolean }) => void) | undefined;
    mockAddressBook.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAddressBook = resolve;
    }));

    const preparation = prepareNativeOfflineData({
      userId: 17,
      isAdmin: false,
      dashboard: false,
      feed: false,
      tasks: false,
      mail: false,
      docflow: false,
      addressBook: true,
      database: true,
      myFiles: false,
      companyStructure: false,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRefreshNativeReadCaches).not.toHaveBeenCalled();
    resolveAddressBook?.({ items: [{ full_name: 'Employee' }], total: 1, has_more: false });
    await preparation;
    expect(mockRefreshNativeReadCaches).toHaveBeenCalledTimes(1);
  });

  it('reports a safe concrete failure stage for address-book download errors', async () => {
    mockAddressBook.mockRejectedValueOnce(new Error('request failed with confidential transport details'));
    const onProgress = jest.fn();

    await expect(prepareNativeOfflineData({
      userId: 17,
      isAdmin: false,
      dashboard: false,
      feed: false,
      tasks: false,
      mail: false,
      docflow: false,
      addressBook: true,
      database: false,
      myFiles: false,
      companyStructure: false,
    }, onProgress)).resolves.toEqual({
      preparedModules: [],
      failedModules: ['Адресная книга'],
    });
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      key: 'addressBook',
      status: 'failed',
      errorCode: 'address-book-download',
      errorMessage: 'Не удалось скачать адресную книгу',
    }));
  });

  it('prepares native dashboard, default task list and inbox snapshots', async () => {
    const result = await prepareNativeOfflineData({
      userId: 17,
      isAdmin: false,
      dashboard: true,
      feed: true,
      tasks: true,
      mail: true,
      docflow: true,
      addressBook: true,
      database: true,
      myFiles: true,
      companyStructure: true,
    });

    expect(result).toEqual({
      preparedModules: ['Главная', 'Лента', 'Задачи', 'Почта', '1С ДО', 'Адресная книга', 'Инвентарь', 'Мои файлы', 'Структура компании'],
      failedModules: [],
    });
    expect(mockTasks).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'my',
      role_scope: 'assignee',
      limit: 200,
      offset: 0,
    }));
    expect(mockMailMessages).toHaveBeenCalledWith(expect.objectContaining({
      folder: 'inbox',
      limit: 200,
      offset: 0,
    }));
    expect(mockWriteSnapshot).toHaveBeenCalledWith('dashboard', 17, expect.objectContaining({
      communicationCounts: expect.objectContaining({ mail: 1 }),
    }));
    expect(mockWriteAddressBookSnapshot).toHaveBeenCalledWith(17, expect.objectContaining({
      items: [{ full_name: 'Employee' }],
      total: 1,
    }));
    expect(mockWriteCollectionSnapshot).toHaveBeenCalledWith('feed-inbox', 17, expect.any(String), expect.objectContaining({
      items: [expect.objectContaining({ id: 'feed-1' })],
      total: 1,
      unreadTotal: 1,
    }));
    expect(mockWriteCollectionSnapshot).toHaveBeenCalledWith('tasks-inbox', 17, expect.any(String), expect.objectContaining({
      signature: expect.any(String),
      page: expect.objectContaining({ total: 1 }),
    }));
    expect(mockWriteCollectionSnapshot).toHaveBeenCalledWith('mail-inbox', 17, expect.any(String), expect.objectContaining({
      signature: expect.any(String),
      items: [{ kind: 'message', key: 'm:mail-1', value: expect.objectContaining({ id: 'mail-1' }) }],
    }));
    expect(mockWriteCollectionSnapshot).toHaveBeenCalledWith('docflow-inbox', 17, expect.any(String), expect.objectContaining({
      result: expect.objectContaining({ returned: 1 }),
    }));
    expect(mockRefreshNativeReadCaches).toHaveBeenCalledWith({
      userId: 17,
      permissions: ['database.read'],
      force: true,
    });
    expect(mockCoverageSuccess).toHaveBeenCalledWith(
      17,
      'addressBook',
      expect.objectContaining({ status: 'complete', loaded: 1, total: 1 }),
    );
    expect(mockWriteSnapshot).toHaveBeenCalledWith('my-files-inbox', 17, {
      items: [expect.objectContaining({ id: 'file-1' })],
      quota: expect.objectContaining({ used_bytes: 1024 }),
    });
    expect(mockWriteSnapshot).toHaveBeenCalledWith('company-structure-tree', 17, {
      items: [expect.objectContaining({ id: 'root' })],
      count: 1,
    });
  });

  it('prepares chat lists and the notification center explicitly', async () => {
    const result = await prepareNativeOfflineData({
      userId: 17,
      isAdmin: false,
      dashboard: false,
      feed: false,
      tasks: false,
      chat: true,
      notifications: true,
      mail: true,
      docflow: false,
      addressBook: false,
      database: false,
      myFiles: false,
      companyStructure: false,
    });

    expect(result).toEqual({
      preparedModules: ['Chat', 'Уведомления', 'Почта'],
      failedModules: [],
    });
    expect(mockConversationPage).toHaveBeenCalledWith({ limit: 200 });
    expect(mockWriteChatInboxSnapshot).toHaveBeenCalledWith(17, expect.objectContaining({
      items: [expect.objectContaining({ id: 'conversation-1' })],
    }));
    expect(mockWriteSnapshot).toHaveBeenCalledWith('chat-folders', 17, expect.any(Object));
    expect(mockWriteSnapshot).toHaveBeenCalledWith('notifications', 17, expect.objectContaining({
      hubItems: [expect.objectContaining({ id: 'notification-1' })],
    }));
  });

  it('keeps paging chat and mail while the encrypted snapshot accepts more data', async () => {
    mockConversationPage
      .mockResolvedValueOnce({
        items: [{ id: 'conversation-1', kind: 'direct', title: 'Первый' }],
        has_more: true,
        next_cursor: 'next-chat-page',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'conversation-2', kind: 'direct', title: 'Второй' }],
        has_more: false,
        next_cursor: null,
      });
    mockMailMessages
      .mockResolvedValueOnce({
        items: [{ id: 'mail-1', subject: 'Первое' }],
        folder: 'inbox',
        total: 2,
        limit: 200,
        offset: 0,
        has_more: true,
        next_offset: 1,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'mail-2', subject: 'Второе' }],
        folder: 'inbox',
        total: 2,
        limit: 200,
        offset: 1,
        has_more: false,
        next_offset: null,
      });

    await expect(prepareNativeOfflineData({
      userId: 17,
      isAdmin: false,
      dashboard: false,
      feed: false,
      tasks: false,
      chat: true,
      notifications: false,
      mail: true,
      docflow: false,
      addressBook: false,
      database: false,
      myFiles: false,
      companyStructure: false,
    })).resolves.toEqual({
      preparedModules: ['Chat', 'Почта'],
      failedModules: [],
    });

    expect(mockConversationPage).toHaveBeenNthCalledWith(1, { limit: 200 });
    expect(mockConversationPage).toHaveBeenNthCalledWith(2, { cursor: 'next-chat-page', limit: 200 });
    expect(mockWriteChatInboxSnapshot).toHaveBeenLastCalledWith(17, expect.objectContaining({
      items: [
        expect.objectContaining({ id: 'conversation-1' }),
        expect.objectContaining({ id: 'conversation-2' }),
      ],
      has_more: false,
    }));
    expect(mockMailMessages).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 1, limit: 200 }));
    expect(mockWriteCollectionSnapshot).toHaveBeenLastCalledWith(
      'mail-inbox',
      17,
      expect.any(String),
      expect.objectContaining({
        items: [
          expect.objectContaining({ key: 'm:mail-1' }),
          expect.objectContaining({ key: 'm:mail-2' }),
        ],
        hasMore: false,
      }),
    );
  });

  it('keeps paging the feed and task list instead of caching only the first screen', async () => {
    mockFeedPosts
      .mockResolvedValueOnce({ items: [{ id: 'feed-1' } as never], total: 2, unread_total: 1 })
      .mockResolvedValueOnce({ items: [{ id: 'feed-2' } as never], total: 2, unread_total: 1 });
    mockTasks
      .mockResolvedValueOnce({ items: [{ id: 'task-1' }], total: 2, limit: 200, offset: 0 })
      .mockResolvedValueOnce({ items: [{ id: 'task-2' }], total: 2, limit: 200, offset: 1 });

    await expect(prepareNativeOfflineData({
      userId: 17,
      isAdmin: false,
      dashboard: false,
      feed: true,
      tasks: true,
      chat: false,
      notifications: false,
      mail: false,
      docflow: false,
      addressBook: false,
      database: false,
      myFiles: false,
      companyStructure: false,
    })).resolves.toEqual({
      preparedModules: ['Лента', 'Задачи'],
      failedModules: [],
    });

    expect(mockFeedPosts).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 1, limit: 200 }));
    expect(mockTasks).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 1, limit: 200 }));
    expect(mockWriteCollectionSnapshot).toHaveBeenCalledWith(
      'feed-inbox',
      17,
      expect.any(String),
      expect.objectContaining({
        items: [expect.objectContaining({ id: 'feed-1' }), expect.objectContaining({ id: 'feed-2' })],
      }),
    );
    expect(mockWriteCollectionSnapshot).toHaveBeenCalledWith(
      'tasks-inbox',
      17,
      expect.any(String),
      expect.objectContaining({
        page: expect.objectContaining({
          items: [expect.objectContaining({ id: 'task-1' }), expect.objectContaining({ id: 'task-2' })],
        }),
      }),
    );
  });

  it('downloads every advertised 1C DO task page before marking the module complete', async () => {
    mockDocflowTasks
      .mockResolvedValueOnce({
        items: [{ ref: 'docflow-1', title: 'Первое' } as never],
        returned: 1,
        offset: 0,
        total: 2,
        has_more: true,
        next_offset: 1,
        scope: 'inbox',
        source: 'live_1c',
        as_of: '2026-09-04T10:00:00+05:00',
        truncated: false,
      })
      .mockResolvedValueOnce({
        items: [{ ref: 'docflow-2', title: 'Второе' } as never],
        returned: 1,
        offset: 1,
        total: 2,
        has_more: false,
        next_offset: null,
        scope: 'inbox',
        source: 'live_1c',
        as_of: '2026-09-04T10:00:01+05:00',
        truncated: false,
      });

    await prepareNativeOfflineData({
      userId: 17,
      isAdmin: false,
      dashboard: false,
      feed: false,
      tasks: false,
      chat: false,
      notifications: false,
      mail: false,
      docflow: true,
      addressBook: false,
      database: false,
      myFiles: false,
      companyStructure: false,
    });

    expect(mockDocflowTasks).toHaveBeenNthCalledWith(1, { scope: 'inbox', q: '', limit: 100, offset: 0 });
    expect(mockDocflowTasks).toHaveBeenNthCalledWith(2, { scope: 'inbox', q: '', limit: 100, offset: 1 });
    expect(mockWriteCollectionSnapshot).toHaveBeenLastCalledWith(
      'docflow-inbox',
      17,
      expect.any(String),
      expect.objectContaining({
        result: expect.objectContaining({
          items: [expect.objectContaining({ ref: 'docflow-1' }), expect.objectContaining({ ref: 'docflow-2' })],
          returned: 2,
        }),
      }),
    );
    expect(mockCoverageSuccess).toHaveBeenCalledWith(
      17,
      'docflow',
      expect.objectContaining({ status: 'complete', loaded: 2, total: 2 }),
    );
  });

  it('keeps successful modules and reports a failed module', async () => {
    mockMailMessages.mockRejectedValueOnce(new Error('mail unavailable'));
    const onProgress = jest.fn();

    await expect(prepareNativeOfflineData({
      userId: 17,
      isAdmin: true,
      dashboard: true,
      feed: true,
      tasks: true,
      mail: true,
      docflow: true,
      addressBook: false,
      database: false,
      myFiles: false,
      companyStructure: false,
    }, onProgress)).resolves.toEqual({
      preparedModules: ['Главная', 'Лента', 'Задачи', '1С ДО'],
      failedModules: ['Почта'],
    });
    expect(mockTasks).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'all',
      role_scope: 'both',
    }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      key: 'mail',
      label: 'Почта',
      status: 'failed',
      totalModules: 5,
    }));
    expect(mockCoverageFailure).toHaveBeenCalledWith(
      17,
      'mail',
      expect.objectContaining({ errorCode: 'mail-failed' }),
    );
  });
});
