import { getHubDashboard } from '../api/hubApi';
import {
  getMailFolderSummary,
  getMailFolderTree,
  getMailMessages,
} from '../api/mailApi';
import { getNativeMailPreferences } from '../api/mailConfigApi';
import { listMailboxes } from '../api/mailMailboxesApi';
import { getMailUnreadSnapshot } from '../api/notificationApi';
import { getTasksPage } from '../api/taskApi';
import { writeNativeSnapshot } from '../cache/nativeSnapshotCache';
import { prepareNativeOfflineData } from './nativeOfflinePreparation';

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
jest.mock('../api/notificationApi', () => ({ getMailUnreadSnapshot: jest.fn() }));
jest.mock('../cache/nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(async () => null),
  writeNativeSnapshot: jest.fn(async () => true),
}));

const mockDashboard = jest.mocked(getHubDashboard);
const mockTasks = jest.mocked(getTasksPage);
const mockMailMessages = jest.mocked(getMailMessages);
const mockMailSummary = jest.mocked(getMailFolderSummary);
const mockMailTree = jest.mocked(getMailFolderTree);
const mockMailboxes = jest.mocked(listMailboxes);
const mockMailPreferences = jest.mocked(getNativeMailPreferences);
const mockMailUnread = jest.mocked(getMailUnreadSnapshot);
const mockWriteSnapshot = jest.mocked(writeNativeSnapshot);

describe('prepareNativeOfflineData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  });

  it('prepares native dashboard, default task list and inbox snapshots', async () => {
    const result = await prepareNativeOfflineData({
      userId: 17,
      isAdmin: false,
      dashboard: true,
      tasks: true,
      mail: true,
    });

    expect(result).toEqual({
      preparedModules: ['Главная', 'Задачи', 'Почта'],
      failedModules: [],
    });
    expect(mockTasks).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'my',
      role_scope: 'assignee',
      limit: 40,
      offset: 0,
    }));
    expect(mockMailMessages).toHaveBeenCalledWith(expect.objectContaining({
      folder: 'inbox',
      limit: 50,
      offset: 0,
    }));
    expect(mockWriteSnapshot).toHaveBeenCalledWith('dashboard', 17, expect.objectContaining({
      communicationCounts: expect.objectContaining({ mail: 1 }),
    }));
    expect(mockWriteSnapshot).toHaveBeenCalledWith('tasks-inbox', 17, expect.objectContaining({
      signature: expect.any(String),
      page: expect.objectContaining({ total: 1 }),
    }));
    expect(mockWriteSnapshot).toHaveBeenCalledWith('mail-inbox', 17, expect.objectContaining({
      signature: expect.any(String),
      items: [{ kind: 'message', key: 'm:mail-1', value: expect.objectContaining({ id: 'mail-1' }) }],
    }));
  });

  it('keeps successful modules and reports a failed module', async () => {
    mockMailMessages.mockRejectedValueOnce(new Error('mail unavailable'));

    await expect(prepareNativeOfflineData({
      userId: 17,
      isAdmin: true,
      dashboard: true,
      tasks: true,
      mail: true,
    })).resolves.toEqual({
      preparedModules: ['Главная', 'Задачи'],
      failedModules: ['Почта'],
    });
    expect(mockTasks).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'all',
      role_scope: 'both',
    }));
  });
});
