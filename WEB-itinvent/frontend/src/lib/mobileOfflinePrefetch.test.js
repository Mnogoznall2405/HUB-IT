import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareMobileOfflineData } from './mobileOfflinePrefetch';

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  getTasks: vi.fn(),
  getBootstrap: vi.fn(),
  getState: vi.fn(),
  waitForWrites: vi.fn(),
  getInventory: vi.fn(),
}));

vi.mock('../api/hubDashboard', () => ({ hubDashboardAPI: { getDashboard: mocks.getDashboard } }));
vi.mock('../api/hubTasks', () => ({ hubTasksAPI: { getTasks: mocks.getTasks } }));
vi.mock('../api/mailMessageList', () => ({ mailMessageListAPI: { getBootstrap: mocks.getBootstrap } }));
vi.mock('./mobileOfflineCache', () => ({
  getMobileOfflineState: mocks.getState,
  waitForPendingMobileOfflineCacheWrites: mocks.waitForWrites,
  getMobileOfflineCacheInventory: mocks.getInventory,
}));

describe('mobile offline prefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    mocks.getState.mockReturnValue({ enabled: true, readOnly: false });
    mocks.getDashboard.mockResolvedValue({});
    mocks.getTasks.mockResolvedValue({});
    mocks.getBootstrap.mockResolvedValue({});
    mocks.waitForWrites.mockResolvedValue(undefined);
    mocks.getInventory.mockResolvedValue({
      ready: true,
      modules: ['dashboard', 'mail', 'tasks'],
      moduleDetails: [
        { module: 'dashboard', entryCount: 1, lastSyncAt: Date.now() + 100 },
        { module: 'mail', entryCount: 1, lastSyncAt: Date.now() + 100 },
        { module: 'tasks', entryCount: 1, lastSyncAt: Date.now() + 100 },
      ],
    });
  });

  it('prefetches only permitted read models and waits for encrypted writes', async () => {
    const result = await prepareMobileOfflineData({ dashboard: true, tasks: true, mail: true });

    expect(mocks.getDashboard).toHaveBeenCalledWith({ announcements_limit: 12, tasks_limit: 40 });
    expect(mocks.getTasks).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'my',
      role_scope: 'assignee',
      sort_by: 'updated_at',
      sort_dir: 'desc',
      limit: 150,
      offset: 0,
    }));
    expect(mocks.getBootstrap).toHaveBeenCalledWith({
      limit: 20,
      mailbox_id: undefined,
      refresh: 'auto',
    });
    expect(mocks.waitForWrites).toHaveBeenCalledTimes(1);
    expect(result.preparedModules.map((item) => item.module)).toEqual(['dashboard', 'tasks', 'mail']);
    expect(result.failedModules).toEqual([]);
  });

  it('matches persisted task and mailbox contexts used by the real pages', async () => {
    window.localStorage.setItem('hub.tasks.taskMode', 'board');
    window.sessionStorage.setItem('mail_selected_mailbox_id_v1', 'mailbox-7');

    await prepareMobileOfflineData({ tasks: true, mail: true, tasksManageAll: true });

    expect(mocks.getTasks).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'all',
      role_scope: 'both',
      sort_by: 'status',
      sort_dir: 'asc',
      limit: 150,
    }));
    expect(mocks.getBootstrap).toHaveBeenCalledWith({
      limit: 20,
      mailbox_id: 'mailbox-7',
      refresh: 'auto',
    });
  });

  it('reports a partial result without claiming a failed module was refreshed', async () => {
    mocks.getBootstrap.mockRejectedValue(new Error('mail unavailable'));
    mocks.getInventory.mockResolvedValue({
      ready: true,
      modules: ['tasks'],
      moduleDetails: [{ module: 'tasks', entryCount: 1, lastSyncAt: Date.now() + 100 }],
    });

    const result = await prepareMobileOfflineData({ tasks: true, mail: true });

    expect(result.preparedModules.map((item) => item.module)).toEqual(['tasks']);
    expect(result.failedModules.map((item) => item.module)).toEqual(['mail']);
  });

  it('does not start network work in read-only offline mode', async () => {
    mocks.getState.mockReturnValue({ enabled: true, readOnly: true });

    await expect(prepareMobileOfflineData({ dashboard: true })).rejects
      .toThrow('Подключитесь к HUB-IT');
    expect(mocks.getDashboard).not.toHaveBeenCalled();
  });
});
