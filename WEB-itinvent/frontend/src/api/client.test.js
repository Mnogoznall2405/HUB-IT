import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientMock = {
  get: vi.fn(),
  post: vi.fn(),
  request: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
};

class MockCanceledError extends Error {
  constructor(message) {
    super(message || 'Canceled');
    this.name = 'CanceledError';
    this.code = 'ERR_CANCELED';
  }
}

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => apiClientMock),
    CanceledError: MockCanceledError,
  },
}));

const AUTH_SESSIONS_MODULE = './authSessions.js';
const importAuthSessionsAPI = () => import(AUTH_SESSIONS_MODULE);
const AUTH_TRUSTED_DEVICES_MODULE = './authTrustedDevices.js';
const importAuthTrustedDevicesAPI = () => import(AUTH_TRUSTED_DEVICES_MODULE);
const AUTH_PASSKEY_LOGIN_MODULE = './authPasskeyLogin.js';
const importAuthPasskeyLoginAPI = () => import(AUTH_PASSKEY_LOGIN_MODULE);
const AUTH_PASSWORD_LOGIN_MODULE = './authPasswordLogin.js';
const importAuthPasswordLoginAPI = () => import(AUTH_PASSWORD_LOGIN_MODULE);
const AUTH_ACCOUNT_SECURITY_MODULE = './authAccountSecurity.js';
const importAuthAccountSecurityAPI = () => import(AUTH_ACCOUNT_SECURITY_MODULE);
const AUTH_USER_ADMIN_MODULE = './authUserAdmin.js';
const importAuthUserAdminAPI = () => import(AUTH_USER_ADMIN_MODULE);
const HUB_ANNOUNCEMENTS_MODULE = './hubAnnouncements.js';
const importHubAnnouncementsAPI = () => import(HUB_ANNOUNCEMENTS_MODULE);
const HUB_TASKS_MODULE = './hubTasks.js';
const importHubTasksAPI = () => import(HUB_TASKS_MODULE);
const HUB_TASK_SUPPORT_MODULE = './hubTaskSupport.js';
const importHubTaskSupportAPI = () => import(HUB_TASK_SUPPORT_MODULE);
const HUB_TASK_ANALYTICS_MODULE = './hubTaskAnalytics.js';
const importHubTaskAnalyticsAPI = () => import(HUB_TASK_ANALYTICS_MODULE);
const HUB_TASK_ACTIVITY_MODULE = './hubTaskActivity.js';
const importHubTaskActivityAPI = () => import(HUB_TASK_ACTIVITY_MODULE);
const HUB_TASK_FILES_MODULE = './hubTaskFiles.js';
const importHubTaskFilesAPI = () => import(HUB_TASK_FILES_MODULE);
const HUB_MARKDOWN_MODULE = './hubMarkdown.js';
const importHubMarkdownAPI = () => import(HUB_MARKDOWN_MODULE);
const EQUIPMENT_TRANSFER_ACTS_MODULE = './equipmentTransferActs.js';
const importEquipmentTransferActsAPI = () => import(EQUIPMENT_TRANSFER_ACTS_MODULE);
const EQUIPMENT_COMPUTERS_MODULE = './equipmentComputers.js';
const importEquipmentComputersAPI = () => import(EQUIPMENT_COMPUTERS_MODULE);
const EQUIPMENT_CONSUMABLES_MODULE = './equipmentConsumables.js';
const importEquipmentConsumablesAPI = () => import(EQUIPMENT_CONSUMABLES_MODULE);
const EQUIPMENT_RECORDS_MODULE = './equipmentRecords.js';
const importEquipmentRecordsAPI = () => import(EQUIPMENT_RECORDS_MODULE);
const EQUIPMENT_RECENT_CARDS_MODULE = './equipmentRecentCards.js';
const importEquipmentRecentCardsAPI = () => import(EQUIPMENT_RECENT_CARDS_MODULE);
const EQUIPMENT_SEARCH_MODULE = './equipmentSearch.js';
const importEquipmentSearchAPI = () => import(EQUIPMENT_SEARCH_MODULE);
const EQUIPMENT_DIRECTORIES_MODULE = './equipmentDirectories.js';
const importEquipmentDirectoriesAPI = () => import(EQUIPMENT_DIRECTORIES_MODULE);
const WORKSPACE_DISCOVERY_MODULE = './workspaceDiscovery.js';
const importWorkspaceDiscoveryAPI = () => import(WORKSPACE_DISCOVERY_MODULE);
const MFU_MODULE = './mfu.js';
const importMfuAPI = () => import(MFU_MODULE);
const CHAT_DIRECTORY_MODULE = './chatDirectory.js';
const importChatDirectoryAPI = () => import(CHAT_DIRECTORY_MODULE);
const CHAT_NOTIFICATIONS_MODULE = './chatNotifications.js';
const importChatNotificationsAPI = () => import(CHAT_NOTIFICATIONS_MODULE);
const CHAT_CONVERSATIONS_MODULE = './chatConversations.js';
const importChatConversationsAPI = () => import(CHAT_CONVERSATIONS_MODULE);
const CHAT_CONVERSATION_DETAILS_MODULE = './chatConversationDetails.js';
const importChatConversationDetailsAPI = () => import(CHAT_CONVERSATION_DETAILS_MODULE);
const CHAT_GROUPS_MODULE = './chatGroups.js';
const importChatGroupsAPI = () => import(CHAT_GROUPS_MODULE);
const CHAT_AI_ACTIONS_MODULE = './chatAiActions.js';
const importChatAiActionsAPI = () => import(CHAT_AI_ACTIONS_MODULE);
const CHAT_THREAD_MESSAGES_MODULE = './chatThreadMessages.js';
const importChatThreadMessagesAPI = () => import(CHAT_THREAD_MESSAGES_MODULE);
const CHAT_MESSAGE_SENDING_MODULE = './chatMessageSending.js';
const importChatMessageSendingAPI = () => import(CHAT_MESSAGE_SENDING_MODULE);
const CHAT_ATTACHMENTS_MODULE = './chatAttachments.js';
const importChatAttachmentsAPI = () => import(CHAT_ATTACHMENTS_MODULE);
const CHAT_UPLOAD_SESSIONS_MODULE = './chatUploadSessions.js';
const importChatUploadSessionsAPI = () => import(CHAT_UPLOAD_SESSIONS_MODULE);
const CHAT_FILE_UPLOADS_MODULE = './chatFileUploads.js';
const importChatFileUploadsAPI = () => import(CHAT_FILE_UPLOADS_MODULE);
const MAIL_MAILBOXES_MODULE = './mailMailboxes.js';
const importMailMailboxesAPI = () => import(MAIL_MAILBOXES_MODULE);
const MAIL_FOLDERS_MODULE = './mailFolders.js';
const importMailFoldersAPI = () => import(MAIL_FOLDERS_MODULE);
const MAIL_TEMPLATES_MODULE = './mailTemplates.js';
const importMailTemplatesAPI = () => import(MAIL_TEMPLATES_MODULE);
const MAIL_IT_REQUESTS_MODULE = './mailItRequests.js';
const importMailItRequestsAPI = () => import(MAIL_IT_REQUESTS_MODULE);
const MAIL_CONFIG_MODULE = './mailConfig.js';
const importMailConfigAPI = () => import(MAIL_CONFIG_MODULE);
const MAIL_PREFERENCES_MODULE = './mailPreferences.js';
const importMailPreferencesAPI = () => import(MAIL_PREFERENCES_MODULE);
const MAIL_COMPOSE_MODULE = './mailCompose.js';
const importMailComposeAPI = () => import(MAIL_COMPOSE_MODULE);
const MAIL_MESSAGE_LIST_MODULE = './mailMessageList.js';
const importMailMessageListAPI = () => import(MAIL_MESSAGE_LIST_MODULE);
const MAIL_MESSAGE_DETAIL_MODULE = './mailMessageDetail.js';
const importMailMessageDetailAPI = () => import(MAIL_MESSAGE_DETAIL_MODULE);
const MAIL_MESSAGE_FILES_MODULE = './mailMessageFiles.js';
const importMailMessageFilesAPI = () => import(MAIL_MESSAGE_FILES_MODULE);
const MAIL_MESSAGE_ACTIONS_MODULE = './mailMessageActions.js';
const importMailMessageActionsAPI = () => import(MAIL_MESSAGE_ACTIONS_MODULE);
const MAIL_CONVERSATIONS_MODULE = './mailConversations.js';
const importMailConversationsAPI = () => import(MAIL_CONVERSATIONS_MODULE);
const MAIL_NOTIFICATIONS_MODULE = './mailNotifications.js';
const importMailNotificationsAPI = () => import(MAIL_NOTIFICATIONS_MODULE);
const SCAN_OVERVIEW_MODULE = './scanOverview.js';
const importScanOverviewAPI = () => import(SCAN_OVERVIEW_MODULE);
const SCAN_AGENTS_MODULE = './scanAgents.js';
const importScanAgentsAPI = () => import(SCAN_AGENTS_MODULE);
const SCAN_INCIDENTS_MODULE = './scanIncidents.js';
const importScanIncidentsAPI = () => import(SCAN_INCIDENTS_MODULE);
const SCAN_TASKS_MODULE = './scanTasks.js';
const importScanTasksAPI = () => import(SCAN_TASKS_MODULE);
const SCAN_HOSTS_MODULE = './scanHosts.js';
const importScanHostsAPI = () => import(SCAN_HOSTS_MODULE);

describe('apiClient auth response interceptor', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    apiClientMock.post = vi.fn();
    apiClientMock.request = vi.fn();
    await import('./client');
  });

  const getRejectedHandler = () => {
    const call = apiClientMock.interceptors.response.use.mock.calls.at(-1);
    return call?.[1];
  };

  it('keeps the cached user when the retried scan service request still returns 401', async () => {
    const onAuthRequired = vi.fn();
    window.addEventListener('auth-required', onAuthRequired);
    window.localStorage.setItem('user', JSON.stringify({ id: 1, username: 'user' }));

    const rejectedHandler = getRejectedHandler();
    const error = {
      response: { status: 401 },
      config: { url: '/scan/patterns', _retry: true },
    };

    await expect(rejectedHandler(error)).rejects.toBe(error);

    expect(window.localStorage.getItem('user')).toBe(JSON.stringify({ id: 1, username: 'user' }));
    expect(onAuthRequired).not.toHaveBeenCalled();
    window.removeEventListener('auth-required', onAuthRequired);
  });

  it('still requires auth when refresh fails for an initial scan service 401', async () => {
    const onAuthRequired = vi.fn();
    window.addEventListener('auth-required', onAuthRequired);
    window.localStorage.setItem('user', JSON.stringify({ id: 1, username: 'user' }));
    apiClientMock.post.mockRejectedValueOnce(new Error('refresh failed'));

    const rejectedHandler = getRejectedHandler();
    const error = {
      response: { status: 401 },
      config: { url: '/scan/patterns' },
    };

    await expect(rejectedHandler(error)).rejects.toBe(error);

    expect(window.localStorage.getItem('user')).toBeNull();
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(onAuthRequired.mock.calls[0][0].detail).toEqual({ requestUrl: '/scan/patterns' });
    window.removeEventListener('auth-required', onAuthRequired);
  });
});

describe('equipmentAPI.getAgentComputers', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: [] });
    window.localStorage.clear();
  });

  it('maps supported filter options to backend query params', async () => {
    const { equipmentAPI } = await import('./client');

    await equipmentAPI.getAgentComputers({
      scope: 'all',
      branch: 'РўСЋРјРµРЅСЊ',
      status: 'online',
      outlookStatus: 'warning',
      q: 'petrov',
      changedOnly: true,
      sortBy: 'hostname',
      sortDir: 'desc',
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/inventory/computers', {
      params: {
        scope: 'all',
        branch: 'РўСЋРјРµРЅСЊ',
        status: 'online',
        outlook_status: 'warning',
        q: 'petrov',
        changed_only: true,
        sort_by: 'hostname',
        sort_dir: 'desc',
      },
    });
  });
});

describe('databaseAPI', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn();
    window.localStorage.clear();
  });

  it('loads current database through the dedicated database module', async () => {
    apiClientMock.get.mockResolvedValueOnce({ data: { id: 'ITINVENT' } });
    const { databaseAPI } = await import('./database');

    const result = await databaseAPI.getCurrentDatabase({ force: true });

    expect(result).toEqual({ id: 'ITINVENT' });
    expect(apiClientMock.get).toHaveBeenCalledWith('/database/current');
  });

  it('switches database through the server-owned selection contract', async () => {
    apiClientMock.post.mockResolvedValueOnce({ data: { success: true } });
    const { databaseAPI } = await import('./database');

    const result = await databaseAPI.switchDatabase(' OBJ-ITINVENT ');

    expect(result).toEqual({ success: true });
    expect(apiClientMock.post).toHaveBeenCalledWith('/database/switch', {
      database_id: 'OBJ-ITINVENT',
    });
  });
});

describe('kbAPI', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn();
    apiClientMock.patch = vi.fn();
    apiClientMock.delete = vi.fn();
    window.localStorage.clear();
  });

  it('loads cards through the dedicated KB module', async () => {
    apiClientMock.get.mockResolvedValueOnce({ data: { items: [], total: 0 } });
    const { kbAPI } = await import('./kb');

    const result = await kbAPI.getCards({ q: 'vpn', limit: 25 });

    expect(result).toEqual({ items: [], total: 0 });
    expect(apiClientMock.get).toHaveBeenCalledWith('/kb/cards', {
      params: { q: 'vpn', limit: 25 },
    });
  });

  it('updates cards with encoded identifiers through the dedicated KB module', async () => {
    apiClientMock.patch.mockResolvedValueOnce({ data: { id: 'card 1', title: 'Updated' } });
    const { kbAPI } = await import('./kb');

    const result = await kbAPI.updateCard('card 1', { title: 'Updated' });

    expect(result).toEqual({ id: 'card 1', title: 'Updated' });
    expect(apiClientMock.patch).toHaveBeenCalledWith('/kb/cards/card%201', { title: 'Updated' });
  });
});

describe('equipmentAPI.searchAgentComputers', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { items: [], total: 0 } });
    window.localStorage.clear();
  });

  it('maps fielded search and pagination options to backend query params', async () => {
    const { equipmentAPI } = await import('./client');

    await equipmentAPI.searchAgentComputers({
      scope: 'all',
      branch: 'Tyumen',
      status: 'online',
      outlookStatus: 'warning',
      q: 'archive.pst',
      searchFields: ['profiles', 'outlook'],
      changedOnly: true,
      sortBy: 'hostname',
      sortDir: 'desc',
      limit: 50,
      offset: 100,
      includeSummary: true,
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/inventory/computers/search', {
      params: {
        scope: 'all',
        branch: 'Tyumen',
        status: 'online',
        outlook_status: 'warning',
        q: 'archive.pst',
        search_fields: 'profiles,outlook',
        changed_only: true,
        sort_by: 'hostname',
        sort_dir: 'desc',
        limit: 50,
        offset: 100,
        include_summary: true,
      },
    });
  });
});

describe('equipmentComputersAPI contract', () => {
  const equipmentComputerMethods = [
    'getAgentComputers',
    'searchAgentComputers',
    'getAgentComputerChanges',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: [] });
    window.localStorage.clear();
  });

  it('maps supported inventory computer filters to the current backend query params', async () => {
    const { equipmentComputersAPI } = await importEquipmentComputersAPI();
    apiClientMock.get.mockResolvedValueOnce({
      data: [{ hostname: 'PC-01' }],
    });

    await expect(equipmentComputersAPI.getAgentComputers({
      scope: 'all',
      branch: 'Tyumen',
      status: 'online',
      outlookStatus: 'warning',
      q: 'petrov',
      changedOnly: true,
      sortBy: 'hostname',
      sortDir: 'desc',
    })).resolves.toEqual([{ hostname: 'PC-01' }]);

    expect(apiClientMock.get).toHaveBeenCalledWith('/inventory/computers', {
      params: {
        scope: 'all',
        branch: 'Tyumen',
        status: 'online',
        outlook_status: 'warning',
        q: 'petrov',
        changed_only: true,
        sort_by: 'hostname',
        sort_dir: 'desc',
      },
    });
  });

  it('maps fielded search and pagination options to the current search endpoint contract', async () => {
    const { equipmentComputersAPI } = await importEquipmentComputersAPI();
    apiClientMock.get.mockResolvedValueOnce({
      data: { items: [{ hostname: 'PC-02' }], total: 1 },
    });

    await expect(equipmentComputersAPI.searchAgentComputers({
      scope: 'all',
      branch: 'Tyumen',
      status: 'online',
      outlookStatus: 'warning',
      q: 'archive.pst',
      searchFields: ['profiles', 'outlook'],
      changedOnly: true,
      sortBy: 'hostname',
      sortDir: 'desc',
      limit: 50,
      offset: 100,
      includeSummary: true,
    })).resolves.toEqual({ items: [{ hostname: 'PC-02' }], total: 1 });

    expect(apiClientMock.get).toHaveBeenCalledWith('/inventory/computers/search', {
      params: {
        scope: 'all',
        branch: 'Tyumen',
        status: 'online',
        outlook_status: 'warning',
        q: 'archive.pst',
        search_fields: 'profiles,outlook',
        changed_only: true,
        sort_by: 'hostname',
        sort_dir: 'desc',
        limit: 50,
        offset: 100,
        include_summary: true,
      },
    });
  });

  it('loads inventory changes from the current endpoint and returns response data', async () => {
    const { equipmentComputersAPI } = await importEquipmentComputersAPI();
    apiClientMock.get.mockResolvedValueOnce({
      data: { changes: [{ hostname: 'PC-03', field: 'ram' }] },
    });

    await expect(equipmentComputersAPI.getAgentComputerChanges(75)).resolves.toEqual({
      changes: [{ hostname: 'PC-03', field: 'ram' }],
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/inventory/changes', {
      params: { limit: 75 },
    });
  });

  it('keeps client equipment computers compatibility through the dedicated module and getters', async () => {
    const { equipmentComputersAPI } = await importEquipmentComputersAPI();
    const {
      equipmentAPI,
      equipmentComputersAPI: clientEquipmentComputersAPI,
    } = await import('./client');

    expect(clientEquipmentComputersAPI).toBe(equipmentComputersAPI);
    equipmentComputerMethods.forEach((methodName) => {
      expect(equipmentAPI[methodName]).toBe(equipmentComputersAPI[methodName]);
    });
  });

  it('resolves equipmentAPI computer methods through the dedicated module getters', async () => {
    const { equipmentComputersAPI } = await importEquipmentComputersAPI();
    const { equipmentAPI } = await import('./client');
    const options = { q: 'pc-04', limit: 10 };
    const spy = vi.spyOn(equipmentComputersAPI, 'searchAgentComputers')
      .mockResolvedValue({ items: [], total: 0 });

    await expect(equipmentAPI.searchAgentComputers(options)).resolves.toEqual({ items: [], total: 0 });

    expect(spy).toHaveBeenCalledWith(options);
    spy.mockRestore();
  });
});

describe('equipmentConsumablesAPI contract', () => {
  const equipmentConsumableMethods = [
    'getAllConsumablesGrouped',
    'createConsumable',
    'lookupConsumables',
    'consumeConsumable',
    'updateConsumableQty',
    'deleteConsumable',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.patch = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.get.mockResolvedValue({ data: { grouped: {} } });
    window.localStorage.clear();
  });

  it('loads grouped consumables through the dedicated module', async () => {
    const { equipmentConsumablesAPI } = await importEquipmentConsumablesAPI();
    apiClientMock.get.mockResolvedValueOnce({
      data: { grouped: { cartridges: [{ inv_no: 'C-1' }] } },
    });

    await expect(equipmentConsumablesAPI.getAllConsumablesGrouped({
      page: 3,
      limit: 25,
    })).resolves.toEqual({ grouped: { cartridges: [{ inv_no: 'C-1' }] } });

    expect(apiClientMock.get).toHaveBeenCalledWith('/equipment/consumables-grouped', {
      params: { page: 3, limit: 25 },
    });
  });

  it('creates consumables and posts quantity mutations through the dedicated module', async () => {
    const { equipmentConsumablesAPI } = await importEquipmentConsumablesAPI();
    const createPayload = { name: 'Toner', qty: 2 };
    const consumePayload = { inv_no: 'C-1', quantity: 1 };
    const qtyPayload = { inv_no: 'C-1', quantity: 4 };

    await expect(equipmentConsumablesAPI.createConsumable(createPayload)).resolves.toEqual({ ok: true });
    await expect(equipmentConsumablesAPI.consumeConsumable(consumePayload)).resolves.toEqual({ ok: true });
    await expect(equipmentConsumablesAPI.updateConsumableQty(qtyPayload)).resolves.toEqual({ ok: true });
    await expect(equipmentConsumablesAPI.deleteConsumable(77)).resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/equipment/consumables/create', createPayload);
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/equipment/consumables/consume', consumePayload);
    expect(apiClientMock.patch).toHaveBeenCalledWith('/equipment/consumables/qty', qtyPayload);
    expect(apiClientMock.delete).toHaveBeenCalledWith('/equipment/consumables/77');
  });

  it('passes lookup params through to the consumables lookup endpoint', async () => {
    const { equipmentConsumablesAPI } = await importEquipmentConsumablesAPI();
    const params = {
      q: 'toner',
      type_no: 4,
      branch_no: 17,
      include_components: true,
    };
    apiClientMock.get.mockResolvedValueOnce({
      data: [{ inv_no: 'C-2', name: 'Toner cartridge' }],
    });

    await expect(equipmentConsumablesAPI.lookupConsumables(params)).resolves.toEqual([
      { inv_no: 'C-2', name: 'Toner cartridge' },
    ]);

    expect(apiClientMock.get).toHaveBeenCalledWith('/equipment/consumables/lookup', { params });
  });

  it('keeps client equipment consumables compatibility through the dedicated module and getters', async () => {
    const { equipmentConsumablesAPI } = await importEquipmentConsumablesAPI();
    const {
      equipmentAPI,
      equipmentConsumablesAPI: clientEquipmentConsumablesAPI,
    } = await import('./client');

    expect(clientEquipmentConsumablesAPI).toBe(equipmentConsumablesAPI);
    equipmentConsumableMethods.forEach((methodName) => {
      expect(equipmentAPI[methodName]).toBe(equipmentConsumablesAPI[methodName]);
    });
  });

  it('resolves equipmentAPI consumable methods through the dedicated module getters', async () => {
    const { equipmentConsumablesAPI } = await importEquipmentConsumablesAPI();
    const { equipmentAPI } = await import('./client');
    const params = { q: 'cartridge' };
    const spy = vi.spyOn(equipmentConsumablesAPI, 'lookupConsumables')
      .mockResolvedValue([{ inv_no: 'C-3' }]);

    await expect(equipmentAPI.lookupConsumables(params)).resolves.toEqual([{ inv_no: 'C-3' }]);

    expect(spy).toHaveBeenCalledWith(params);
    spy.mockRestore();
  });
});

describe('equipmentRecordsAPI contract', () => {
  const equipmentRecordMethods = [
    'getByInvNo',
    'getEquipmentHistory',
    'getAllEquipment',
    'getAllEquipmentGrouped',
    'getByInvNos',
    'createEquipment',
    'updateByInvNo',
    'deleteByInvNo',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.patch = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.get.mockResolvedValue({ data: { items: [] } });
    window.localStorage.clear();
  });

  it('loads equipment records and movement history with encoded inventory routes', async () => {
    const { equipmentRecordsAPI } = await importEquipmentRecordsAPI();
    apiClientMock.get
      .mockResolvedValueOnce({ data: { inv_no: 'INV/100 A' } })
      .mockResolvedValueOnce({ data: { history: [{ action: 'move' }] } });

    await expect(equipmentRecordsAPI.getByInvNo('INV/100 A')).resolves.toEqual({
      inv_no: 'INV/100 A',
    });
    await expect(equipmentRecordsAPI.getEquipmentHistory('INV/100 A')).resolves.toEqual({
      history: [{ action: 'move' }],
    });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/equipment/INV%2F100%20A');
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/equipment/INV%2F100%20A/history');
  });

  it('loads equipment record collections with current pagination and branch params', async () => {
    const { equipmentRecordsAPI } = await importEquipmentRecordsAPI();
    apiClientMock.get
      .mockResolvedValueOnce({ data: { items: [{ inv_no: '1001' }], total: 1 } })
      .mockResolvedValueOnce({ data: { grouped: { HQ: [{ inv_no: '1002' }] } } })
      .mockResolvedValueOnce({ data: { grouped: {} } });

    await expect(equipmentRecordsAPI.getAllEquipment(2, 25)).resolves.toEqual({
      items: [{ inv_no: '1001' }],
      total: 1,
    });
    await expect(equipmentRecordsAPI.getAllEquipmentGrouped({
      page: 3,
      limit: 50,
      branch: 'HQ',
    })).resolves.toEqual({ grouped: { HQ: [{ inv_no: '1002' }] } });
    await expect(equipmentRecordsAPI.getAllEquipmentGrouped({
      page: 1,
      limit: 10,
      branch: '',
    })).resolves.toEqual({ grouped: {} });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/equipment/database', {
      params: { page: 2, limit: 25 },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/equipment/all-grouped', {
      params: { page: 3, limit: 50, branch: 'HQ' },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(3, '/equipment/all-grouped', {
      params: { page: 1, limit: 10, branch: undefined },
    });
  });

  it('posts batch inventory lookups and create payloads with current normalization', async () => {
    const { equipmentRecordsAPI } = await importEquipmentRecordsAPI();
    const createPayload = { inv_no: '1001', serial_no: 'SN-1' };

    await expect(equipmentRecordsAPI.getByInvNos(['1001', 'INV/100 A'])).resolves.toEqual({ ok: true });
    await expect(equipmentRecordsAPI.getByInvNos('1001')).resolves.toEqual({ ok: true });
    await expect(equipmentRecordsAPI.createEquipment(createPayload)).resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/equipment/by-inv-nos', {
      inv_nos: ['1001', 'INV/100 A'],
    });
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/equipment/by-inv-nos', {
      inv_nos: [],
    });
    expect(apiClientMock.post).toHaveBeenNthCalledWith(3, '/equipment/create', createPayload);
  });

  it('updates and deletes equipment records through the legacy unencoded inventory routes', async () => {
    const { equipmentRecordsAPI } = await importEquipmentRecordsAPI();
    const payload = { serial_no: 'SN-2' };

    await expect(equipmentRecordsAPI.updateByInvNo('INV/100 A', payload)).resolves.toEqual({ ok: true });
    await expect(equipmentRecordsAPI.deleteByInvNo('INV/100 A')).resolves.toEqual({ ok: true });

    expect(apiClientMock.patch).toHaveBeenCalledWith('/equipment/INV/100 A', payload);
    expect(apiClientMock.delete).toHaveBeenCalledWith('/equipment/INV/100 A');
  });

  it('keeps client equipment records compatibility through the dedicated module and getters', async () => {
    const { equipmentRecordsAPI } = await importEquipmentRecordsAPI();
    const {
      equipmentAPI,
      equipmentRecordsAPI: clientEquipmentRecordsAPI,
    } = await import('./client');

    expect(clientEquipmentRecordsAPI).toBe(equipmentRecordsAPI);
    equipmentRecordMethods.forEach((methodName) => {
      expect(equipmentAPI[methodName]).toBe(equipmentRecordsAPI[methodName]);
    });
  });

  it('resolves equipmentAPI record methods through the dedicated module getters', async () => {
    const { equipmentRecordsAPI } = await importEquipmentRecordsAPI();
    const { equipmentAPI } = await import('./client');
    const payload = { serial_no: 'SN-3' };
    const spy = vi.spyOn(equipmentRecordsAPI, 'updateByInvNo')
      .mockResolvedValue({ inv_no: '1001', serial_no: 'SN-3' });

    await expect(equipmentAPI.updateByInvNo('1001', payload)).resolves.toEqual({
      inv_no: '1001',
      serial_no: 'SN-3',
    });

    expect(spy).toHaveBeenCalledWith('1001', payload);
    spy.mockRestore();
  });
});

describe('equipmentRecentCardsAPI contract', () => {
  const equipmentRecentCardMethods = [
    'getRecentCards',
    'touchRecentCard',
    'removeRecentCard',
    'clearRecentCards',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.get.mockResolvedValue({ data: { items: [] } });
    window.localStorage.clear();
  });

  it('loads recent cards and posts touch events through the dedicated module', async () => {
    const { equipmentRecentCardsAPI } = await importEquipmentRecentCardsAPI();
    const snapshot = { MODEL_NAME: 'OptiPlex' };

    await expect(equipmentRecentCardsAPI.getRecentCards({ limit: 4 })).resolves.toEqual({ items: [] });
    await expect(equipmentRecentCardsAPI.touchRecentCard({
      invNo: 'INV/100 A',
      actionType: 'view',
      snapshot,
    })).resolves.toEqual({ ok: true });

    expect(apiClientMock.get).toHaveBeenCalledWith('/equipment/recent-cards', {
      params: { limit: 4 },
    });
    expect(apiClientMock.post).toHaveBeenCalledWith('/equipment/recent-cards/touch', {
      inv_no: 'INV/100 A',
      action_type: 'view',
      snapshot,
    });
  });

  it('removes and clears recent cards through encoded recent routes', async () => {
    const { equipmentRecentCardsAPI } = await importEquipmentRecentCardsAPI();

    await expect(equipmentRecentCardsAPI.removeRecentCard('INV/100 A')).resolves.toEqual({ ok: true });
    await expect(equipmentRecentCardsAPI.clearRecentCards()).resolves.toEqual({ ok: true });

    expect(apiClientMock.delete).toHaveBeenNthCalledWith(1, '/equipment/recent-cards/INV%2F100%20A');
    expect(apiClientMock.delete).toHaveBeenNthCalledWith(2, '/equipment/recent-cards');
  });

  it('keeps client equipment recent cards compatibility through the dedicated module and getters', async () => {
    const { equipmentRecentCardsAPI } = await importEquipmentRecentCardsAPI();
    const {
      equipmentAPI,
      equipmentRecentCardsAPI: clientEquipmentRecentCardsAPI,
    } = await import('./client');

    expect(clientEquipmentRecentCardsAPI).toBe(equipmentRecentCardsAPI);
    equipmentRecentCardMethods.forEach((methodName) => {
      expect(equipmentAPI[methodName]).toBe(equipmentRecentCardsAPI[methodName]);
    });
  });
});

describe('equipmentSearchAPI contract', () => {
  const equipmentSearchMethods = [
    'searchBySerial',
    'searchUniversal',
    'searchByEmployee',
    'getEmployeeEquipment',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { ok: true } });
  });

  it('loads equipment serial search with current query params', async () => {
    const { equipmentSearchAPI } = await importEquipmentSearchAPI();

    await expect(equipmentSearchAPI.searchBySerial('SN/100 A')).resolves.toEqual({ ok: true });

    expect(apiClientMock.get).toHaveBeenCalledWith('/equipment/search/serial', {
      params: { q: 'SN/100 A' },
    });
  });

  it('loads universal search with explicit and default pagination params', async () => {
    const { equipmentSearchAPI } = await importEquipmentSearchAPI();

    await expect(equipmentSearchAPI.searchUniversal('printer', 3, 25)).resolves.toEqual({ ok: true });
    await expect(equipmentSearchAPI.searchUniversal('router')).resolves.toEqual({ ok: true });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/equipment/search/universal', {
      params: { q: 'printer', page: 3, limit: 25 },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/equipment/search/universal', {
      params: { q: 'router', page: 1, limit: 50 },
    });
  });

  it('loads employee search and employee equipment with current params and route construction', async () => {
    const { equipmentSearchAPI } = await importEquipmentSearchAPI();

    await expect(equipmentSearchAPI.searchByEmployee('Ivan', 4, 20)).resolves.toEqual({ ok: true });
    await expect(equipmentSearchAPI.searchByEmployee('Petrov')).resolves.toEqual({ ok: true });
    await expect(equipmentSearchAPI.getEmployeeEquipment('OWN/42 A')).resolves.toEqual({ ok: true });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/equipment/search/employee', {
      params: { q: 'Ivan', page: 4, limit: 20 },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/equipment/search/employee', {
      params: { q: 'Petrov', page: 1, limit: 50 },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(3, '/equipment/employee/OWN/42 A/items', {
      params: {
        all_databases: undefined,
        employee_name: undefined,
      },
    });
  });

  it('keeps client equipment search compatibility through the dedicated module and getters', async () => {
    const { equipmentSearchAPI } = await importEquipmentSearchAPI();
    const {
      equipmentAPI,
      equipmentSearchAPI: clientEquipmentSearchAPI,
    } = await import('./client');

    expect(clientEquipmentSearchAPI).toBe(equipmentSearchAPI);
    equipmentSearchMethods.forEach((methodName) => {
      expect(equipmentAPI[methodName]).toBe(equipmentSearchAPI[methodName]);
    });
  });

  it('resolves equipmentAPI search methods through the dedicated module getters', async () => {
    const { equipmentSearchAPI } = await importEquipmentSearchAPI();
    const { equipmentAPI } = await import('./client');
    const spy = vi.spyOn(equipmentSearchAPI, 'searchUniversal')
      .mockResolvedValue({ items: [{ inv_no: '1001' }] });

    await expect(equipmentAPI.searchUniversal('printer', 2, 10)).resolves.toEqual({
      items: [{ inv_no: '1001' }],
    });

    expect(spy).toHaveBeenCalledWith('printer', 2, 10);
    spy.mockRestore();
  });
});

describe('equipmentDirectoriesAPI contract', () => {
  const equipmentDirectoryMethods = [
    'getBranches',
    'getBranchesList',
    'getLocations',
    'getTypes',
    'getModels',
    'getStatuses',
    'searchOwners',
    'getOwnerDepartments',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { ok: true } });
  });

  it('loads branch, type, and status directories through their current endpoints', async () => {
    const { equipmentDirectoriesAPI } = await importEquipmentDirectoriesAPI();

    await expect(equipmentDirectoriesAPI.getBranches()).resolves.toEqual({ ok: true });
    await expect(equipmentDirectoriesAPI.getBranchesList()).resolves.toEqual({ ok: true });
    await expect(equipmentDirectoriesAPI.getTypes()).resolves.toEqual({ ok: true });
    await expect(equipmentDirectoriesAPI.getStatuses()).resolves.toEqual({ ok: true });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/equipment/branches');
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/equipment/branches-list');
    expect(apiClientMock.get).toHaveBeenNthCalledWith(3, '/equipment/types');
    expect(apiClientMock.get).toHaveBeenNthCalledWith(4, '/equipment/statuses');
  });

  it('preserves location branch param normalization and passthrough values', async () => {
    const { equipmentDirectoriesAPI } = await importEquipmentDirectoriesAPI();

    await equipmentDirectoriesAPI.getLocations();
    await equipmentDirectoriesAPI.getLocations(null);
    await equipmentDirectoriesAPI.getLocations('   ');
    await equipmentDirectoriesAPI.getLocations(' 17 ');

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/equipment/locations', {
      params: {},
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/equipment/locations', {
      params: {},
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(3, '/equipment/locations', {
      params: {},
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(4, '/equipment/locations', {
      params: { branch_no: ' 17 ' },
    });
  });

  it('loads model and owner directories with current defaults and argument passthrough', async () => {
    const { equipmentDirectoriesAPI } = await importEquipmentDirectoriesAPI();

    await equipmentDirectoriesAPI.getModels('5');
    await equipmentDirectoriesAPI.getModels('6', 4);
    await equipmentDirectoriesAPI.searchOwners('Ivan');
    await equipmentDirectoriesAPI.searchOwners('Petrov', '7');
    await equipmentDirectoriesAPI.getOwnerDepartments();
    await equipmentDirectoriesAPI.getOwnerDepartments('1000');

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/equipment/models', {
      params: { type_no: '5', ci_type: 1 },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/equipment/models', {
      params: { type_no: '6', ci_type: 4 },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(3, '/equipment/owners/search', {
      params: { q: 'Ivan', limit: 20 },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(4, '/equipment/owners/search', {
      params: { q: 'Petrov', limit: '7' },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(5, '/equipment/owners/departments', {
      params: { limit: 500 },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(6, '/equipment/owners/departments', {
      params: { limit: '1000' },
    });
  });

  it('keeps client equipment directories compatibility through the dedicated module and getters', async () => {
    const { equipmentDirectoriesAPI } = await importEquipmentDirectoriesAPI();
    const {
      equipmentAPI,
      equipmentDirectoriesAPI: clientEquipmentDirectoriesAPI,
    } = await import('./client');

    expect(clientEquipmentDirectoriesAPI).toBe(equipmentDirectoriesAPI);
    equipmentDirectoryMethods.forEach((methodName) => {
      expect(equipmentAPI[methodName]).toBe(equipmentDirectoriesAPI[methodName]);
    });
  });

  it('resolves equipmentAPI directory methods through the dedicated module getters', async () => {
    const { equipmentDirectoriesAPI } = await importEquipmentDirectoriesAPI();
    const { equipmentAPI } = await import('./client');
    const spy = vi.spyOn(equipmentDirectoriesAPI, 'getModels')
      .mockResolvedValue({ models: [{ model_no: 7 }] });

    await expect(equipmentAPI.getModels('5', 4)).resolves.toEqual({
      models: [{ model_no: 7 }],
    });

    expect(spy).toHaveBeenCalledWith('5', 4);
    spy.mockRestore();
  });
});

describe('workspaceDiscoveryAPI contract', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({
      data: {
        success: true,
        owner_info: { owner_name: 'Ivan Petrov' },
      },
    });
  });

  it('loads the current workspace identity through the discovery endpoint', async () => {
    const { workspaceDiscoveryAPI } = await importWorkspaceDiscoveryAPI();

    await expect(workspaceDiscoveryAPI.identifyWorkspace()).resolves.toEqual({
      success: true,
      owner_info: { owner_name: 'Ivan Petrov' },
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/discovery/identify-workspace');
  });

  it('keeps client workspace discovery compatibility through the dedicated module and equipment getter', async () => {
    const { workspaceDiscoveryAPI } = await importWorkspaceDiscoveryAPI();
    const {
      equipmentAPI,
      workspaceDiscoveryAPI: clientWorkspaceDiscoveryAPI,
    } = await import('./client');

    expect(clientWorkspaceDiscoveryAPI).toBe(workspaceDiscoveryAPI);
    expect(equipmentAPI.identifyWorkspace).toBe(workspaceDiscoveryAPI.identifyWorkspace);
  });

  it('resolves equipmentAPI identifyWorkspace through the dedicated module getter', async () => {
    const { workspaceDiscoveryAPI } = await importWorkspaceDiscoveryAPI();
    const { equipmentAPI } = await import('./client');
    const spy = vi.spyOn(workspaceDiscoveryAPI, 'identifyWorkspace')
      .mockResolvedValue({ success: true, message: 'detected' });

    await expect(equipmentAPI.identifyWorkspace()).resolves.toEqual({
      success: true,
      message: 'detected',
    });

    expect(spy).toHaveBeenCalledWith();
    spy.mockRestore();
  });
});

describe('equipmentAPI.getLocations', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: [] });
  });

  it('loads the global LOCATIONS directory without branch params', async () => {
    const { equipmentAPI } = await import('./client');

    await equipmentAPI.getLocations();

    expect(apiClientMock.get).toHaveBeenCalledWith('/equipment/locations', {
      params: {},
    });
  });

  it('sends branch_no to get prioritized ordering for the selected branch', async () => {
    const { equipmentAPI } = await import('./client');

    await equipmentAPI.getLocations(17);

    expect(apiClientMock.get).toHaveBeenCalledWith('/equipment/locations', {
      params: { branch_no: 17 },
    });
  });
});

describe('equipmentAPI.deleteByInvNo', () => {
  beforeEach(() => {
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { success: true } });
  });

  it('calls backend delete endpoint for one equipment card', async () => {
    const { equipmentAPI } = await import('./client');

    await equipmentAPI.deleteByInvNo('1001');

    expect(apiClientMock.delete).toHaveBeenCalledWith('/equipment/1001');
  });
});

describe('equipmentAPI.getTransferReminder', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { reminder_id: 'rem-1' } });
  });

  it('loads persistent transfer reminder payload by reminder id', async () => {
    const { equipmentAPI } = await import('./client');

    await equipmentAPI.getTransferReminder('rem-1');

    expect(apiClientMock.get).toHaveBeenCalledWith('/equipment/transfer/reminders/rem-1');
  });
});

describe('equipmentAPI.createTransferActOnly', () => {
  beforeEach(() => {
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { acts: [] } });
  });

  it('calls backend act-only endpoint without moving equipment', async () => {
    const { equipmentAPI } = await import('./client');
    const payload = { inv_nos: ['1001'], issuer_employee: 'Без владельца' };

    await equipmentAPI.createTransferActOnly(payload);

    expect(apiClientMock.post).toHaveBeenCalledWith('/equipment/transfer/act-only', payload);
  });
});

describe('equipmentAPI.getTransferActJob', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { job_id: 'job-1', job_status: 'done' } });
  });

  it('polls transfer act background job status', async () => {
    const { equipmentAPI } = await import('./client');

    await equipmentAPI.getTransferActJob('job-1');

    expect(apiClientMock.get).toHaveBeenCalledWith('/equipment/transfer/act-jobs/job-1');
  });
});

describe('equipmentTransferActsAPI contract', () => {
  const transferActMethods = [
    'getEquipmentActs',
    'downloadEquipmentActFile',
    'parseUploadedAct',
    'getUploadedActDraft',
    'getTransferReminder',
    'commitUploadedActDraft',
    'sendUploadedActEmail',
    'transfer',
    'transferLocation',
    'createTransferActOnly',
    'getTransferActJob',
    'sendTransferActsEmail',
    'downloadTransferAct',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.get.mockResolvedValue({ data: { ok: true } });
    window.localStorage.clear();
  });

  it('parses uploaded acts as multipart FormData with optional manual_mode and the long timeout', async () => {
    const { equipmentTransferActsAPI } = await importEquipmentTransferActsAPI();
    const { UPLOADED_ACT_PARSE_TIMEOUT_MS } = await import('./client');
    const file = new File(['pdf'], 'act.pdf', { type: 'application/pdf' });

    await equipmentTransferActsAPI.parseUploadedAct(file);
    await equipmentTransferActsAPI.parseUploadedAct(file, { manualMode: true });

    expect(apiClientMock.post).toHaveBeenCalledTimes(2);
    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      1,
      '/equipment/acts/upload/parse',
      expect.any(FormData),
      {
        params: undefined,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: UPLOADED_ACT_PARSE_TIMEOUT_MS,
      },
    );
    expect(apiClientMock.post.mock.calls[0][1].get('file')).toBe(file);
    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      2,
      '/equipment/acts/upload/parse',
      expect.any(FormData),
      expect.objectContaining({
        params: { manual_mode: true },
        timeout: UPLOADED_ACT_PARSE_TIMEOUT_MS,
      }),
    );
    expect(apiClientMock.post.mock.calls[1][1].get('file')).toBe(file);
    expect(UPLOADED_ACT_PARSE_TIMEOUT_MS).toBe(180000);
  });

  it('returns raw blob responses for downloads and preserves current unencoded download ids', async () => {
    const { equipmentTransferActsAPI } = await importEquipmentTransferActsAPI();
    const actFileResponse = { data: new Blob(['act']), headers: { 'content-type': 'application/pdf' } };
    const transferActResponse = { data: new Blob(['transfer']), headers: { 'content-type': 'application/pdf' } };
    apiClientMock.get
      .mockResolvedValueOnce(actFileResponse)
      .mockResolvedValueOnce(transferActResponse);

    await expect(equipmentTransferActsAPI.downloadEquipmentActFile('DOC/1 A', { preview: true }))
      .resolves.toBe(actFileResponse);
    await expect(equipmentTransferActsAPI.downloadTransferAct('act/1 A'))
      .resolves.toBe(transferActResponse);

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/equipment/acts/DOC/1 A/file', {
      params: { preview: true },
      responseType: 'blob',
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/equipment/transfer/act/act/1 A', {
      responseType: 'blob',
    });
  });

  it('returns response.data and preserves current route id encoding for read endpoints', async () => {
    const { equipmentTransferActsAPI } = await importEquipmentTransferActsAPI();
    apiClientMock.get
      .mockResolvedValueOnce({ data: { acts: [] } })
      .mockResolvedValueOnce({ data: { draft_id: 'draft/1 A' } })
      .mockResolvedValueOnce({ data: { reminder_id: 'rem/1 A' } })
      .mockResolvedValueOnce({ data: { job_id: 'job/1 A' } });

    await expect(equipmentTransferActsAPI.getEquipmentActs('INV/1 A')).resolves.toEqual({ acts: [] });
    await expect(equipmentTransferActsAPI.getUploadedActDraft('draft/1 A'))
      .resolves.toEqual({ draft_id: 'draft/1 A' });
    await expect(equipmentTransferActsAPI.getTransferReminder('rem/1 A'))
      .resolves.toEqual({ reminder_id: 'rem/1 A' });
    await expect(equipmentTransferActsAPI.getTransferActJob('job/1 A'))
      .resolves.toEqual({ job_id: 'job/1 A' });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/equipment/INV/1 A/acts');
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/equipment/acts/upload/draft/draft%2F1%20A');
    expect(apiClientMock.get).toHaveBeenNthCalledWith(3, '/equipment/transfer/reminders/rem%2F1%20A');
    expect(apiClientMock.get).toHaveBeenNthCalledWith(4, '/equipment/transfer/act-jobs/job%2F1%20A');
  });

  it('posts transfer and uploaded-act mutations to the existing endpoints', async () => {
    const { equipmentTransferActsAPI } = await importEquipmentTransferActsAPI();
    const payload = { inv_nos: ['1001'], target_owner: 'owner-2' };

    await equipmentTransferActsAPI.commitUploadedActDraft(payload);
    await equipmentTransferActsAPI.sendUploadedActEmail(payload);
    await equipmentTransferActsAPI.transfer(payload);
    await equipmentTransferActsAPI.transferLocation(payload);
    await equipmentTransferActsAPI.createTransferActOnly(payload);
    await equipmentTransferActsAPI.sendTransferActsEmail(payload);

    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/equipment/acts/upload/commit', payload);
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/equipment/acts/upload/email', payload);
    expect(apiClientMock.post).toHaveBeenNthCalledWith(3, '/equipment/transfer', payload);
    expect(apiClientMock.post).toHaveBeenNthCalledWith(4, '/equipment/transfer/location', payload);
    expect(apiClientMock.post).toHaveBeenNthCalledWith(5, '/equipment/transfer/act-only', payload);
    expect(apiClientMock.post).toHaveBeenNthCalledWith(6, '/equipment/transfer/email', payload);
  });

  it('keeps client equipmentAPI methods compatible with the dedicated module and re-export', async () => {
    const { equipmentTransferActsAPI } = await importEquipmentTransferActsAPI();
    const {
      equipmentAPI,
      equipmentTransferActsAPI: clientEquipmentTransferActsAPI,
    } = await import('./client');

    expect(clientEquipmentTransferActsAPI).toBe(equipmentTransferActsAPI);
    transferActMethods.forEach((methodName) => {
      expect(equipmentAPI[methodName]).toBe(equipmentTransferActsAPI[methodName]);
    });
  });
});

describe('adUsersAPI', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.get.mockResolvedValue({ data: [] });
    window.localStorage.clear();
  });

  it('loads AD import candidates through the dedicated AD users module', async () => {
    const { adUsersAPI } = await import('./adUsers');

    await adUsersAPI.getImportCandidates();

    expect(apiClientMock.get).toHaveBeenCalledWith('/ad-users/import-candidates');
  });

  it('loads AD import candidates for web-user import', async () => {
    const { adUsersAPI } = await import('./client');

    await adUsersAPI.getImportCandidates();

    expect(apiClientMock.get).toHaveBeenCalledWith('/ad-users/import-candidates');
  });

  it('syncs selected AD logins into web users', async () => {
    const { adUsersAPI } = await import('./client');

    await adUsersAPI.syncToApp(['petrov', 'ivanov']);

    expect(apiClientMock.post).toHaveBeenCalledWith('/ad-users/sync-to-app', {
      logins: ['petrov', 'ivanov'],
    });
  });
});

describe('departmentsAPI', () => {
  beforeEach(async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { items: [] } });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { items: [] } });
    apiClientMock.put = vi.fn().mockResolvedValue({ data: { ok: true } });
    window.localStorage.clear();
    const { invalidateDepartmentsListCache } = await import('./departments');
    invalidateDepartmentsListCache();
  });

  it('loads departments through the dedicated departments module', async () => {
    const { departmentsAPI } = await import('./departments');

    await departmentsAPI.list({ search: 'ops' });

    expect(apiClientMock.get).toHaveBeenCalledWith('/departments', {
      params: { search: 'ops' },
    });
  });

  it('reuses cached departments list within ttl for repeated default requests', async () => {
    const { departmentsAPI } = await import('./departments');
    apiClientMock.get.mockResolvedValue({ data: { items: [{ id: 'dept-1', name: 'Ops' }] } });

    const first = await departmentsAPI.list();
    const second = await departmentsAPI.list();

    expect(first).toEqual({ items: [{ id: 'dept-1', name: 'Ops' }] });
    expect(second).toEqual(first);
    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
  });

  it('bypasses departments cache when force refresh is requested', async () => {
    const { departmentsAPI } = await import('./departments');

    await departmentsAPI.list();
    await departmentsAPI.list({ force: true });

    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
  });

  it('invalidates departments cache after manager updates and sync actions', async () => {
    const { departmentsAPI } = await import('./departments');

    await departmentsAPI.list();
    await departmentsAPI.setManagers('ops team', [1, 2]);
    await departmentsAPI.list();

    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    expect(apiClientMock.put).toHaveBeenCalledWith('/departments/ops%20team/managers', {
      manager_user_ids: [1, 2],
    });
  });

  it('updates department managers with encoded identifiers through the dedicated departments module', async () => {
    const { departmentsAPI } = await import('./departments');

    await departmentsAPI.setManagers('ops team', [1, 2]);

    expect(apiClientMock.put).toHaveBeenCalledWith('/departments/ops%20team/managers', {
      manager_user_ids: [1, 2],
    });
  });

  it('syncs department directory directly from AD departments', async () => {
    const { departmentsAPI } = await import('./departments');

    await departmentsAPI.syncFromAD();

    expect(apiClientMock.post).toHaveBeenCalledWith('/departments/sync-from-ad');
  });
});

describe('equipmentAPI.parseUploadedAct', () => {
  beforeEach(() => {
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { draft_id: 'draft-1' } });
  });

  it('uses a longer timeout for uploaded act recognition', async () => {
    const { equipmentAPI, UPLOADED_ACT_PARSE_TIMEOUT_MS } = await import('./client');
    const file = new File(['pdf'], 'act.pdf', { type: 'application/pdf' });

    await equipmentAPI.parseUploadedAct(file);

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/equipment/acts/upload/parse',
      expect.any(FormData),
      {
        params: undefined,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: UPLOADED_ACT_PARSE_TIMEOUT_MS,
      },
    );
    expect(UPLOADED_ACT_PARSE_TIMEOUT_MS).toBe(180000);
  });

  it('passes manual_mode with the same uploaded act timeout', async () => {
    const { equipmentAPI, UPLOADED_ACT_PARSE_TIMEOUT_MS } = await import('./client');
    const file = new File(['pdf'], 'act.pdf', { type: 'application/pdf' });

    await equipmentAPI.parseUploadedAct(file, { manualMode: true });

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/equipment/acts/upload/parse',
      expect.any(FormData),
      expect.objectContaining({
        params: { manual_mode: true },
        timeout: UPLOADED_ACT_PARSE_TIMEOUT_MS,
      }),
    );
  });
});

describe('mailMailboxesAPI contract', () => {
  const mailboxMethods = [
    'listMailboxes',
    'createMailbox',
    'updateMailbox',
    'deleteMailbox',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { items: [] } });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { id: 'created-1' } });
    apiClientMock.patch = vi.fn().mockResolvedValue({ data: { id: 'updated-1' } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { deleted: true } });
  });

  it('lists mailboxes with include_unread only when explicitly supplied', async () => {
    const { mailMailboxesAPI } = await importMailMailboxesAPI();

    await expect(mailMailboxesAPI.listMailboxes()).resolves.toEqual({ items: [] });
    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/mailboxes', { params: {} });

    apiClientMock.get.mockClear();
    await mailMailboxesAPI.listMailboxes({ includeUnread: true });

    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/mailboxes', {
      params: { include_unread: true },
    });

    apiClientMock.get.mockClear();
    await mailMailboxesAPI.listMailboxes({ includeUnread: false });

    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/mailboxes', {
      params: { include_unread: false },
    });
  });

  it('creates, updates, and deletes mailboxes through encoded mailbox routes', async () => {
    const { mailMailboxesAPI } = await importMailMailboxesAPI();
    const payload = {
      label: 'Ops Shared',
      mailbox_email: 'ops@example.com',
      auth_mode: 'stored_credentials',
      is_active: true,
    };

    await expect(mailMailboxesAPI.createMailbox(payload)).resolves.toEqual({ id: 'created-1' });
    expect(apiClientMock.post).toHaveBeenCalledWith('/mail/mailboxes', payload);

    await expect(mailMailboxesAPI.updateMailbox('ops/shared mailbox', payload)).resolves.toEqual({ id: 'updated-1' });
    expect(apiClientMock.patch).toHaveBeenCalledWith('/mail/mailboxes/ops%2Fshared%20mailbox', payload);

    await expect(mailMailboxesAPI.deleteMailbox('ops/shared mailbox')).resolves.toEqual({ deleted: true });
    expect(apiClientMock.delete).toHaveBeenCalledWith('/mail/mailboxes/ops%2Fshared%20mailbox');
  });

  it('keeps mailAPI mailbox methods compatible with the dedicated module and re-export', async () => {
    const { mailMailboxesAPI } = await importMailMailboxesAPI();
    const {
      mailAPI,
      mailMailboxesAPI: clientMailMailboxesAPI,
    } = await import('./client');

    expect(clientMailMailboxesAPI).toBe(mailMailboxesAPI);
    mailboxMethods.forEach((methodName) => {
      expect(mailAPI[methodName]).toBe(mailMailboxesAPI[methodName]);
    });
  });

  it('resolves mailAPI mailbox methods through dedicated module getters', async () => {
    const { mailMailboxesAPI } = await importMailMailboxesAPI();
    const { mailAPI } = await import('./client');
    const spy = vi.spyOn(mailMailboxesAPI, 'deleteMailbox')
      .mockResolvedValue({ deleted: true });

    await expect(mailAPI.deleteMailbox('ops/shared mailbox')).resolves.toEqual({ deleted: true });

    expect(spy).toHaveBeenCalledWith('ops/shared mailbox');
    spy.mockRestore();
  });
});

describe('mailFoldersAPI contract', () => {
  const folderMethods = [
    'getFolderSummary',
    'getFolderTree',
    'createFolder',
    'renameFolder',
    'deleteFolder',
    'setFolderFavorite',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({
      data: {
        items: [
          { id: 'inbox', label: 'Inbox' },
        ],
      },
    });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.patch = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { ok: true } });
  });

  it('loads folder summary and tree with the current mailbox query normalization contract', async () => {
    const { mailFoldersAPI } = await importMailFoldersAPI();
    const treeParams = {
      mailboxId: ' shared/ops ',
      include_hidden: true,
    };

    await expect(mailFoldersAPI.getFolderSummary({
      mailbox_id: ' primary ',
      mailboxId: 'ignored',
    })).resolves.toEqual({
      items: [
        { id: 'inbox', label: 'Inbox' },
      ],
    });
    await expect(mailFoldersAPI.getFolderTree(treeParams)).resolves.toEqual({
      items: [
        { id: 'inbox', label: 'Inbox' },
      ],
    });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/mail/folders/summary', {
      params: {
        mailbox_id: 'primary',
      },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/mail/folders/tree', {
      params: {
        include_hidden: true,
        mailbox_id: 'shared/ops',
      },
    });
    expect(treeParams).toEqual({
      mailboxId: ' shared/ops ',
      include_hidden: true,
    });
  });

  it('creates folders with the raw payload contract', async () => {
    const { mailFoldersAPI } = await importMailFoldersAPI();
    const payload = {
      mailbox_id: ' shared/ops ',
      name: 'Projects',
      parent_folder_id: 'inbox',
      scope: 'mailbox',
    };

    await expect(mailFoldersAPI.createFolder(payload)).resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenCalledWith('/mail/folders', payload);
  });

  it('renames and deletes encoded folders with mailbox query scope', async () => {
    const { mailFoldersAPI } = await importMailFoldersAPI();
    const payload = {
      name: 'Renamed',
      mailbox_id: ' body-mailbox ',
    };

    await expect(mailFoldersAPI.renameFolder('folder/1 A', payload, ' positional-mailbox '))
      .resolves.toEqual({ ok: true });
    await expect(mailFoldersAPI.deleteFolder('folder/1 A', ' body-mailbox '))
      .resolves.toEqual({ ok: true });

    expect(apiClientMock.patch).toHaveBeenCalledWith('/mail/folders/folder%2F1%20A', {
      name: 'Renamed',
    }, {
      params: {
        mailbox_id: 'positional-mailbox',
      },
    });
    expect(apiClientMock.delete).toHaveBeenCalledWith('/mail/folders/folder%2F1%20A', {
      params: {
        mailbox_id: 'body-mailbox',
      },
    });
    expect(payload).toEqual({
      name: 'Renamed',
      mailbox_id: ' body-mailbox ',
    });
  });

  it('stores folder favorite state with mailbox scope in the request body', async () => {
    const { mailFoldersAPI } = await importMailFoldersAPI();

    await expect(mailFoldersAPI.setFolderFavorite('folder/1 A', true, ' shared/ops '))
      .resolves.toEqual({ ok: true });
    await expect(mailFoldersAPI.setFolderFavorite('folder/2 B', false, '   '))
      .resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      1,
      '/mail/folders/folder%2F1%20A/favorite',
      {
        favorite: true,
        mailbox_id: 'shared/ops',
      },
    );
    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      2,
      '/mail/folders/folder%2F2%20B/favorite',
      {
        favorite: false,
        mailbox_id: undefined,
      },
    );
  });

  it('keeps mailAPI folder methods compatible with the dedicated module and re-export', async () => {
    const { mailFoldersAPI } = await importMailFoldersAPI();
    const {
      mailAPI,
      mailFoldersAPI: clientMailFoldersAPI,
    } = await import('./client');

    expect(clientMailFoldersAPI).toBe(mailFoldersAPI);
    folderMethods.forEach((methodName) => {
      expect(mailAPI[methodName]).toBe(mailFoldersAPI[methodName]);
    });
  });

  it('resolves mailAPI folder methods through dedicated module getters', async () => {
    const { mailFoldersAPI } = await importMailFoldersAPI();
    const { mailAPI } = await import('./client');
    const spy = vi.spyOn(mailFoldersAPI, 'renameFolder')
      .mockResolvedValue({ ok: true });

    await expect(mailAPI.renameFolder('folder/1 A', { name: 'Renamed' }, 'mailbox-1'))
      .resolves.toEqual({ ok: true });

    expect(spy).toHaveBeenCalledWith('folder/1 A', { name: 'Renamed' }, 'mailbox-1');
    spy.mockRestore();
  });
});

describe('mailTemplatesAPI contract', () => {
  const templateMethods = [
    'getTemplates',
    'createTemplate',
    'updateTemplate',
    'deleteTemplate',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { items: [] } });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { id: 'created-template' } });
    apiClientMock.patch = vi.fn().mockResolvedValue({ data: { id: 'updated-template' } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { deleted: true } });
  });

  it('loads templates with raw query params and returns response data', async () => {
    const { mailTemplatesAPI } = await importMailTemplatesAPI();
    const params = { include_inactive: true, q: 'request' };

    await expect(mailTemplatesAPI.getTemplates(params)).resolves.toEqual({ items: [] });

    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/templates', { params });
  });

  it('creates, updates, and deletes templates through encoded template routes', async () => {
    const { mailTemplatesAPI } = await importMailTemplatesAPI();
    const payload = {
      code: 'it-request',
      subject: 'Need access',
      body: '<p>Access</p>',
    };

    await expect(mailTemplatesAPI.createTemplate(payload)).resolves.toEqual({ id: 'created-template' });
    expect(apiClientMock.post).toHaveBeenCalledWith('/mail/templates', payload);

    await expect(mailTemplatesAPI.updateTemplate('it/request 1', payload)).resolves.toEqual({ id: 'updated-template' });
    expect(apiClientMock.patch).toHaveBeenCalledWith('/mail/templates/it%2Frequest%201', payload);

    await expect(mailTemplatesAPI.deleteTemplate('it/request 1')).resolves.toEqual({ deleted: true });
    expect(apiClientMock.delete).toHaveBeenCalledWith('/mail/templates/it%2Frequest%201');
  });

  it('keeps mailAPI template methods compatible with the dedicated module and re-export', async () => {
    const { mailTemplatesAPI } = await importMailTemplatesAPI();
    const {
      mailAPI,
      mailTemplatesAPI: clientMailTemplatesAPI,
    } = await import('./client');

    expect(clientMailTemplatesAPI).toBe(mailTemplatesAPI);
    templateMethods.forEach((methodName) => {
      expect(mailAPI[methodName]).toBe(mailTemplatesAPI[methodName]);
    });
  });

  it('resolves mailAPI template methods through dedicated module getters', async () => {
    const { mailTemplatesAPI } = await importMailTemplatesAPI();
    const { mailAPI } = await import('./client');
    const spy = vi.spyOn(mailTemplatesAPI, 'deleteTemplate')
      .mockResolvedValue({ deleted: true });

    await expect(mailAPI.deleteTemplate('it/request 1')).resolves.toEqual({ deleted: true });

    expect(spy).toHaveBeenCalledWith('it/request 1');
    spy.mockRestore();
  });
});

describe('mailItRequestsAPI contract', () => {
  const itRequestMethods = [
    'sendItRequest',
    'sendItRequestMultipart',
  ];

  beforeEach(() => {
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { sent: true } });
  });

  it('sends IT requests through the JSON endpoint with the raw payload', async () => {
    const { mailItRequestsAPI } = await importMailItRequestsAPI();
    const payload = {
      template_id: 'access-request',
      fields: { inventory_number: '101795', comment: 'Need VPN' },
    };

    await expect(mailItRequestsAPI.sendItRequest(payload)).resolves.toEqual({ sent: true });

    expect(apiClientMock.post).toHaveBeenCalledWith('/mail/messages/send-it-request', payload);
  });

  it('sends multipart IT requests with fields, files, progress, and abort signal', async () => {
    const { mailItRequestsAPI } = await importMailItRequestsAPI();
    const file = new File(['payload'], 'request.txt', { type: 'text/plain' });
    const onUploadProgress = vi.fn();
    const signal = new AbortController().signal;

    await expect(mailItRequestsAPI.sendItRequestMultipart({
      templateId: 'access-request',
      fields: { inventory_number: '101795', comment: 'Need VPN' },
      files: [file, null],
      onUploadProgress,
      signal,
    })).resolves.toEqual({ sent: true });

    const [url, body, config] = apiClientMock.post.mock.calls[0];
    expect(url).toBe('/mail/messages/send-it-request-multipart');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('template_id')).toBe('access-request');
    expect(JSON.parse(String(body.get('fields_json') || '{}'))).toEqual({
      inventory_number: '101795',
      comment: 'Need VPN',
    });
    expect(body.getAll('files')).toEqual([file]);
    expect(config).toEqual({
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress,
      signal,
    });
  });

  it('keeps mailAPI IT request methods compatible with the dedicated module and re-export', async () => {
    const { mailItRequestsAPI } = await importMailItRequestsAPI();
    const {
      mailAPI,
      mailItRequestsAPI: clientMailItRequestsAPI,
    } = await import('./client');

    expect(clientMailItRequestsAPI).toBe(mailItRequestsAPI);
    itRequestMethods.forEach((methodName) => {
      expect(mailAPI[methodName]).toBe(mailItRequestsAPI[methodName]);
    });
  });

  it('resolves mailAPI IT request methods through dedicated module getters', async () => {
    const { mailItRequestsAPI } = await importMailItRequestsAPI();
    const { mailAPI } = await import('./client');
    const spy = vi.spyOn(mailItRequestsAPI, 'sendItRequest')
      .mockResolvedValue({ sent: true });

    await expect(mailAPI.sendItRequest({ template_id: 'access-request' })).resolves.toEqual({ sent: true });

    expect(spy).toHaveBeenCalledWith({ template_id: 'access-request' });
    spy.mockRestore();
  });
});

describe('mailConfigAPI contract', () => {
  const configMethods = [
    'getMyConfig',
    'updateMyConfig',
    'saveMyCredentials',
    'updateUserConfig',
    'testConnection',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { mailbox_id: 'primary' } });
    apiClientMock.post.mockReset();
    apiClientMock.post.mockResolvedValue({ data: { mailbox_id: 'primary' } });
    apiClientMock.patch = vi.fn().mockResolvedValue({ data: { mailbox_id: 'primary' } });
  });

  it('loads my config with the current mailbox query normalization contract', async () => {
    const { mailConfigAPI } = await importMailConfigAPI();

    await expect(mailConfigAPI.getMyConfig({
      mailboxId: ' shared/ops ',
      include_auth: true,
    })).resolves.toEqual({ mailbox_id: 'primary' });
    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/config/me', {
      params: {
        include_auth: true,
        mailbox_id: 'shared/ops',
      },
    });

    apiClientMock.get.mockClear();
    await mailConfigAPI.getMyConfig({
      mailbox_id: '   ',
      include_auth: true,
    });
    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/config/me', {
      params: {
        include_auth: true,
      },
    });
  });

  it('updates my config through the raw self-service payload contract', async () => {
    const { mailConfigAPI } = await importMailConfigAPI();
    const payload = {
      mailbox_id: 'primary',
      mail_signature_html: '<p>New signature</p>',
    };

    await expect(mailConfigAPI.updateMyConfig(payload)).resolves.toEqual({ mailbox_id: 'primary' });

    expect(apiClientMock.patch).toHaveBeenCalledWith('/mail/config/me', payload);
  });

  it('saves my credentials through the raw payload contract', async () => {
    const { mailConfigAPI } = await importMailConfigAPI();
    const payload = {
      mailbox_id: 'primary',
      mailbox_login: 'user@zsgp.corp',
      mailbox_password: 'Secret123!',
      mailbox_email: 'user@example.com',
    };

    await expect(mailConfigAPI.saveMyCredentials(payload)).resolves.toEqual({ mailbox_id: 'primary' });

    expect(apiClientMock.post).toHaveBeenCalledWith('/mail/config/me/credentials', payload);
  });

  it('updates user config through the current raw admin route contract', async () => {
    const { mailConfigAPI } = await importMailConfigAPI();
    const payload = {
      mailbox_email: 'shared@example.com',
      mailbox_login: 'shared@zsgp.corp',
    };

    await expect(mailConfigAPI.updateUserConfig('user/1 A', payload)).resolves.toEqual({ mailbox_id: 'primary' });

    expect(apiClientMock.patch).toHaveBeenCalledWith('/mail/config/user/user/1 A', payload);
  });

  it('tests mail connection through the raw diagnostic payload contract', async () => {
    const { mailConfigAPI } = await importMailConfigAPI();
    const payload = {
      user_id: 77,
      mailbox_id: 'primary',
    };
    apiClientMock.post.mockResolvedValueOnce({ data: { ok: true } });

    await expect(mailConfigAPI.testConnection(payload)).resolves.toEqual({ ok: true });
    expect(apiClientMock.post).toHaveBeenCalledWith('/mail/test-connection', payload);

    apiClientMock.post.mockClear();
    apiClientMock.post.mockResolvedValueOnce({ data: { ok: true } });
    await expect(mailConfigAPI.testConnection()).resolves.toEqual({ ok: true });
    expect(apiClientMock.post).toHaveBeenCalledWith('/mail/test-connection', {});
  });

  it('keeps mailAPI config methods compatible with the dedicated module and re-export', async () => {
    const { mailConfigAPI } = await importMailConfigAPI();
    const {
      mailAPI,
      mailConfigAPI: clientMailConfigAPI,
    } = await import('./client');

    expect(clientMailConfigAPI).toBe(mailConfigAPI);
    configMethods.forEach((methodName) => {
      expect(mailAPI[methodName]).toBe(mailConfigAPI[methodName]);
    });
  });

  it('resolves mailAPI config methods through dedicated module getters', async () => {
    const { mailConfigAPI } = await importMailConfigAPI();
    const { mailAPI } = await import('./client');
    const spy = vi.spyOn(mailConfigAPI, 'updateMyConfig')
      .mockResolvedValue({ mailbox_id: 'primary' });
    const payload = {
      mailbox_id: 'primary',
      mail_signature_html: '<p>New signature</p>',
    };

    await expect(mailAPI.updateMyConfig(payload)).resolves.toEqual({ mailbox_id: 'primary' });

    expect(spy).toHaveBeenCalledWith(payload);
    spy.mockRestore();
  });

  it('resolves mailAPI credential and diagnostic methods through dedicated module getters', async () => {
    const { mailConfigAPI } = await importMailConfigAPI();
    const { mailAPI } = await import('./client');
    const credentialsPayload = {
      mailbox_id: 'primary',
      mailbox_password: 'Secret123!',
    };
    const adminPayload = {
      mailbox_email: 'shared@example.com',
    };
    const diagnosticPayload = {
      user_id: 77,
    };
    const credentialsSpy = vi.spyOn(mailConfigAPI, 'saveMyCredentials')
      .mockResolvedValue({ mailbox_id: 'primary' });
    const adminSpy = vi.spyOn(mailConfigAPI, 'updateUserConfig')
      .mockResolvedValue({ mailbox_id: 'shared' });
    const diagnosticSpy = vi.spyOn(mailConfigAPI, 'testConnection')
      .mockResolvedValue({ ok: true });

    await expect(mailAPI.saveMyCredentials(credentialsPayload)).resolves.toEqual({ mailbox_id: 'primary' });
    await expect(mailAPI.updateUserConfig(77, adminPayload)).resolves.toEqual({ mailbox_id: 'shared' });
    await expect(mailAPI.testConnection(diagnosticPayload)).resolves.toEqual({ ok: true });

    expect(credentialsSpy).toHaveBeenCalledWith(credentialsPayload);
    expect(adminSpy).toHaveBeenCalledWith(77, adminPayload);
    expect(diagnosticSpy).toHaveBeenCalledWith(diagnosticPayload);
    credentialsSpy.mockRestore();
    adminSpy.mockRestore();
    diagnosticSpy.mockRestore();
  });
});

describe('mailPreferencesAPI contract', () => {
  const preferenceMethods = [
    'getPreferences',
    'updatePreferences',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({
      data: {
        preferences: {
          reading_pane: 'right',
          density: 'comfortable',
        },
      },
    });
    apiClientMock.patch = vi.fn().mockResolvedValue({
      data: {
        reading_pane: 'bottom',
        density: 'compact',
        mark_read_on_select: false,
        show_preview_snippets: false,
        show_favorites_first: true,
      },
    });
  });

  it('loads mail preferences through the dedicated endpoint', async () => {
    const { mailPreferencesAPI } = await importMailPreferencesAPI();

    await expect(mailPreferencesAPI.getPreferences()).resolves.toEqual({
      preferences: {
        reading_pane: 'right',
        density: 'comfortable',
      },
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/preferences');
  });

  it('updates mail preferences with the raw payload', async () => {
    const { mailPreferencesAPI } = await importMailPreferencesAPI();
    const payload = {
      reading_pane: 'bottom',
      density: 'compact',
      mark_read_on_select: false,
      show_preview_snippets: false,
      show_favorites_first: true,
    };

    await expect(mailPreferencesAPI.updatePreferences(payload)).resolves.toEqual(payload);

    expect(apiClientMock.patch).toHaveBeenCalledWith('/mail/preferences', payload);
  });

  it('keeps mailAPI preference methods compatible with the dedicated module and re-export', async () => {
    const { mailPreferencesAPI } = await importMailPreferencesAPI();
    const {
      mailAPI,
      mailPreferencesAPI: clientMailPreferencesAPI,
    } = await import('./client');

    expect(clientMailPreferencesAPI).toBe(mailPreferencesAPI);
    preferenceMethods.forEach((methodName) => {
      expect(mailAPI[methodName]).toBe(mailPreferencesAPI[methodName]);
    });
  });

  it('resolves mailAPI preference methods through dedicated module getters', async () => {
    const { mailPreferencesAPI } = await importMailPreferencesAPI();
    const { mailAPI } = await import('./client');
    const spy = vi.spyOn(mailPreferencesAPI, 'updatePreferences')
      .mockResolvedValue({ density: 'compact' });
    const payload = { density: 'compact' };

    await expect(mailAPI.updatePreferences(payload)).resolves.toEqual({ density: 'compact' });

    expect(spy).toHaveBeenCalledWith(payload);
    spy.mockRestore();
  });
});

describe('mailComposeAPI contract', () => {
  const composeMethods = [
    'searchContacts',
    'saveDraftMultipart',
    'deleteDraft',
    'sendMessage',
    'sendMessageMultipart',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({
      data: {
        items: [
          { email: 'person@example.com', name: 'Person' },
        ],
      },
    });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { id: 'sent-1' } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { deleted: true } });
  });

  it('searches compose contacts with mailbox query normalization and item fallback', async () => {
    const { mailComposeAPI } = await importMailComposeAPI();

    await expect(mailComposeAPI.searchContacts(' Person ', { mailboxId: ' shared/ops ' }))
      .resolves.toEqual([{ email: 'person@example.com', name: 'Person' }]);

    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/contacts', {
      params: {
        q: ' Person ',
        mailbox_id: 'shared/ops',
      },
    });

    apiClientMock.get.mockResolvedValueOnce({ data: {} });

    await expect(mailComposeAPI.searchContacts(' Nobody ', { mailboxId: '   ' }))
      .resolves.toEqual([]);

    expect(apiClientMock.get).toHaveBeenLastCalledWith('/mail/contacts', {
      params: {
        q: ' Nobody ',
      },
    });
  });

  it('saves and deletes drafts through the current multipart draft contract', async () => {
    const { mailComposeAPI } = await importMailComposeAPI();
    const firstFile = new File(['draft-a'], 'draft-a.txt', { type: 'text/plain' });
    const secondFile = new File(['draft-b'], 'draft-b.txt', { type: 'text/plain' });
    const onUploadProgress = vi.fn();
    const signal = new AbortController().signal;

    await expect(mailComposeAPI.saveDraftMultipart({
      fromMailboxId: ' primary ',
      draftId: 'draft/1 A',
      composeMode: 'reply',
      to: ['to@example.com', 'team@example.com'],
      cc: ['copy@example.com'],
      bcc: [],
      subject: 'Draft subject',
      body: '<p>Draft</p>',
      isHtml: true,
      replyToMessageId: 'msg-1',
      forwardMessageId: 'msg-2',
      retainExistingAttachments: ['att-1', 'att-2'],
      files: [firstFile, secondFile],
      onUploadProgress,
      signal,
    })).resolves.toEqual({ id: 'sent-1' });

    const [url, body, config] = apiClientMock.post.mock.calls[0];
    expect(url).toBe('/mail/drafts/upsert-multipart');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('from_mailbox_id')).toBe('primary');
    expect(body.get('draft_id')).toBe('draft/1 A');
    expect(body.get('compose_mode')).toBe('reply');
    expect(body.get('to')).toBe('to@example.com;team@example.com');
    expect(body.get('cc')).toBe('copy@example.com');
    expect(body.get('bcc')).toBe('');
    expect(body.get('subject')).toBe('Draft subject');
    expect(body.get('body')).toBe('<p>Draft</p>');
    expect(body.get('is_html')).toBe('true');
    expect(body.get('reply_to_message_id')).toBe('msg-1');
    expect(body.get('forward_message_id')).toBe('msg-2');
    expect(JSON.parse(String(body.get('retain_existing_attachments_json') || '[]')))
      .toEqual(['att-1', 'att-2']);
    expect(body.getAll('files')).toEqual([firstFile, secondFile]);
    expect(config).toEqual({
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress,
      signal,
    });

    await expect(mailComposeAPI.deleteDraft('draft/1 A', { mailboxId: ' primary ' }))
      .resolves.toEqual({ deleted: true });

    expect(apiClientMock.delete).toHaveBeenCalledWith('/mail/drafts/draft%2F1%20A', {
      params: {
        mailbox_id: 'primary',
      },
    });
  });

  it('sends JSON and multipart compose messages through the current endpoints', async () => {
    const { mailComposeAPI } = await importMailComposeAPI();
    const payload = {
      from_mailbox_id: 'primary',
      to: ['to@example.com'],
      subject: 'Hello',
      body: '<p>Hello</p>',
    };
    const file = new File(['report'], 'report.txt', { type: 'text/plain' });
    const onUploadProgress = vi.fn();
    const signal = new AbortController().signal;

    await expect(mailComposeAPI.sendMessage(payload)).resolves.toEqual({ id: 'sent-1' });

    expect(apiClientMock.post).toHaveBeenCalledWith('/mail/messages/send', payload);

    await expect(mailComposeAPI.sendMessageMultipart({
      fromMailboxId: ' primary ',
      to: ['to@example.com', 'team@example.com'],
      cc: ['copy@example.com'],
      bcc: undefined,
      subject: 'Multipart subject',
      body: '<p>Body</p>',
      isHtml: false,
      files: [file],
      replyToMessageId: 'reply/1',
      forwardMessageId: 'forward/2',
      draftId: 'draft/3',
      onUploadProgress,
      signal,
    })).resolves.toEqual({ id: 'sent-1' });

    const [url, body, config] = apiClientMock.post.mock.calls[1];
    expect(url).toBe('/mail/messages/send-multipart');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('from_mailbox_id')).toBe('primary');
    expect(body.get('to')).toBe('to@example.com;team@example.com');
    expect(body.get('cc')).toBe('copy@example.com');
    expect(body.get('bcc')).toBe('');
    expect(body.get('subject')).toBe('Multipart subject');
    expect(body.get('body')).toBe('<p>Body</p>');
    expect(body.get('is_html')).toBe('false');
    expect(body.get('reply_to_message_id')).toBe('reply/1');
    expect(body.get('forward_message_id')).toBe('forward/2');
    expect(body.get('draft_id')).toBe('draft/3');
    expect(body.getAll('files')).toEqual([file]);
    expect(config).toEqual({
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress,
      signal,
    });
  });

  it('keeps mailAPI compose methods compatible with the dedicated module and re-export', async () => {
    const { mailComposeAPI } = await importMailComposeAPI();
    const {
      mailAPI,
      mailComposeAPI: clientMailComposeAPI,
    } = await import('./client');

    expect(clientMailComposeAPI).toBe(mailComposeAPI);
    composeMethods.forEach((methodName) => {
      expect(mailAPI[methodName]).toBe(mailComposeAPI[methodName]);
    });
  });

  it('resolves mailAPI compose methods through dedicated module getters', async () => {
    const { mailComposeAPI } = await importMailComposeAPI();
    const { mailAPI } = await import('./client');
    const spy = vi.spyOn(mailComposeAPI, 'sendMessage')
      .mockResolvedValue({ id: 'sent-via-spy' });
    const payload = {
      from_mailbox_id: 'primary',
      to: ['to@example.com'],
      subject: 'Hello',
    };

    await expect(mailAPI.sendMessage(payload)).resolves.toEqual({ id: 'sent-via-spy' });

    expect(spy).toHaveBeenCalledWith(payload);
    spy.mockRestore();
  });
});

describe('mailMessageListAPI contract', () => {
  const messageListMethods = [
    'getBootstrap',
    'getMessages',
    'getInbox',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({
      data: {
        items: [{ id: 'msg-1', subject: 'Inbox message' }],
        total: 1,
      },
    });
  });

  it('loads bootstrap, messages, and inbox through the message list endpoints with mailbox query normalization', async () => {
    const { mailMessageListAPI } = await importMailMessageListAPI();
    const messagesParams = {
      folder: 'inbox',
      limit: 50,
      mailbox_id: ' primary ',
      mailboxId: 'ignored',
    };
    const blankMailboxParams = {
      folder: 'sent',
      mailbox_id: '   ',
      mailboxId: 'fallback',
      unread_only: true,
    };

    await expect(mailMessageListAPI.getBootstrap({ limit: 20, mailboxId: ' shared/ops ' }))
      .resolves.toEqual({
        items: [{ id: 'msg-1', subject: 'Inbox message' }],
        total: 1,
      });
    await expect(mailMessageListAPI.getMessages(messagesParams)).resolves.toEqual({
      items: [{ id: 'msg-1', subject: 'Inbox message' }],
      total: 1,
    });
    await expect(mailMessageListAPI.getInbox({ folder: 'archive', mailboxId: '   ' })).resolves.toEqual({
      items: [{ id: 'msg-1', subject: 'Inbox message' }],
      total: 1,
    });
    await mailMessageListAPI.getMessages(blankMailboxParams);

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/mail/bootstrap', {
      params: { limit: 20, mailbox_id: 'shared/ops' },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/mail/messages', {
      params: { folder: 'inbox', limit: 50, mailbox_id: 'primary' },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(3, '/mail/messages', {
      params: { folder: 'archive' },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(4, '/mail/messages', {
      params: { folder: 'sent', unread_only: true },
    });
    expect(messagesParams).toEqual({
      folder: 'inbox',
      limit: 50,
      mailbox_id: ' primary ',
      mailboxId: 'ignored',
    });
    expect(blankMailboxParams).toEqual({
      folder: 'sent',
      mailbox_id: '   ',
      mailboxId: 'fallback',
      unread_only: true,
    });
  });

  it('keeps getInbox as an alias to getMessages without forcing an inbox folder', async () => {
    const { mailMessageListAPI } = await importMailMessageListAPI();
    const spy = vi.spyOn(mailMessageListAPI, 'getMessages')
      .mockResolvedValue({ items: [{ id: 'msg-spy' }] });
    const params = { folder: 'archive', mailboxId: 'mb-1' };

    await expect(mailMessageListAPI.getInbox(params)).resolves.toEqual({
      items: [{ id: 'msg-spy' }],
    });

    expect(spy).toHaveBeenCalledWith(params);
    spy.mockRestore();
  });

  it('keeps mailAPI message list methods compatible with the dedicated module and re-export', async () => {
    const { mailMessageListAPI } = await importMailMessageListAPI();
    const {
      mailAPI,
      mailMessageListAPI: clientMailMessageListAPI,
    } = await import('./client');

    expect(clientMailMessageListAPI).toBe(mailMessageListAPI);
    messageListMethods.forEach((methodName) => {
      expect(mailAPI[methodName]).toBe(mailMessageListAPI[methodName]);
    });
  });

  it('resolves mailAPI message list methods through dedicated module getters', async () => {
    const { mailMessageListAPI } = await importMailMessageListAPI();
    const { mailAPI } = await import('./client');
    const spy = vi.spyOn(mailMessageListAPI, 'getInbox')
      .mockResolvedValue({ items: [] });
    const params = { folder: 'inbox', mailboxId: 'mb-1' };

    await expect(mailAPI.getInbox(params)).resolves.toEqual({ items: [] });

    expect(spy).toHaveBeenCalledWith(params);
    spy.mockRestore();
  });
});

describe('mailMessageDetailAPI contract', () => {
  const messageDetailMethods = ['getMessage'];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({
      data: { id: 'msg-1', subject: 'Detail message' },
    });
  });

  it('loads encoded message detail with mailbox query normalization and signal passthrough', async () => {
    const { mailMessageDetailAPI } = await importMailMessageDetailAPI();
    const controller = new AbortController();

    await expect(mailMessageDetailAPI.getMessage('msg/1 A', {
      mailboxId: ' shared/ops ',
      signal: controller.signal,
    })).resolves.toEqual({ id: 'msg-1', subject: 'Detail message' });

    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/messages/msg%2F1%20A', {
      params: { mailbox_id: 'shared/ops' },
      signal: controller.signal,
    });
  });

  it('omits blank mailbox scope and keeps non-query options isolated for message detail', async () => {
    const { mailMessageDetailAPI } = await importMailMessageDetailAPI();
    const controller = new AbortController();

    await mailMessageDetailAPI.getMessage('msg/2 B', {
      mailboxId: '   ',
      signal: controller.signal,
      extra: 'ignored',
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/messages/msg%2F2%20B', {
      params: {},
      signal: controller.signal,
    });
  });

  it('keeps mailAPI message detail methods compatible with the dedicated module and re-export', async () => {
    const { mailMessageDetailAPI } = await importMailMessageDetailAPI();
    const {
      mailAPI,
      mailMessageDetailAPI: clientMailMessageDetailAPI,
    } = await import('./client');

    expect(clientMailMessageDetailAPI).toBe(mailMessageDetailAPI);
    messageDetailMethods.forEach((methodName) => {
      expect(mailAPI[methodName]).toBe(mailMessageDetailAPI[methodName]);
    });
  });

  it('resolves mailAPI message detail methods through dedicated module getters', async () => {
    const { mailMessageDetailAPI } = await importMailMessageDetailAPI();
    const { mailAPI } = await import('./client');
    const spy = vi.spyOn(mailMessageDetailAPI, 'getMessage')
      .mockResolvedValue({ id: 'msg-spy' });
    const options = { mailboxId: 'mb-1' };

    await expect(mailAPI.getMessage('msg-1', options)).resolves.toEqual({ id: 'msg-spy' });

    expect(spy).toHaveBeenCalledWith('msg-1', options);
    spy.mockRestore();
  });
});

describe('mailMessageFilesAPI contract', () => {
  const messageFileMethods = [
    'downloadAttachment',
    'getAttachmentPreview',
    'downloadAttachmentPreviewPdf',
    'getMessageHeaders',
    'downloadMessageSource',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({
      data: {
        items: [
          { name: 'From', value: 'sender@example.com' },
        ],
      },
    });
  });

  it('downloads attachments as raw blob responses with encoded ids and mailbox scope', async () => {
    const { mailMessageFilesAPI } = await importMailMessageFilesAPI();
    const response = {
      data: new Blob(['attachment']),
      headers: {
        'content-type': 'text/plain',
        'content-disposition': 'attachment; filename="notes.txt"',
      },
    };
    apiClientMock.get.mockResolvedValueOnce(response);

    await expect(mailMessageFilesAPI.downloadAttachment('msg/1 A', 'att/2 B', { mailboxId: ' mb-1 ' }))
      .resolves.toBe(response);

    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/messages/msg%2F1%20A/attachments/att%2F2%20B', {
      params: {
        mailbox_id: 'mb-1',
      },
      responseType: 'blob',
    });
  });

  it('loads message headers as response data and omits blank mailbox scope', async () => {
    const { mailMessageFilesAPI } = await importMailMessageFilesAPI();

    await expect(mailMessageFilesAPI.getMessageHeaders('msg/1 A', { mailboxId: '   ' }))
      .resolves.toEqual({
        items: [
          { name: 'From', value: 'sender@example.com' },
        ],
      });

    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/messages/msg%2F1%20A/headers', {
      params: {},
    });
  });

  it('downloads message source as a raw blob response with mailbox query normalization', async () => {
    const { mailMessageFilesAPI } = await importMailMessageFilesAPI();
    const response = {
      data: new Blob(['source']),
      headers: {
        'content-type': 'message/rfc822',
        'content-disposition': 'attachment; filename="source.eml"',
      },
    };
    apiClientMock.get.mockResolvedValueOnce(response);

    await expect(mailMessageFilesAPI.downloadMessageSource('msg/1 A', { mailboxId: ' primary ' }))
      .resolves.toBe(response);

    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/messages/msg%2F1%20A/eml', {
      params: {
        mailbox_id: 'primary',
      },
      responseType: 'blob',
    });
  });

  it('keeps mailAPI message file methods compatible with the dedicated module and re-export', async () => {
    const { mailMessageFilesAPI } = await importMailMessageFilesAPI();
    const {
      mailAPI,
      mailMessageFilesAPI: clientMailMessageFilesAPI,
    } = await import('./client');

    expect(clientMailMessageFilesAPI).toBe(mailMessageFilesAPI);
    messageFileMethods.forEach((methodName) => {
      expect(mailAPI[methodName]).toBe(mailMessageFilesAPI[methodName]);
    });
  });

  it('resolves mailAPI message file methods through dedicated module getters', async () => {
    const { mailMessageFilesAPI } = await importMailMessageFilesAPI();
    const { mailAPI } = await import('./client');
    const response = {
      data: new Blob(['attachment']),
      headers: { 'content-type': 'text/plain' },
    };
    const spy = vi.spyOn(mailMessageFilesAPI, 'downloadAttachment')
      .mockResolvedValue(response);

    await expect(mailAPI.downloadAttachment('msg-1', 'att-1', { mailboxId: 'mb-1' }))
      .resolves.toBe(response);

    expect(spy).toHaveBeenCalledWith('msg-1', 'att-1', { mailboxId: 'mb-1' });
    spy.mockRestore();
  });
});

describe('mailMessageActionsAPI contract', () => {
  const messageActionMethods = [
    'markAsRead',
    'markAsUnread',
    'moveMessage',
    'deleteMessage',
    'restoreMessage',
    'bulkMessageAction',
    'markAllRead',
  ];

  beforeEach(() => {
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
  });

  it('marks messages read and unread with encoded ids and mailbox query scope', async () => {
    const { mailMessageActionsAPI } = await importMailMessageActionsAPI();

    await expect(mailMessageActionsAPI.markAsRead('msg/1 A', ' shared/ops '))
      .resolves.toEqual({ ok: true });
    await expect(mailMessageActionsAPI.markAsUnread('msg/2 B', '   '))
      .resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      1,
      '/mail/messages/msg%2F1%20A/read',
      null,
      {
        params: {
          mailbox_id: 'shared/ops',
        },
      },
    );
    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      2,
      '/mail/messages/msg%2F2%20B/unread',
      null,
      {
        params: {},
      },
    );
  });

  it('moves, deletes, and restores encoded messages with raw payload bodies', async () => {
    const { mailMessageActionsAPI } = await importMailMessageActionsAPI();
    const movePayload = {
      mailbox_id: 'mailbox-1',
      target_folder: 'archive',
    };
    const deletePayload = {
      mailbox_id: 'mailbox-1',
      permanent: true,
    };
    const restorePayload = {
      mailbox_id: 'mailbox-1',
      target_folder: 'inbox',
    };

    await expect(mailMessageActionsAPI.moveMessage('msg/1 A', movePayload))
      .resolves.toEqual({ ok: true });
    await expect(mailMessageActionsAPI.deleteMessage('msg/1 A', deletePayload))
      .resolves.toEqual({ ok: true });
    await expect(mailMessageActionsAPI.restoreMessage('msg/1 A', restorePayload))
      .resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/mail/messages/msg%2F1%20A/move', movePayload);
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/mail/messages/msg%2F1%20A/delete', deletePayload);
    expect(apiClientMock.post).toHaveBeenNthCalledWith(3, '/mail/messages/msg%2F1%20A/restore', restorePayload);
  });

  it('uses default empty payloads for delete and restore when no body is supplied', async () => {
    const { mailMessageActionsAPI } = await importMailMessageActionsAPI();

    await expect(mailMessageActionsAPI.deleteMessage('msg/1 A')).resolves.toEqual({ ok: true });
    await expect(mailMessageActionsAPI.restoreMessage('msg/1 A')).resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/mail/messages/msg%2F1%20A/delete', {});
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/mail/messages/msg%2F1%20A/restore', {});
  });

  it('posts bulk and mark-all-read payloads unchanged', async () => {
    const { mailMessageActionsAPI } = await importMailMessageActionsAPI();
    const bulkPayload = {
      mailbox_id: 'mailbox-1',
      message_ids: ['msg-1', 'msg-2'],
      action: 'move',
      target_folder: 'archive',
    };
    const markAllPayload = {
      mailbox_id: 'mailbox-1',
      folder: 'inbox',
    };

    await expect(mailMessageActionsAPI.bulkMessageAction(bulkPayload)).resolves.toEqual({ ok: true });
    await expect(mailMessageActionsAPI.markAllRead(markAllPayload)).resolves.toEqual({ ok: true });
    await expect(mailMessageActionsAPI.markAllRead()).resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/mail/messages/bulk', bulkPayload);
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/mail/messages/mark-all-read', markAllPayload);
    expect(apiClientMock.post).toHaveBeenNthCalledWith(3, '/mail/messages/mark-all-read', {});
  });

  it('keeps mailAPI message action methods compatible with the dedicated module and re-export', async () => {
    const { mailMessageActionsAPI } = await importMailMessageActionsAPI();
    const {
      mailAPI,
      mailMessageActionsAPI: clientMailMessageActionsAPI,
    } = await import('./client');

    expect(clientMailMessageActionsAPI).toBe(mailMessageActionsAPI);
    messageActionMethods.forEach((methodName) => {
      expect(mailAPI[methodName]).toBe(mailMessageActionsAPI[methodName]);
    });
  });

  it('resolves mailAPI message action methods through dedicated module getters', async () => {
    const { mailMessageActionsAPI } = await importMailMessageActionsAPI();
    const { mailAPI } = await import('./client');
    const spy = vi.spyOn(mailMessageActionsAPI, 'moveMessage')
      .mockResolvedValue({ ok: true });
    const payload = {
      mailbox_id: 'mailbox-1',
      target_folder: 'archive',
    };

    await expect(mailAPI.moveMessage('msg/1 A', payload)).resolves.toEqual({ ok: true });

    expect(spy).toHaveBeenCalledWith('msg/1 A', payload);
    spy.mockRestore();
  });
});

describe('mailConversationsAPI contract', () => {
  const conversationMethods = [
    'getConversations',
    'getConversation',
    'markConversationAsRead',
    'markConversationAsUnread',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({
      data: {
        items: [
          { conversation_id: 'conv-1', subject: 'Inbox thread' },
        ],
        total: 1,
      },
    });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
  });

  it('loads conversations with mailbox query normalization and nullish precedence', async () => {
    const { mailConversationsAPI } = await importMailConversationsAPI();
    const params = {
      folder: 'inbox',
      mailboxId: ' shared/ops ',
      limit: 25,
    };
    const blankMailboxParams = {
      folder: 'archive',
      mailbox_id: '   ',
      mailboxId: 'fallback-mailbox',
    };

    await expect(mailConversationsAPI.getConversations(params)).resolves.toEqual({
      items: [
        { conversation_id: 'conv-1', subject: 'Inbox thread' },
      ],
      total: 1,
    });
    await expect(mailConversationsAPI.getConversations(blankMailboxParams)).resolves.toEqual({
      items: [
        { conversation_id: 'conv-1', subject: 'Inbox thread' },
      ],
      total: 1,
    });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/mail/conversations', {
      params: {
        folder: 'inbox',
        limit: 25,
        mailbox_id: 'shared/ops',
      },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/mail/conversations', {
      params: {
        folder: 'archive',
      },
    });
    expect(params).toEqual({
      folder: 'inbox',
      mailboxId: ' shared/ops ',
      limit: 25,
    });
    expect(blankMailboxParams).toEqual({
      folder: 'archive',
      mailbox_id: '   ',
      mailboxId: 'fallback-mailbox',
    });
  });

  it('loads one conversation with encoded ids, mailbox params, and abort signal', async () => {
    const { mailConversationsAPI } = await importMailConversationsAPI();
    const signal = new AbortController().signal;

    await expect(mailConversationsAPI.getConversation(
      'conv/1 A',
      {
        folder: 'inbox',
        mailboxId: ' shared/ops ',
        folder_scope: 'current',
      },
      { signal },
    )).resolves.toEqual({
      items: [
        { conversation_id: 'conv-1', subject: 'Inbox thread' },
      ],
      total: 1,
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/conversations/conv%2F1%20A', {
      params: {
        folder: 'inbox',
        folder_scope: 'current',
        mailbox_id: 'shared/ops',
      },
      signal,
    });
  });

  it('marks conversations read and unread with raw payload bodies and encoded ids', async () => {
    const { mailConversationsAPI } = await importMailConversationsAPI();
    const payload = {
      mailbox_id: 'mailbox-1',
      folder: 'inbox',
      folder_scope: 'current',
    };

    await expect(mailConversationsAPI.markConversationAsRead('conv/1 A', payload))
      .resolves.toEqual({ ok: true });
    await expect(mailConversationsAPI.markConversationAsUnread('conv/1 A'))
      .resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      1,
      '/mail/conversations/conv%2F1%20A/read',
      payload,
    );
    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      2,
      '/mail/conversations/conv%2F1%20A/unread',
      {},
    );
  });

  it('keeps mailAPI conversation methods compatible with the dedicated module and re-export', async () => {
    const { mailConversationsAPI } = await importMailConversationsAPI();
    const {
      mailAPI,
      mailConversationsAPI: clientMailConversationsAPI,
    } = await import('./client');

    expect(clientMailConversationsAPI).toBe(mailConversationsAPI);
    conversationMethods.forEach((methodName) => {
      expect(mailAPI[methodName]).toBe(mailConversationsAPI[methodName]);
    });
  });

  it('resolves mailAPI conversation methods through dedicated module getters', async () => {
    const { mailConversationsAPI } = await importMailConversationsAPI();
    const { mailAPI } = await import('./client');
    const spy = vi.spyOn(mailConversationsAPI, 'getConversation')
      .mockResolvedValue({ conversation_id: 'conv-1' });
    const signal = new AbortController().signal;

    await expect(mailAPI.getConversation('conv/1 A', { folder: 'inbox' }, { signal }))
      .resolves.toEqual({ conversation_id: 'conv-1' });

    expect(spy).toHaveBeenCalledWith('conv/1 A', { folder: 'inbox' }, { signal });
    spy.mockRestore();
  });
});

describe('mailNotificationsAPI contract', () => {
  const notificationMethods = [
    'getUnreadCount',
    'getNotificationFeed',
  ];

  beforeEach(async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { unread_count: 4 } });
    window.localStorage.clear();
    const { clearSWRCache } = await import('../lib/swrCache');
    clearSWRCache();
  });

  it('loads scoped unread counts without using the shared cache', async () => {
    const { mailNotificationsAPI } = await importMailNotificationsAPI();

    await expect(mailNotificationsAPI.getUnreadCount({
      mailboxId: ' shared/ops ',
      force: true,
      staleTimeMs: 1,
    })).resolves.toEqual({ unread_count: 4 });
    await expect(mailNotificationsAPI.getUnreadCount({ mailboxId: 'shared/ops' }))
      .resolves.toEqual({ unread_count: 4 });

    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/mail/unread-count', {
      params: {
        mailbox_id: 'shared/ops',
      },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/mail/unread-count', {
      params: {
        mailbox_id: 'shared/ops',
      },
    });
  });

  it('keeps unscoped unread counts on the selected-database SWR cache with force refresh', async () => {
    const { mailNotificationsAPI } = await importMailNotificationsAPI();
    apiClientMock.get
      .mockResolvedValueOnce({ data: { unread_count: 1 } })
      .mockResolvedValueOnce({ data: { unread_count: 2 } })
      .mockResolvedValueOnce({ data: { unread_count: 3 } });

    await expect(mailNotificationsAPI.getUnreadCount()).resolves.toEqual({ unread_count: 1 });
    await expect(mailNotificationsAPI.getUnreadCount({ mailboxId: '   ' })).resolves.toEqual({ unread_count: 1 });
    await expect(mailNotificationsAPI.getUnreadCount({ force: true })).resolves.toEqual({ unread_count: 2 });

    window.localStorage.setItem('selected_database', 'branch-db');
    await expect(mailNotificationsAPI.getUnreadCount()).resolves.toEqual({ unread_count: 3 });

    expect(apiClientMock.get).toHaveBeenCalledTimes(3);
    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/mail/unread-count', {
      params: undefined,
      suppressAuthRequired: false,
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/mail/unread-count', {
      params: undefined,
      suppressAuthRequired: false,
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(3, '/mail/unread-count', {
      params: undefined,
      suppressAuthRequired: false,
    });
  });

  it('loads notification feed with raw params and no cache', async () => {
    const { mailNotificationsAPI } = await importMailNotificationsAPI();
    const feedParams = {
      limit: 5,
      unread_only: true,
      mailboxId: 'raw-camel-case',
    };
    apiClientMock.get
      .mockResolvedValueOnce({ data: { items: [{ id: 'mail-1' }], total_unread: 1 } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'mail-2' }], total_unread: 2 } });

    await expect(mailNotificationsAPI.getNotificationFeed(feedParams))
      .resolves.toEqual({ items: [{ id: 'mail-1' }], total_unread: 1 });
    await expect(mailNotificationsAPI.getNotificationFeed(feedParams))
      .resolves.toEqual({ items: [{ id: 'mail-2' }], total_unread: 2 });

    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/mail/notifications/feed', {
      params: feedParams,
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/mail/notifications/feed', {
      params: feedParams,
    });
  });

  it('keeps mailAPI notification methods compatible with the dedicated module and re-export', async () => {
    const { mailNotificationsAPI } = await importMailNotificationsAPI();
    const {
      mailAPI,
      mailNotificationsAPI: clientMailNotificationsAPI,
    } = await import('./client');

    expect(clientMailNotificationsAPI).toBe(mailNotificationsAPI);
    notificationMethods.forEach((methodName) => {
      expect(mailAPI[methodName]).toBe(mailNotificationsAPI[methodName]);
    });
  });

  it('resolves mailAPI notification methods through dedicated module getters', async () => {
    const { mailNotificationsAPI } = await importMailNotificationsAPI();
    const { mailAPI } = await import('./client');
    const params = { limit: 1 };
    const spy = vi.spyOn(mailNotificationsAPI, 'getNotificationFeed')
      .mockResolvedValue({ items: [] });

    await expect(mailAPI.getNotificationFeed(params)).resolves.toEqual({ items: [] });

    expect(spy).toHaveBeenCalledWith(params);
    spy.mockRestore();
  });
});

describe('chatDirectoryAPI contract', () => {
  const directoryMethods = [
    'getHealth',
    'getUsers',
    'listAiBots',
    'openAiBotConversation',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { ok: true } });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { id: 'ai-conv-1' } });
  });

  it('loads chat health, user directory, and AI bot directory through the dedicated module', async () => {
    const { chatDirectoryAPI } = await importChatDirectoryAPI();
    const params = { q: 'Ops / Level 1', limit: 8 };

    apiClientMock.get
      .mockResolvedValueOnce({ data: { status: 'ok' } })
      .mockResolvedValueOnce({ data: { items: [{ id: 7, full_name: 'Ops User' }] } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'bot/1 A', title: 'Ops Bot' }] } });

    await expect(chatDirectoryAPI.getHealth()).resolves.toEqual({ status: 'ok' });
    await expect(chatDirectoryAPI.getUsers(params)).resolves.toEqual({
      items: [{ id: 7, full_name: 'Ops User' }],
    });
    await expect(chatDirectoryAPI.listAiBots()).resolves.toEqual({
      items: [{ id: 'bot/1 A', title: 'Ops Bot' }],
    });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/chat/health');
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/chat/users', { params });
    expect(apiClientMock.get.mock.calls[1][1].params).toBe(params);
    expect(apiClientMock.get).toHaveBeenNthCalledWith(3, '/chat/ai/bots');
  });

  it('opens AI bot conversations with encoded bot ids', async () => {
    const { chatDirectoryAPI } = await importChatDirectoryAPI();

    await expect(chatDirectoryAPI.openAiBotConversation('bot/1 A')).resolves.toEqual({
      id: 'ai-conv-1',
    });

    expect(apiClientMock.post).toHaveBeenCalledWith('/chat/ai/bots/bot%2F1%20A/open');
  });

  it('keeps client chat directory methods compatible with the dedicated module and re-export', async () => {
    const { chatDirectoryAPI } = await importChatDirectoryAPI();
    const {
      chatAPI,
      chatDirectoryAPI: clientChatDirectoryAPI,
    } = await import('./client');

    expect(clientChatDirectoryAPI).toBe(chatDirectoryAPI);
    directoryMethods.forEach((methodName) => {
      expect(chatAPI[methodName]).toBe(chatDirectoryAPI[methodName]);
    });
  });

  it('resolves chatAPI directory methods through dedicated module getters', async () => {
    const { chatDirectoryAPI } = await importChatDirectoryAPI();
    const { chatAPI } = await import('./client');
    const params = { q: 'ops', limit: 8 };
    const healthSpy = vi.spyOn(chatDirectoryAPI, 'getHealth').mockResolvedValue({ status: 'spy' });
    const usersSpy = vi.spyOn(chatDirectoryAPI, 'getUsers').mockResolvedValue({ items: [] });
    const botsSpy = vi.spyOn(chatDirectoryAPI, 'listAiBots').mockResolvedValue({ items: [] });
    const openSpy = vi.spyOn(chatDirectoryAPI, 'openAiBotConversation')
      .mockResolvedValue({ id: 'conv-spy' });

    await expect(chatAPI.getHealth()).resolves.toEqual({ status: 'spy' });
    await expect(chatAPI.getUsers(params)).resolves.toEqual({ items: [] });
    await expect(chatAPI.listAiBots()).resolves.toEqual({ items: [] });
    await expect(chatAPI.openAiBotConversation('bot-1')).resolves.toEqual({ id: 'conv-spy' });

    expect(healthSpy).toHaveBeenCalledWith();
    expect(usersSpy).toHaveBeenCalledWith(params);
    expect(botsSpy).toHaveBeenCalledWith();
    expect(openSpy).toHaveBeenCalledWith('bot-1');

    healthSpy.mockRestore();
    usersSpy.mockRestore();
    botsSpy.mockRestore();
    openSpy.mockRestore();
  });
});

describe('chatNotificationsAPI contract', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { unread_total: 2 } });
    apiClientMock.put = vi.fn().mockResolvedValue({ data: { enabled: true } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { deleted: true } });
  });

  it('loads unread summary and push config through the dedicated module', async () => {
    const { chatNotificationsAPI } = await importChatNotificationsAPI();

    await expect(chatNotificationsAPI.getUnreadSummary()).resolves.toEqual({ unread_total: 2 });
    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/unread-summary');

    apiClientMock.get.mockResolvedValueOnce({
      data: {
        enabled: true,
        public_key: 'push-key',
      },
    });

    await expect(chatNotificationsAPI.getPushConfig()).resolves.toEqual({
      enabled: true,
      public_key: 'push-key',
    });
    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/push-config');
  });

  it('upserts and deletes push subscriptions through chat endpoints', async () => {
    const { chatNotificationsAPI } = await importChatNotificationsAPI();
    const payload = {
      endpoint: 'https://push.example/sub',
      expiration_time: null,
      keys: {
        p256dh: 'key-1',
        auth: 'key-2',
      },
    };

    await expect(chatNotificationsAPI.upsertPushSubscription(payload)).resolves.toEqual({
      enabled: true,
    });
    expect(apiClientMock.put).toHaveBeenCalledWith('/chat/push-subscription', payload);

    await expect(chatNotificationsAPI.deletePushSubscription(payload.endpoint)).resolves.toEqual({
      deleted: true,
    });
    expect(apiClientMock.delete).toHaveBeenCalledWith('/chat/push-subscription', {
      data: { endpoint: payload.endpoint },
    });
  });

  it('keeps client chat notification methods compatible with the dedicated module and re-export', async () => {
    const { chatNotificationsAPI } = await importChatNotificationsAPI();
    const {
      chatAPI,
      chatNotificationsAPI: clientChatNotificationsAPI,
    } = await import('./client');
    const notificationMethods = [
      'getUnreadSummary',
      'getPushConfig',
      'upsertPushSubscription',
      'deletePushSubscription',
    ];

    expect(clientChatNotificationsAPI).toBe(chatNotificationsAPI);
    notificationMethods.forEach((methodName) => {
      expect(chatAPI[methodName]).toBe(chatNotificationsAPI[methodName]);
    });
  });

  it('resolves chatAPI notification methods through the dedicated module getters', async () => {
    const { chatNotificationsAPI } = await importChatNotificationsAPI();
    const { chatAPI } = await import('./client');
    const spy = vi.spyOn(chatNotificationsAPI, 'getUnreadSummary')
      .mockResolvedValue({ unread_total: 5 });

    await expect(chatAPI.getUnreadSummary()).resolves.toEqual({ unread_total: 5 });

    expect(spy).toHaveBeenCalledWith();
    spy.mockRestore();
  });
});

describe('chatConversationsAPI contract', () => {
  const conversationMethods = [
    'getConversations',
    'createDirectConversation',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { items: [] } });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { id: 'direct-conv-1' } });
  });

  it('loads conversations and creates direct conversations through the dedicated module', async () => {
    const { chatConversationsAPI } = await importChatConversationsAPI();
    const params = { q: 'Ops / Level 1', limit: 20, kind: 'direct' };

    await expect(chatConversationsAPI.getConversations(params)).resolves.toEqual({ items: [] });
    await expect(chatConversationsAPI.createDirectConversation(42)).resolves.toEqual({
      id: 'direct-conv-1',
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/conversations', { params });
    expect(apiClientMock.get.mock.calls[0][1].params).toBe(params);
    expect(apiClientMock.post).toHaveBeenCalledWith('/chat/conversations/direct', {
      peer_user_id: 42,
    });
  });

  it('keeps client chat conversation methods compatible with the dedicated module and re-export', async () => {
    const { chatConversationsAPI } = await importChatConversationsAPI();
    const {
      chatAPI,
      chatConversationsAPI: clientChatConversationsAPI,
    } = await import('./client');

    expect(clientChatConversationsAPI).toBe(chatConversationsAPI);
    conversationMethods.forEach((methodName) => {
      expect(chatAPI[methodName]).toBe(chatConversationsAPI[methodName]);
    });
  });

  it('resolves chatAPI conversation methods through dedicated module getters', async () => {
    const { chatConversationsAPI } = await importChatConversationsAPI();
    const { chatAPI } = await import('./client');
    const params = { q: 'ops', limit: 20 };
    const listSpy = vi.spyOn(chatConversationsAPI, 'getConversations')
      .mockResolvedValue({ items: [{ id: 'conv-spy' }] });
    const directSpy = vi.spyOn(chatConversationsAPI, 'createDirectConversation')
      .mockResolvedValue({ id: 'direct-spy' });

    await expect(chatAPI.getConversations(params)).resolves.toEqual({
      items: [{ id: 'conv-spy' }],
    });
    await expect(chatAPI.createDirectConversation(42)).resolves.toEqual({ id: 'direct-spy' });

    expect(listSpy).toHaveBeenCalledWith(params);
    expect(directSpy).toHaveBeenCalledWith(42);

    listSpy.mockRestore();
    directSpy.mockRestore();
  });
});

describe('chatConversationDetailsAPI contract', () => {
  const conversationDetailMethods = [
    'getConversation',
    'updateConversationSettings',
    'deleteConversation',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { id: 'conv/1 A', title: 'Ops' } });
    apiClientMock.patch = vi.fn().mockResolvedValue({
      data: { id: 'conv/1 A', notifications_enabled: false },
    });
    apiClientMock.delete = vi.fn().mockResolvedValue({
      data: { ok: true, conversation_id: 'conv/1 A' },
    });
  });

  it('loads conversation detail and updates settings with encoded ids', async () => {
    const { chatConversationDetailsAPI } = await importChatConversationDetailsAPI();
    const controller = new AbortController();
    const payload = {
      notifications_enabled: false,
      muted_until: '2026-05-05T00:00:00Z',
    };

    await expect(chatConversationDetailsAPI.getConversation('conv/1 A', {
      signal: controller.signal,
      ignored: 'drop-me',
    })).resolves.toEqual({ id: 'conv/1 A', title: 'Ops' });
    await expect(chatConversationDetailsAPI.updateConversationSettings('conv/1 A', payload))
      .resolves.toEqual({ id: 'conv/1 A', notifications_enabled: false });
    await expect(chatConversationDetailsAPI.deleteConversation('conv/1 A'))
      .resolves.toEqual({ ok: true, conversation_id: 'conv/1 A' });

    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/conversations/conv%2F1%20A', {
      signal: controller.signal,
    });
    expect(apiClientMock.patch).toHaveBeenCalledWith(
      '/chat/conversations/conv%2F1%20A/settings',
      payload,
    );
    expect(apiClientMock.patch.mock.calls[0][1]).toBe(payload);
    expect(apiClientMock.delete).toHaveBeenCalledWith('/chat/conversations/conv%2F1%20A');
  });

  it('keeps client chat conversation detail methods compatible with the dedicated module and re-export', async () => {
    const { chatConversationDetailsAPI } = await importChatConversationDetailsAPI();
    const {
      chatAPI,
      chatConversationDetailsAPI: clientChatConversationDetailsAPI,
    } = await import('./client');

    expect(clientChatConversationDetailsAPI).toBe(chatConversationDetailsAPI);
    conversationDetailMethods.forEach((methodName) => {
      expect(chatAPI[methodName]).toBe(chatConversationDetailsAPI[methodName]);
    });
  });

  it('resolves chatAPI conversation detail methods through dedicated module getters', async () => {
    const { chatConversationDetailsAPI } = await importChatConversationDetailsAPI();
    const { chatAPI } = await import('./client');
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const payload = { notifications_enabled: true };
    const detailSpy = vi.spyOn(chatConversationDetailsAPI, 'getConversation')
      .mockResolvedValue({ id: 'conv-spy' });
    const settingsSpy = vi.spyOn(chatConversationDetailsAPI, 'updateConversationSettings')
      .mockResolvedValue({ id: 'settings-spy' });
    const deleteSpy = vi.spyOn(chatConversationDetailsAPI, 'deleteConversation')
      .mockResolvedValue({ ok: true });

    await expect(chatAPI.getConversation('conv-1', options)).resolves.toEqual({ id: 'conv-spy' });
    await expect(chatAPI.updateConversationSettings('conv-1', payload))
      .resolves.toEqual({ id: 'settings-spy' });
    await expect(chatAPI.deleteConversation('conv-1')).resolves.toEqual({ ok: true });

    expect(detailSpy).toHaveBeenCalledWith('conv-1', options);
    expect(settingsSpy).toHaveBeenCalledWith('conv-1', payload);
    expect(deleteSpy).toHaveBeenCalledWith('conv-1');
    detailSpy.mockRestore();
    settingsSpy.mockRestore();
    deleteSpy.mockRestore();
  });
});

describe('chatGroupsAPI contract', () => {
  const groupMethods = [
    'createGroupConversation',
    'addGroupMembers',
    'removeGroupMember',
    'updateGroupMemberRole',
    'transferGroupOwnership',
    'leaveGroup',
    'updateGroupProfile',
  ];

  beforeEach(() => {
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.patch = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { ok: true } });
  });

  it('uses dedicated group conversation endpoints with encoded ids and current body contracts', async () => {
    const { chatGroupsAPI } = await importChatGroupsAPI();
    const createPayload = { title: 'Ops', member_user_ids: [2, 1] };
    const profilePayload = { title: 'Ops / Updated', avatar_color: '#336699' };

    await expect(chatGroupsAPI.createGroupConversation(createPayload)).resolves.toEqual({ ok: true });
    await expect(chatGroupsAPI.addGroupMembers('conv/1 A', [7, 8])).resolves.toEqual({ ok: true });
    await expect(chatGroupsAPI.addGroupMembers('conv/1 A', 'not-array')).resolves.toEqual({ ok: true });
    await expect(chatGroupsAPI.removeGroupMember('conv/1 A', 'user/2 B')).resolves.toEqual({ ok: true });
    await expect(chatGroupsAPI.updateGroupMemberRole('conv/1 A', 'user/2 B', 'owner'))
      .resolves.toEqual({ ok: true });
    await expect(chatGroupsAPI.transferGroupOwnership('conv/1 A', 'user/2 B'))
      .resolves.toEqual({ ok: true });
    await expect(chatGroupsAPI.leaveGroup('conv/1 A')).resolves.toEqual({ ok: true });
    await expect(chatGroupsAPI.updateGroupProfile('conv/1 A', profilePayload))
      .resolves.toEqual({ ok: true });

    expect(apiClientMock.post.mock.calls[0]).toStrictEqual(['/chat/conversations/group', createPayload]);
    expect(apiClientMock.post.mock.calls[0][1]).toBe(createPayload);
    expect(apiClientMock.post.mock.calls[1]).toStrictEqual([
      '/chat/conversations/conv%2F1%20A/members',
      { member_user_ids: [7, 8] },
    ]);
    expect(apiClientMock.post.mock.calls[2]).toStrictEqual([
      '/chat/conversations/conv%2F1%20A/members',
      { member_user_ids: [] },
    ]);
    expect(apiClientMock.delete).toHaveBeenCalledWith(
      '/chat/conversations/conv%2F1%20A/members/user%2F2%20B',
    );
    expect(apiClientMock.patch.mock.calls[0]).toStrictEqual([
      '/chat/conversations/conv%2F1%20A/members/user%2F2%20B/role',
      { member_role: 'owner' },
    ]);
    expect(apiClientMock.post.mock.calls[3]).toStrictEqual([
      '/chat/conversations/conv%2F1%20A/ownership',
      { owner_user_id: 'user/2 B' },
    ]);
    expect(apiClientMock.post.mock.calls[4]).toStrictEqual([
      '/chat/conversations/conv%2F1%20A/leave',
    ]);
    expect(apiClientMock.patch.mock.calls[1]).toStrictEqual([
      '/chat/conversations/conv%2F1%20A/profile',
      profilePayload,
    ]);
    expect(apiClientMock.patch.mock.calls[1][1]).toBe(profilePayload);
  });

  it('keeps client chat group methods compatible with the dedicated module and re-export', async () => {
    const { chatGroupsAPI } = await importChatGroupsAPI();
    const { chatAPI, chatGroupsAPI: clientChatGroupsAPI } = await import('./client');

    expect(clientChatGroupsAPI).toBe(chatGroupsAPI);
    groupMethods.forEach((methodName) => {
      expect(chatAPI[methodName]).toBe(chatGroupsAPI[methodName]);
    });
  });

  it('resolves chatAPI group methods through dedicated module getters', async () => {
    const { chatGroupsAPI } = await importChatGroupsAPI();
    const { chatAPI } = await import('./client');
    const createPayload = { title: 'Ops' };
    const memberIds = [1, 2];
    const profilePayload = { title: 'New' };
    const createSpy = vi.spyOn(chatGroupsAPI, 'createGroupConversation')
      .mockResolvedValue({ id: 'group-spy' });
    const addSpy = vi.spyOn(chatGroupsAPI, 'addGroupMembers')
      .mockResolvedValue({ id: 'add-spy' });
    const removeSpy = vi.spyOn(chatGroupsAPI, 'removeGroupMember')
      .mockResolvedValue({ id: 'remove-spy' });
    const roleSpy = vi.spyOn(chatGroupsAPI, 'updateGroupMemberRole')
      .mockResolvedValue({ id: 'role-spy' });
    const ownershipSpy = vi.spyOn(chatGroupsAPI, 'transferGroupOwnership')
      .mockResolvedValue({ id: 'owner-spy' });
    const leaveSpy = vi.spyOn(chatGroupsAPI, 'leaveGroup')
      .mockResolvedValue({ left: true });
    const profileSpy = vi.spyOn(chatGroupsAPI, 'updateGroupProfile')
      .mockResolvedValue({ id: 'profile-spy' });

    await expect(chatAPI.createGroupConversation(createPayload)).resolves.toEqual({ id: 'group-spy' });
    await expect(chatAPI.addGroupMembers('conv-1', memberIds)).resolves.toEqual({ id: 'add-spy' });
    await expect(chatAPI.removeGroupMember('conv-1', 2)).resolves.toEqual({ id: 'remove-spy' });
    await expect(chatAPI.updateGroupMemberRole('conv-1', 2, 'admin')).resolves.toEqual({ id: 'role-spy' });
    await expect(chatAPI.transferGroupOwnership('conv-1', 2)).resolves.toEqual({ id: 'owner-spy' });
    await expect(chatAPI.leaveGroup('conv-1')).resolves.toEqual({ left: true });
    await expect(chatAPI.updateGroupProfile('conv-1', profilePayload)).resolves.toEqual({ id: 'profile-spy' });

    expect(createSpy).toHaveBeenCalledWith(createPayload);
    expect(addSpy).toHaveBeenCalledWith('conv-1', memberIds);
    expect(removeSpy).toHaveBeenCalledWith('conv-1', 2);
    expect(roleSpy).toHaveBeenCalledWith('conv-1', 2, 'admin');
    expect(ownershipSpy).toHaveBeenCalledWith('conv-1', 2);
    expect(leaveSpy).toHaveBeenCalledWith('conv-1');
    expect(profileSpy).toHaveBeenCalledWith('conv-1', profilePayload);

    createSpy.mockRestore();
    addSpy.mockRestore();
    removeSpy.mockRestore();
    roleSpy.mockRestore();
    ownershipSpy.mockRestore();
    leaveSpy.mockRestore();
    profileSpy.mockRestore();
  });
});

describe('chatAiActionsAPI contract', () => {
  const aiActionMethods = [
    'getConversationAiStatus',
    'confirmAiAction',
    'cancelAiAction',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({
      data: { conversation_id: 'conv/1 A', status: 'running' },
    });
    apiClientMock.post = vi.fn().mockResolvedValue({
      data: { id: 'action/1 A', status: 'confirmed' },
    });
  });

  it('loads conversation AI status with encoded conversation ids through the dedicated module', async () => {
    const { chatAiActionsAPI } = await importChatAiActionsAPI();

    await expect(chatAiActionsAPI.getConversationAiStatus('conv/1 A'))
      .resolves.toEqual({ conversation_id: 'conv/1 A', status: 'running' });

    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/conversations/conv%2F1%20A/ai-status');
  });

  it('confirms and cancels AI actions with encoded action ids and current body contracts', async () => {
    const { chatAiActionsAPI } = await importChatAiActionsAPI();
    const payload = { approve: true, draft: { subject: 'Hello' }, empty: null };

    await expect(chatAiActionsAPI.confirmAiAction('action/1 A', payload))
      .resolves.toEqual({ id: 'action/1 A', status: 'confirmed' });
    await expect(chatAiActionsAPI.confirmAiAction('action 2'))
      .resolves.toEqual({ id: 'action/1 A', status: 'confirmed' });
    await expect(chatAiActionsAPI.cancelAiAction('action/3 C'))
      .resolves.toEqual({ id: 'action/1 A', status: 'confirmed' });

    expect(apiClientMock.post.mock.calls[0]).toStrictEqual([
      '/chat/ai/actions/action%2F1%20A/confirm',
      payload,
    ]);
    expect(apiClientMock.post.mock.calls[0][1]).toBe(payload);
    expect(apiClientMock.post.mock.calls[1]).toStrictEqual([
      '/chat/ai/actions/action%202/confirm',
      {},
    ]);
    expect(apiClientMock.post.mock.calls[2]).toStrictEqual([
      '/chat/ai/actions/action%2F3%20C/cancel',
    ]);
  });

  it('keeps client chat AI action methods compatible with the dedicated module and re-export', async () => {
    const { chatAiActionsAPI } = await importChatAiActionsAPI();
    const {
      chatAPI,
      chatAiActionsAPI: clientChatAiActionsAPI,
    } = await import('./client');

    expect(clientChatAiActionsAPI).toBe(chatAiActionsAPI);
    aiActionMethods.forEach((methodName) => {
      expect(chatAPI[methodName]).toBe(chatAiActionsAPI[methodName]);
    });
  });

  it('resolves chatAPI AI action methods through dedicated module getters', async () => {
    const { chatAiActionsAPI } = await importChatAiActionsAPI();
    const { chatAPI } = await import('./client');
    const payload = { approve: true };
    const statusSpy = vi.spyOn(chatAiActionsAPI, 'getConversationAiStatus')
      .mockResolvedValue({ conversation_id: 'conv-spy', status: 'running' });
    const confirmSpy = vi.spyOn(chatAiActionsAPI, 'confirmAiAction')
      .mockResolvedValue({ id: 'action-spy', status: 'confirmed' });
    const cancelSpy = vi.spyOn(chatAiActionsAPI, 'cancelAiAction')
      .mockResolvedValue({ id: 'action-spy', status: 'cancelled' });

    await expect(chatAPI.getConversationAiStatus('conv-1'))
      .resolves.toEqual({ conversation_id: 'conv-spy', status: 'running' });
    await expect(chatAPI.confirmAiAction('action-1', payload))
      .resolves.toEqual({ id: 'action-spy', status: 'confirmed' });
    await expect(chatAPI.cancelAiAction('action-1'))
      .resolves.toEqual({ id: 'action-spy', status: 'cancelled' });

    expect(statusSpy).toHaveBeenCalledWith('conv-1');
    expect(confirmSpy).toHaveBeenCalledWith('action-1', payload);
    expect(cancelSpy).toHaveBeenCalledWith('action-1');
    statusSpy.mockRestore();
    confirmSpy.mockRestore();
    cancelSpy.mockRestore();
  });
});

describe('chatThreadMessagesAPI contract', () => {
  const threadMessageMethods = [
    'deleteChatMessage',
    'editChatMessage',
    'getThreadBootstrap',
    'getMessages',
    'searchMessages',
    'getMessageReads',
    'markRead',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { items: [] } });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.patch = vi.fn().mockResolvedValue({ data: { id: 'msg-1', body: 'updated' } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { deleted: true } });
  });

  it('loads thread bootstrap, paged messages, and message search with params and signal passthrough', async () => {
    const { chatThreadMessagesAPI } = await importChatThreadMessagesAPI();
    const controller = new AbortController();
    const bootstrapParams = { limit: 40 };
    const messagesParams = { limit: 25, after_message_id: 'msg-9' };
    const searchParams = { q: 'disk', limit: 20, before_message_id: 'msg-2' };

    await expect(chatThreadMessagesAPI.getThreadBootstrap('conv/1 A', bootstrapParams, {
      signal: controller.signal,
    })).resolves.toEqual({ items: [] });
    await expect(chatThreadMessagesAPI.getMessages('conv/1 A', messagesParams, {
      signal: controller.signal,
    })).resolves.toEqual({ items: [] });
    await expect(chatThreadMessagesAPI.searchMessages('conv/1 A', searchParams))
      .resolves.toEqual({ items: [] });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/chat/conversations/conv%2F1%20A/thread-bootstrap', {
      params: bootstrapParams,
      signal: controller.signal,
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/chat/conversations/conv%2F1%20A/messages', {
      params: messagesParams,
      signal: controller.signal,
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(3, '/chat/conversations/conv%2F1%20A/messages/search', {
      params: searchParams,
    });
  });

  it('deletes messages, loads read receipts, and marks conversations read with encoded ids', async () => {
    const { chatThreadMessagesAPI } = await importChatThreadMessagesAPI();

    await expect(chatThreadMessagesAPI.deleteChatMessage('conv/1 A', 'msg/2 B'))
      .resolves.toEqual({ deleted: true });
    await expect(chatThreadMessagesAPI.getMessageReads('msg/2 B')).resolves.toEqual({ items: [] });
    await expect(chatThreadMessagesAPI.markRead('conv/1 A', 'msg/2 B')).resolves.toEqual({ ok: true });

    expect(apiClientMock.delete)
      .toHaveBeenCalledWith('/chat/conversations/conv%2F1%20A/messages/msg%2F2%20B');
    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/messages/msg%2F2%20B/reads');
    expect(apiClientMock.post).toHaveBeenCalledWith('/chat/conversations/conv%2F1%20A/read', {
      message_id: 'msg/2 B',
    });
  });

  it('edits messages with encoded ids and body payload', async () => {
    const { chatThreadMessagesAPI } = await importChatThreadMessagesAPI();

    await expect(chatThreadMessagesAPI.editChatMessage('conv/1 A', 'msg/2 B', 'Updated text', {
      body_format: 'plain',
    })).resolves.toEqual({ id: 'msg-1', body: 'updated' });

    expect(apiClientMock.patch).toHaveBeenCalledWith(
      '/chat/conversations/conv%2F1%20A/messages/msg%2F2%20B',
      {
        body: 'Updated text',
        body_format: 'plain',
      },
    );
  });

  it('keeps client chat thread message methods compatible with the dedicated module and re-export', async () => {
    const { chatThreadMessagesAPI } = await importChatThreadMessagesAPI();
    const {
      chatAPI,
      chatThreadMessagesAPI: clientChatThreadMessagesAPI,
    } = await import('./client');

    expect(clientChatThreadMessagesAPI).toBe(chatThreadMessagesAPI);
    threadMessageMethods.forEach((methodName) => {
      expect(chatAPI[methodName]).toBe(chatThreadMessagesAPI[methodName]);
    });
  });

  it('resolves chatAPI thread message methods through dedicated module getters', async () => {
    const { chatThreadMessagesAPI } = await importChatThreadMessagesAPI();
    const { chatAPI } = await import('./client');
    const controller = new AbortController();
    const messagesParams = { limit: 1 };
    const messagesOptions = { signal: controller.signal };
    const messagesSpy = vi.spyOn(chatThreadMessagesAPI, 'getMessages')
      .mockResolvedValue({ items: [{ id: 'msg-spy' }] });
    const markReadSpy = vi.spyOn(chatThreadMessagesAPI, 'markRead')
      .mockResolvedValue({ message_id: 'msg-spy' });

    await expect(chatAPI.getMessages('conv-1', messagesParams, messagesOptions))
      .resolves.toEqual({ items: [{ id: 'msg-spy' }] });
    await expect(chatAPI.markRead('conv-1', 'msg-spy')).resolves.toEqual({ message_id: 'msg-spy' });

    expect(messagesSpy).toHaveBeenCalledWith('conv-1', messagesParams, messagesOptions);
    expect(markReadSpy).toHaveBeenCalledWith('conv-1', 'msg-spy');
    messagesSpy.mockRestore();
    markReadSpy.mockRestore();
  });
});

describe('chatMessageSendingAPI contract', () => {
  const messageSendingMethods = [
    'getShareableTasks',
    'sendMessage',
    'forwardMessage',
    'shareTask',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { ok: true } });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
  });

  it('loads shareable tasks with encoded conversation ids and raw params', async () => {
    const { chatMessageSendingAPI } = await importChatMessageSendingAPI();
    const params = { q: 'repair', limit: 25 };

    await expect(chatMessageSendingAPI.getShareableTasks('conv/1 A', params))
      .resolves.toEqual({ ok: true });

    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/conversations/conv%2F1%20A/shareable-tasks', {
      params,
    });
    expect(apiClientMock.get.mock.calls[0][1].params).toBe(params);
  });

  it('sends text messages with raw body text and current optional undefined fields', async () => {
    const { chatMessageSendingAPI } = await importChatMessageSendingAPI();

    await expect(chatMessageSendingAPI.sendMessage('conv/2 B', '  Hello  '))
      .resolves.toEqual({ ok: true });

    expect(apiClientMock.post.mock.calls[0]).toStrictEqual([
      '/chat/conversations/conv%2F2%20B/messages',
      {
        body: '  Hello  ',
        body_format: undefined,
        client_message_id: undefined,
        reply_to_message_id: undefined,
      },
    ]);

    await chatMessageSendingAPI.sendMessage('conv/2 B', 'Hello', {
      body_format: 'markdown',
      client_message_id: 'client/1',
      reply_to_message_id: 'msg/2',
    });

    expect(apiClientMock.post.mock.calls[1]).toStrictEqual([
      '/chat/conversations/conv%2F2%20B/messages',
      {
        body: 'Hello',
        body_format: 'markdown',
        client_message_id: 'client/1',
        reply_to_message_id: 'msg/2',
      },
    ]);
  });

  it('forwards messages with encoded conversation ids, raw source ids, and trimmed optional body', async () => {
    const { chatMessageSendingAPI } = await importChatMessageSendingAPI();

    await expect(chatMessageSendingAPI.forwardMessage('conv/3 C', 'msg/4 D', {
      body: '  note  ',
      body_format: 'markdown',
      reply_to_message_id: 'reply/5',
    })).resolves.toEqual({ ok: true });

    expect(apiClientMock.post.mock.calls[0]).toStrictEqual([
      '/chat/conversations/conv%2F3%20C/messages/forward',
      {
        source_message_id: 'msg/4 D',
        body: 'note',
        body_format: 'markdown',
        reply_to_message_id: 'reply/5',
      },
    ]);

    await chatMessageSendingAPI.forwardMessage('conv/3 C', 'msg/4 D', {
      body: '   ',
      body_format: '',
      reply_to_message_id: '',
    });

    expect(apiClientMock.post.mock.calls[1]).toStrictEqual([
      '/chat/conversations/conv%2F3%20C/messages/forward',
      {
        source_message_id: 'msg/4 D',
      },
    ]);
  });

  it('shares tasks with encoded conversation ids, raw task ids, and current optional undefined reply field', async () => {
    const { chatMessageSendingAPI } = await importChatMessageSendingAPI();

    await expect(chatMessageSendingAPI.shareTask('conv/4 D', 'task/5 E'))
      .resolves.toEqual({ ok: true });

    expect(apiClientMock.post.mock.calls[0]).toStrictEqual([
      '/chat/conversations/conv%2F4%20D/messages/task-share',
      {
        task_id: 'task/5 E',
        reply_to_message_id: undefined,
      },
    ]);

    await chatMessageSendingAPI.shareTask('conv/4 D', 'task/5 E', {
      reply_to_message_id: 'msg/6 F',
    });

    expect(apiClientMock.post.mock.calls[1]).toStrictEqual([
      '/chat/conversations/conv%2F4%20D/messages/task-share',
      {
        task_id: 'task/5 E',
        reply_to_message_id: 'msg/6 F',
      },
    ]);
  });

  it('keeps client chat message sending methods compatible with the dedicated module and re-export', async () => {
    const { chatMessageSendingAPI } = await importChatMessageSendingAPI();
    const {
      chatAPI,
      chatMessageSendingAPI: clientChatMessageSendingAPI,
    } = await import('./client');

    expect(clientChatMessageSendingAPI).toBe(chatMessageSendingAPI);
    messageSendingMethods.forEach((methodName) => {
      expect(chatAPI[methodName]).toBe(chatMessageSendingAPI[methodName]);
    });
  });

  it('resolves chatAPI message sending methods through dedicated module getters', async () => {
    const { chatMessageSendingAPI } = await importChatMessageSendingAPI();
    const { chatAPI } = await import('./client');
    const sendSpy = vi.spyOn(chatMessageSendingAPI, 'sendMessage')
      .mockResolvedValue({ id: 'sent-via-spy' });
    const shareSpy = vi.spyOn(chatMessageSendingAPI, 'shareTask')
      .mockResolvedValue({ id: 'shared-via-spy' });

    await expect(chatAPI.sendMessage('conv-1', 'Hello', { client_message_id: 'client-1' }))
      .resolves.toEqual({ id: 'sent-via-spy' });
    await expect(chatAPI.shareTask('conv-1', 'task-1', { reply_to_message_id: 'msg-1' }))
      .resolves.toEqual({ id: 'shared-via-spy' });

    expect(sendSpy).toHaveBeenCalledWith('conv-1', 'Hello', { client_message_id: 'client-1' });
    expect(shareSpy).toHaveBeenCalledWith('conv-1', 'task-1', { reply_to_message_id: 'msg-1' });
    sendSpy.mockRestore();
    shareSpy.mockRestore();
  });
});

describe('chatAttachmentsAPI contract', () => {
  const chatAttachmentMethods = [
    'getConversationAssetsSummary',
    'getConversationAttachments',
    'downloadAttachment',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
  });

  it('loads asset summary and attachment browser data with encoded conversation ids and raw params', async () => {
    const { chatAttachmentsAPI } = await importChatAttachmentsAPI();
    const params = { kind: 'image', limit: 12, before_attachment_id: 'att/9 A' };

    apiClientMock.get
      .mockResolvedValueOnce({ data: { photos_count: 1 } })
      .mockResolvedValueOnce({ data: { items: [], has_more: false } });

    await expect(chatAttachmentsAPI.getConversationAssetsSummary('conv/1 A'))
      .resolves.toEqual({ photos_count: 1 });
    await expect(chatAttachmentsAPI.getConversationAttachments('conv/1 A', params))
      .resolves.toEqual({ items: [], has_more: false });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      1,
      '/chat/conversations/conv%2F1%20A/assets-summary',
    );
    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      2,
      '/chat/conversations/conv%2F1%20A/attachments',
      { params },
    );
    expect(apiClientMock.get.mock.calls[1][1].params).toBe(params);
  });

  it('downloads attachments as raw blob responses with encoded message and attachment ids', async () => {
    const { chatAttachmentsAPI } = await importChatAttachmentsAPI();
    const blobResponse = {
      data: new Blob(['file']),
      headers: { 'content-type': 'text/plain' },
    };
    apiClientMock.get.mockResolvedValueOnce(blobResponse);

    const result = await chatAttachmentsAPI.downloadAttachment('msg/1 A', 'att/2 B');

    expect(result).toBe(blobResponse);
    expect(apiClientMock.get).toHaveBeenCalledWith(
      '/chat/messages/msg%2F1%20A/attachments/att%2F2%20B/file',
      { responseType: 'blob' },
    );
  });

  it('keeps client chat attachment methods compatible with the dedicated module and re-export', async () => {
    const { chatAttachmentsAPI } = await importChatAttachmentsAPI();
    const {
      chatAPI,
      chatAttachmentsAPI: clientChatAttachmentsAPI,
    } = await import('./client');

    expect(clientChatAttachmentsAPI).toBe(chatAttachmentsAPI);
    chatAttachmentMethods.forEach((methodName) => {
      expect(chatAPI[methodName]).toBe(chatAttachmentsAPI[methodName]);
    });
  });

  it('resolves chatAPI attachment methods through dedicated module getters', async () => {
    const { chatAttachmentsAPI } = await importChatAttachmentsAPI();
    const { chatAPI } = await import('./client');
    const params = { kind: 'file', limit: 12 };
    const listSpy = vi.spyOn(chatAttachmentsAPI, 'getConversationAttachments')
      .mockResolvedValue({ items: [{ id: 'att-spy' }] });
    const downloadSpy = vi.spyOn(chatAttachmentsAPI, 'downloadAttachment')
      .mockResolvedValue({ data: new Blob(['spy']) });

    await expect(chatAPI.getConversationAttachments('conv-1', params))
      .resolves.toEqual({ items: [{ id: 'att-spy' }] });
    await expect(chatAPI.downloadAttachment('msg-1', 'att-1'))
      .resolves.toEqual({ data: expect.any(Blob) });

    expect(listSpy).toHaveBeenCalledWith('conv-1', params);
    expect(downloadSpy).toHaveBeenCalledWith('msg-1', 'att-1');
    listSpy.mockRestore();
    downloadSpy.mockRestore();
  });
});

describe('chatUploadSessionsAPI contract', () => {
  const uploadSessionMethods = [
    'createUploadSession',
    'uploadFileChunk',
    'getUploadSession',
    'completeUploadSession',
    'cancelUploadSession',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { status: 'pending' } });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.put = vi.fn().mockResolvedValue({ data: { received_chunks: [0] } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { cancelled: true } });
  });

  it('creates upload sessions with encoded conversation ids, raw payloads, and signal passthrough', async () => {
    const { chatUploadSessionsAPI } = await importChatUploadSessionsAPI();
    const controller = new AbortController();
    const payload = {
      body: 'caption',
      files: [{ file_name: 'report.pdf', size: 5 }],
    };
    apiClientMock.post.mockResolvedValueOnce({
      data: { session_id: 'sess/1 A', files: [] },
    });

    await expect(chatUploadSessionsAPI.createUploadSession('conv/1 A', payload, {
      signal: controller.signal,
    })).resolves.toEqual({ session_id: 'sess/1 A', files: [] });

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/chat/conversations/conv%2F1%20A/upload-sessions',
      payload,
      { signal: controller.signal },
    );
    expect(apiClientMock.post.mock.calls[0][1]).toBe(payload);
  });

  it('uploads chunks with encoded ids, octet-stream headers, normalized offsets, and signal passthrough', async () => {
    const { chatUploadSessionsAPI } = await importChatUploadSessionsAPI();
    const controller = new AbortController();
    const chunk = new Blob(['hello']);

    await expect(chatUploadSessionsAPI.uploadFileChunk(
      'sess/1 A',
      'file/2 B',
      3,
      chunk,
      { offset: -50, signal: controller.signal },
    )).resolves.toEqual({ received_chunks: [0] });

    expect(apiClientMock.put).toHaveBeenCalledWith(
      '/chat/upload-sessions/sess%2F1%20A/files/file%2F2%20B/chunks/3',
      chunk,
      {
        params: { offset: 0 },
        headers: { 'Content-Type': 'application/octet-stream' },
        signal: controller.signal,
      },
    );
  });

  it('loads, completes, and cancels sessions with encoded ids and signal passthrough', async () => {
    const { chatUploadSessionsAPI } = await importChatUploadSessionsAPI();
    const controller = new AbortController();
    apiClientMock.get.mockResolvedValueOnce({ data: { session_id: 'sess/1 A' } });
    apiClientMock.post.mockResolvedValueOnce({ data: { id: 'msg-1' } });
    apiClientMock.delete.mockResolvedValueOnce({ data: { cancelled: true } });

    await expect(chatUploadSessionsAPI.getUploadSession('sess/1 A', {
      signal: controller.signal,
    })).resolves.toEqual({ session_id: 'sess/1 A' });
    await expect(chatUploadSessionsAPI.completeUploadSession('sess/1 A', {
      signal: controller.signal,
    })).resolves.toEqual({ id: 'msg-1' });
    await expect(chatUploadSessionsAPI.cancelUploadSession('sess/1 A', {
      signal: controller.signal,
    })).resolves.toEqual({ cancelled: true });

    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/upload-sessions/sess%2F1%20A', {
      signal: controller.signal,
    });
    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/chat/upload-sessions/sess%2F1%20A/complete',
      null,
      { signal: controller.signal },
    );
    expect(apiClientMock.delete).toHaveBeenCalledWith('/chat/upload-sessions/sess%2F1%20A', {
      signal: controller.signal,
    });
  });

  it('keeps client chat upload-session methods compatible with the dedicated module and re-export', async () => {
    const { chatUploadSessionsAPI } = await importChatUploadSessionsAPI();
    const {
      chatAPI,
      chatUploadSessionsAPI: clientChatUploadSessionsAPI,
    } = await import('./client');

    expect(clientChatUploadSessionsAPI).toBe(chatUploadSessionsAPI);
    uploadSessionMethods.forEach((methodName) => {
      expect(chatAPI[methodName]).toBe(chatUploadSessionsAPI[methodName]);
    });
  });

  it('resolves chatAPI upload-session methods through dedicated module getters', async () => {
    const { chatUploadSessionsAPI } = await importChatUploadSessionsAPI();
    const { chatAPI } = await import('./client');
    const controller = new AbortController();
    const payload = { files: [] };
    const createOptions = { signal: controller.signal };
    const createSpy = vi.spyOn(chatUploadSessionsAPI, 'createUploadSession')
      .mockResolvedValue({ session_id: 'via-spy' });
    const cancelSpy = vi.spyOn(chatUploadSessionsAPI, 'cancelUploadSession')
      .mockResolvedValue({ cancelled: true });

    await expect(chatAPI.createUploadSession('conv-1', payload, createOptions))
      .resolves.toEqual({ session_id: 'via-spy' });
    await expect(chatAPI.cancelUploadSession('sess-1'))
      .resolves.toEqual({ cancelled: true });

    expect(createSpy).toHaveBeenCalledWith('conv-1', payload, createOptions);
    expect(cancelSpy).toHaveBeenCalledWith('sess-1');
    createSpy.mockRestore();
    cancelSpy.mockRestore();
  });
});

describe('chatFileUploadsAPI contract', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.put = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.get.mockResolvedValue({ data: { files: [] } });
  });

  it('sends files through chat upload-session helpers with signal, progress, and response unwrapping', async () => {
    const { chatFileUploadsAPI } = await importChatFileUploadsAPI();
    const { chatUploadSessionsAPI } = await importChatUploadSessionsAPI();
    const controller = new AbortController();
    const progress = vi.fn();
    const file = new File(['hello'], 'report.pdf', { type: 'application/pdf' });
    const createSpy = vi.spyOn(chatUploadSessionsAPI, 'createUploadSession')
      .mockResolvedValue({
        session_id: 'sess-1',
        chunk_size_bytes: 2 * 1024 * 1024,
        files: [{
          file_id: 'file-1',
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          size: file.size,
          original_size: file.size,
          transfer_encoding: 'identity',
          chunk_count: 1,
          received_chunks: [],
        }],
      });
    const uploadSpy = vi.spyOn(chatUploadSessionsAPI, 'uploadFileChunk')
      .mockResolvedValue({ received_chunks: [0] });
    const completeSpy = vi.spyOn(chatUploadSessionsAPI, 'completeUploadSession')
      .mockResolvedValue({ id: 'msg-1', conversation_id: 'conv-1', kind: 'file' });

    await expect(chatFileUploadsAPI.sendFiles('conv-1', [file], {
      body: '  caption  ',
      reply_to_message_id: 'msg-1',
      signal: controller.signal,
      onUploadProgress: progress,
    })).resolves.toEqual({ id: 'msg-1', conversation_id: 'conv-1', kind: 'file' });

    expect(createSpy).toHaveBeenCalledWith('conv-1', {
      body: 'caption',
      reply_to_message_id: 'msg-1',
      files: [{
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        size: file.size,
        original_size: file.size,
        transfer_encoding: 'identity',
      }],
    }, { signal: controller.signal });
    expect(uploadSpy).toHaveBeenCalledWith(
      'sess-1',
      'file-1',
      0,
      expect.any(Blob),
      { offset: 0, signal: controller.signal },
    );
    expect(uploadSpy.mock.calls[0][3].size).toBe(file.size);
    expect(completeSpy).toHaveBeenCalledWith('sess-1', { signal: controller.signal });
    expect(progress.mock.calls[0][0]).toEqual({ loaded: 0, total: file.size });
    expect(progress.mock.calls.at(-1)[0]).toEqual({ loaded: file.size, total: file.size });

    createSpy.mockRestore();
    uploadSpy.mockRestore();
    completeSpy.mockRestore();
  });

  it('sends prepared gzip payload metadata through upload sessions', async () => {
    const { chatFileUploadsAPI } = await importChatFileUploadsAPI();
    const { chatUploadSessionsAPI } = await importChatUploadSessionsAPI();
    const displayFile = new File([new Uint8Array(4096)], 'report.pdf', {
      type: 'application/pdf',
      lastModified: 11,
    });
    const transferFile = new File([new Uint8Array(512)], 'report.pdf', {
      type: 'application/pdf',
      lastModified: 11,
    });
    const createSpy = vi.spyOn(chatUploadSessionsAPI, 'createUploadSession')
      .mockResolvedValue({
        session_id: 'sess-2',
        chunk_size_bytes: 2 * 1024 * 1024,
        files: [{
          file_id: 'file-2',
          size: transferFile.size,
          chunk_count: 1,
          received_chunks: [],
        }],
      });
    const uploadSpy = vi.spyOn(chatUploadSessionsAPI, 'uploadFileChunk')
      .mockResolvedValue({ received_chunks: [0] });
    const completeSpy = vi.spyOn(chatUploadSessionsAPI, 'completeUploadSession')
      .mockResolvedValue({ id: 'msg-2' });

    await expect(chatFileUploadsAPI.sendFiles('conv-1', [{
      file: displayFile,
      transferFile,
      preparedSize: displayFile.size,
      transferSize: transferFile.size,
      transferEncoding: 'gzip',
    }], { body: 'gzip transport' })).resolves.toEqual({ id: 'msg-2' });

    expect(createSpy.mock.calls[0][1]).toEqual({
      body: 'gzip transport',
      reply_to_message_id: undefined,
      files: [{
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        size: transferFile.size,
        original_size: displayFile.size,
        transfer_encoding: 'gzip',
      }],
    });
    expect(uploadSpy.mock.calls[0][3]).toBeInstanceOf(Blob);
    expect(uploadSpy.mock.calls[0][3].size).toBe(transferFile.size);

    createSpy.mockRestore();
    uploadSpy.mockRestore();
    completeSpy.mockRestore();
  });

  it('falls back to legacy multipart with signal, progress callback, metadata, and response-data unwrapping', async () => {
    const { chatFileUploadsAPI } = await importChatFileUploadsAPI();
    const { chatUploadSessionsAPI } = await importChatUploadSessionsAPI();
    const controller = new AbortController();
    const progress = vi.fn();
    const file = new File(['hello'], 'report.pdf', { type: 'application/pdf' });
    const createSpy = vi.spyOn(chatUploadSessionsAPI, 'createUploadSession')
      .mockRejectedValue(Object.assign(new Error('Service unavailable'), {
        response: { status: 503 },
      }));
    apiClientMock.post.mockResolvedValue({ data: { ok: true } });

    await expect(chatFileUploadsAPI.sendFiles('conv-1', [file], {
      body: '  fallback  ',
      signal: controller.signal,
      onUploadProgress: progress,
    })).resolves.toEqual({ ok: true });

    const multipartCall = apiClientMock.post.mock.calls.find(([url]) => (
      url === '/chat/conversations/conv-1/messages/files'
    ));
    expect(multipartCall).toBeTruthy();
    expect(multipartCall[1]).toBeInstanceOf(FormData);
    expect(multipartCall[1].get('body')).toBe('fallback');
    expect(multipartCall[1].getAll('files')).toHaveLength(1);
    expect(JSON.parse(String(multipartCall[1].get('files_meta_json') || '[]'))).toEqual([{
      original_size: file.size,
      transfer_encoding: 'identity',
    }]);
    expect(multipartCall[2]).toEqual({
      onUploadProgress: progress,
      signal: controller.signal,
    });
    expect(createSpy).toHaveBeenCalledWith(
      'conv-1',
      expect.any(Object),
      { signal: controller.signal },
    );

    createSpy.mockRestore();
  });

  it('keeps client chat file upload methods compatible with the dedicated module and re-export', async () => {
    const { chatFileUploadsAPI } = await importChatFileUploadsAPI();
    const {
      chatAPI,
      chatFileUploadsAPI: clientChatFileUploadsAPI,
    } = await import('./client');

    expect(clientChatFileUploadsAPI).toBe(chatFileUploadsAPI);
    expect(chatAPI.sendFiles).toBe(chatFileUploadsAPI.sendFiles);
  });

  it('resolves chatAPI sendFiles through the dedicated module getter', async () => {
    const { chatFileUploadsAPI } = await importChatFileUploadsAPI();
    const { chatAPI } = await import('./client');
    const options = { body: 'x' };
    const sendSpy = vi.spyOn(chatFileUploadsAPI, 'sendFiles')
      .mockResolvedValue({ id: 'file-spy' });

    await expect(chatAPI.sendFiles('conv-1', [], options)).resolves.toEqual({ id: 'file-spy' });

    expect(sendSpy).toHaveBeenCalledWith('conv-1', [], options);
    sendSpy.mockRestore();
  });
});

describe('chatAPI task share endpoints', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.put = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.get.mockResolvedValue({ data: { items: [] } });
  });

  it('loads shareable tasks for a conversation through the chat bridge API', async () => {
    const { chatAPI } = await import('./client');

    await chatAPI.getShareableTasks('conv-1', { q: 'Р°РєС‚', limit: 25 });

    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/conversations/conv-1/shareable-tasks', {
      params: { q: 'Р°РєС‚', limit: 25 },
    });
  });

  it('loads thread bootstrap and forward pagination through dedicated chat endpoints', async () => {
    const { chatAPI } = await import('./client');

    await chatAPI.getThreadBootstrap('conv-1', { limit: 40 });
    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/conversations/conv-1/thread-bootstrap', {
      params: { limit: 40 },
      signal: undefined,
    });

    await chatAPI.getMessages('conv-1', { limit: 25, after_message_id: 'msg-9' });
    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/conversations/conv-1/messages', {
      params: { limit: 25, after_message_id: 'msg-9' },
      signal: undefined,
    });
  });

  it('sends a task-share message without touching hub task APIs directly', async () => {
    const { chatAPI } = await import('./client');

    await chatAPI.shareTask('conv-1', 'task-77');

    expect(apiClientMock.post).toHaveBeenCalledWith('/chat/conversations/conv-1/messages/task-share', {
      task_id: 'task-77',
    });
  });

  it('forwards a chat message through the dedicated bridge endpoint without composer body fields', async () => {
    const { chatAPI } = await import('./client');

    await chatAPI.forwardMessage('conv-2', 'msg-77');

    expect(apiClientMock.post).toHaveBeenCalledWith('/chat/conversations/conv-2/messages/forward', {
      source_message_id: 'msg-77',
    });
  });

  it('sends a chat message with optional client_message_id for idempotent retries', async () => {
    const { chatAPI } = await import('./client');

    await chatAPI.sendMessage('conv-2', 'Hello', {
      client_message_id: 'client-msg-1',
      reply_to_message_id: 'msg-77',
      body_format: 'markdown',
    });

    expect(apiClientMock.post).toHaveBeenCalledWith('/chat/conversations/conv-2/messages', {
      body: 'Hello',
      body_format: 'markdown',
      client_message_id: 'client-msg-1',
      reply_to_message_id: 'msg-77',
    });
  });

  it('loads assets summary and filtered attachment browser data for a conversation', async () => {
    const { chatAPI } = await import('./client');

    await chatAPI.getConversationAssetsSummary('conv-1');
    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/conversations/conv-1/assets-summary');

    await chatAPI.getConversationAttachments('conv-1', {
      kind: 'image',
      limit: 12,
      before_attachment_id: 'att-9',
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/conversations/conv-1/attachments', {
      params: {
        kind: 'image',
        limit: 12,
        before_attachment_id: 'att-9',
      },
    });
  });

  it('loads unread summary and sends files through chat upload sessions by default', async () => {
    const { chatAPI } = await import('./client');
    const file = new File(['hello'], 'report.pdf', { type: 'application/pdf' });

    apiClientMock.post.mockImplementation(async (url) => {
      if (url === '/chat/conversations/conv-1/upload-sessions') {
        return {
          data: {
            session_id: 'sess-1',
            chunk_size_bytes: 2 * 1024 * 1024,
            expires_at: '2026-04-13T12:00:00Z',
            status: 'pending',
            files: [{
              file_id: 'file-1',
              file_name: 'report.pdf',
              mime_type: 'application/pdf',
              size: 5,
              original_size: 5,
              transfer_encoding: 'identity',
              chunk_count: 1,
              received_bytes: 0,
              received_chunks: [],
            }],
          },
        };
      }
      if (url === '/chat/upload-sessions/sess-1/complete') {
        return {
          data: {
            id: 'msg-1',
            conversation_id: 'conv-1',
            kind: 'file',
            body: 'caption',
            sender: { id: 1, username: 'author' },
            created_at: '2026-04-13T12:00:00Z',
            attachments: [],
          },
        };
      }
      throw new Error(`Unexpected POST ${url}`);
    });
    apiClientMock.put.mockResolvedValue({
      data: {
        session_id: 'sess-1',
        file_id: 'file-1',
        chunk_index: 0,
        already_present: false,
        received_bytes: 5,
        received_chunks: [0],
        file_complete: true,
      },
    });

    await chatAPI.getUnreadSummary();
    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/unread-summary');

    await chatAPI.sendFiles('conv-1', [file], {
      body: 'РџРѕРґРїРёСЃСЊ Рє С„Р°Р№Р»Сѓ',
      reply_to_message_id: 'msg-1',
    });

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/chat/conversations/conv-1/upload-sessions',
      {
        body: 'РџРѕРґРїРёСЃСЊ Рє С„Р°Р№Р»Сѓ',
        reply_to_message_id: 'msg-1',
        files: [{
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          size: 5,
          original_size: 5,
          transfer_encoding: 'identity',
        }],
      },
      { signal: undefined },
    );
    expect(apiClientMock.put).toHaveBeenCalledWith(
      '/chat/upload-sessions/sess-1/files/file-1/chunks/0',
      expect.any(Blob),
      {
        params: { offset: 0 },
        headers: { 'Content-Type': 'application/octet-stream' },
        signal: undefined,
      },
    );
    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/chat/upload-sessions/sess-1/complete',
      null,
      { signal: undefined },
    );
  });

  it('falls back to the legacy multipart endpoint when upload session creation fails before transfer', async () => {
    const { chatAPI } = await import('./client');
    const file = new File(['hello'], 'report.pdf', { type: 'application/pdf' });

    apiClientMock.post.mockImplementation(async (url) => {
      if (url === '/chat/conversations/conv-1/upload-sessions') {
        const error = new Error('Service unavailable');
        error.response = { status: 503 };
        throw error;
      }
      if (url === '/chat/conversations/conv-1/messages/files') {
        return { data: { ok: true } };
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    await chatAPI.sendFiles('conv-1', [file], { body: 'fallback' });

    const multipartCall = apiClientMock.post.mock.calls.find(([url]) => url === '/chat/conversations/conv-1/messages/files');
    expect(multipartCall).toBeTruthy();
    expect(multipartCall[2]).toEqual({
      onUploadProgress: undefined,
      signal: undefined,
    });
    expect(multipartCall[1]).toBeInstanceOf(FormData);
    expect(multipartCall[1].get('body')).toBe('fallback');
    expect(multipartCall[1].getAll('files')).toHaveLength(1);
    expect(JSON.parse(String(multipartCall[1].get('files_meta_json') || '[]'))).toEqual([{
      original_size: 5,
      transfer_encoding: 'identity',
    }]);
  });

  it('sends prepared gzip payload metadata through upload sessions', async () => {
    const { chatAPI } = await import('./client');
    const displayFile = new File([new Uint8Array(4096)], 'report.pdf', { type: 'application/pdf', lastModified: 11 });
    const transferFile = new File([new Uint8Array(512)], 'report.pdf', { type: 'application/pdf', lastModified: 11 });

    apiClientMock.post.mockImplementation(async (url) => {
      if (url === '/chat/conversations/conv-1/upload-sessions') {
        return {
          data: {
            session_id: 'sess-2',
            chunk_size_bytes: 2 * 1024 * 1024,
            expires_at: '2026-04-13T12:00:00Z',
            status: 'pending',
            files: [{
              file_id: 'file-2',
              file_name: 'report.pdf',
              mime_type: 'application/pdf',
              size: transferFile.size,
              original_size: displayFile.size,
              transfer_encoding: 'gzip',
              chunk_count: 1,
              received_bytes: 0,
              received_chunks: [],
            }],
          },
        };
      }
      if (url === '/chat/upload-sessions/sess-2/complete') {
        return { data: { id: 'msg-2', conversation_id: 'conv-1', kind: 'file', attachments: [] } };
      }
      throw new Error(`Unexpected POST ${url}`);
    });
    apiClientMock.put.mockResolvedValue({
      data: {
        session_id: 'sess-2',
        file_id: 'file-2',
        chunk_index: 0,
        already_present: false,
        received_bytes: transferFile.size,
        received_chunks: [0],
        file_complete: true,
      },
    });

    await chatAPI.sendFiles('conv-1', [{
      file: displayFile,
      transferFile,
      preparedSize: displayFile.size,
      transferSize: transferFile.size,
      transferEncoding: 'gzip',
    }], { body: 'gzip transport' });

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/chat/conversations/conv-1/upload-sessions',
      {
        body: 'gzip transport',
        reply_to_message_id: undefined,
        files: [{
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          size: transferFile.size,
          original_size: displayFile.size,
          transfer_encoding: 'gzip',
        }],
      },
      { signal: undefined },
    );
    const uploadChunkCall = apiClientMock.put.mock.calls.find(([url]) => url === '/chat/upload-sessions/sess-2/files/file-2/chunks/0');
    expect(uploadChunkCall).toBeTruthy();
    expect(uploadChunkCall[1]).toBeInstanceOf(Blob);
    expect(uploadChunkCall[1].size).toBe(transferFile.size);
  });

  it('loads push config and manages push subscription through chat endpoints', async () => {
    const { chatAPI } = await import('./client');

    await chatAPI.getPushConfig();
    expect(apiClientMock.get).toHaveBeenCalledWith('/chat/push-config');

    await chatAPI.upsertPushSubscription({
      endpoint: 'https://push.example/sub',
      expiration_time: null,
      keys: {
        p256dh: 'key-1',
        auth: 'key-2',
      },
      user_agent: 'Chrome',
      platform: 'Win32',
      browser_family: 'chrome',
      install_mode: 'browser',
    });
    expect(apiClientMock.put).toHaveBeenCalledWith('/chat/push-subscription', {
      endpoint: 'https://push.example/sub',
      expiration_time: null,
      keys: {
        p256dh: 'key-1',
        auth: 'key-2',
      },
      user_agent: 'Chrome',
      platform: 'Win32',
      browser_family: 'chrome',
      install_mode: 'browser',
    });

    await chatAPI.deletePushSubscription('https://push.example/sub');
    expect(apiClientMock.delete).toHaveBeenCalledWith('/chat/push-subscription', {
      data: { endpoint: 'https://push.example/sub' },
    });
  });
});

describe('hubNotificationsAPI', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.get.mockResolvedValue({ data: { items: [], latest_id: 'notif-1' } });
    window.localStorage.clear();
  });

  it('polls hub notifications through the dedicated hub notifications module', async () => {
    const { hubNotificationsAPI } = await import('./hubNotifications');

    const result = await hubNotificationsAPI.pollNotifications({
      since_id: 'notif-0',
      limit: 20,
    });

    expect(result).toEqual({ items: [], latest_id: 'notif-1' });
    expect(apiClientMock.get).toHaveBeenCalledWith('/hub/notifications/poll', {
      params: {
        since_id: 'notif-0',
        limit: 20,
      },
    });
  });

  it('loads unread counts and marks notifications through the dedicated module', async () => {
    const { hubNotificationsAPI } = await import('./hubNotifications');

    await hubNotificationsAPI.getUnreadCounts();
    await hubNotificationsAPI.markNotificationRead('notif/read 1');
    await hubNotificationsAPI.markAllNotificationsRead();

    expect(apiClientMock.get).toHaveBeenCalledWith('/hub/notifications/unread-counts');
    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/hub/notifications/notif%2Fread%201/read');
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/hub/notifications/read-all');
  });

  it('keeps the client hubAPI notification methods compatible with the dedicated module', async () => {
    const { hubNotificationsAPI } = await import('./hubNotifications');
    const { hubAPI } = await import('./client');

    expect(hubAPI.pollNotifications).toBe(hubNotificationsAPI.pollNotifications);
    expect(hubAPI.getUnreadCounts).toBe(hubNotificationsAPI.getUnreadCounts);
    expect(hubAPI.markNotificationRead).toBe(hubNotificationsAPI.markNotificationRead);
    expect(hubAPI.markAllNotificationsRead).toBe(hubNotificationsAPI.markAllNotificationsRead);
  });
});

describe('hubDashboardAPI', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({
      data: {
        announcements: [],
        tasks: [],
        counters: { unread_announcements: 0 },
      },
    });
    window.localStorage.clear();
  });

  it('loads dashboard data through the dedicated hub dashboard module', async () => {
    const { hubDashboardAPI } = await import('./hubDashboard');

    const result = await hubDashboardAPI.getDashboard({
      limit: 5,
      include_completed: false,
    });

    expect(result).toEqual({
      announcements: [],
      tasks: [],
      counters: { unread_announcements: 0 },
    });
    expect(apiClientMock.get).toHaveBeenCalledWith('/hub/dashboard', {
      params: {
        limit: 5,
        include_completed: false,
      },
    });
  });

  it('keeps the client hubAPI dashboard method compatible with the dedicated module', async () => {
    const { hubDashboardAPI } = await import('./hubDashboard');
    const { hubAPI } = await import('./client');

    expect(hubAPI.getDashboard).toBe(hubDashboardAPI.getDashboard);
  });
});

describe('hubAnnouncementsAPI', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { id: 'ann-1' } });
    apiClientMock.get.mockResolvedValue({ data: { id: 'ann-1' } });
    window.localStorage.clear();
  });

  it('creates announcements with JSON through the dedicated hub announcements module', async () => {
    const { hubAnnouncementsAPI } = await importHubAnnouncementsAPI();
    const payload = {
      title: 'Maintenance',
      preview: 'Short preview',
      body: 'Full body',
      priority: 'high',
      audience_scope: 'all',
    };

    const result = await hubAnnouncementsAPI.createAnnouncement(payload);

    expect(result).toEqual({ id: 'ann-1' });
    expect(apiClientMock.post).toHaveBeenCalledWith('/hub/announcements', payload);
  });

  it('creates announcements with files as multipart FormData', async () => {
    const { hubAnnouncementsAPI } = await importHubAnnouncementsAPI();
    const attachment = new Blob(['hello'], { type: 'text/plain' });

    await hubAnnouncementsAPI.createAnnouncement(
      {
        title: 'With file',
        body: 'Body',
        requires_ack: true,
        is_pinned: true,
      },
      [attachment],
    );

    expect(apiClientMock.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = apiClientMock.post.mock.calls[0];
    expect(url).toBe('/hub/announcements');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('title')).toBe('With file');
    expect(body.get('requires_ack')).toBe('1');
    expect(body.get('is_pinned')).toBe('1');
    expect(body.getAll('files')).toHaveLength(1);
    expect(body.getAll('files')[0]).toBeInstanceOf(Blob);
    expect(config).toEqual({
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  });

  it('returns the raw blob response when downloading announcement attachments', async () => {
    const { hubAnnouncementsAPI } = await importHubAnnouncementsAPI();
    const blobResponse = { data: new Blob(['file']), headers: { 'content-type': 'text/plain' } };
    apiClientMock.get.mockResolvedValueOnce(blobResponse);

    const result = await hubAnnouncementsAPI.downloadAnnouncementAttachment('ann/1', 'file 1');

    expect(result).toBe(blobResponse);
    expect(apiClientMock.get).toHaveBeenCalledWith(
      '/hub/announcements/ann%2F1/attachments/file%201/file',
      { responseType: 'blob' },
    );
  });

  it('keeps the client hubAPI announcement methods compatible with the dedicated module', async () => {
    const { hubAnnouncementsAPI } = await importHubAnnouncementsAPI();
    const { hubAPI } = await import('./client');

    expect(hubAPI.createAnnouncement).toBe(hubAnnouncementsAPI.createAnnouncement);
    expect(hubAPI.downloadAnnouncementAttachment).toBe(hubAnnouncementsAPI.downloadAnnouncementAttachment);
  });
});

describe('hubTasksAPI', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.patch = vi.fn().mockResolvedValue({ data: { id: 'task/1', title: 'Updated' } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { deleted: true } });
    apiClientMock.get.mockResolvedValue({ data: { items: [], total: 0 } });
    window.localStorage.clear();
  });

  it('loads, creates, updates, deletes, starts, and reviews tasks through the dedicated module', async () => {
    const { hubTasksAPI } = await importHubTasksAPI();
    const filters = {
      q: 'printer',
      status: 'open',
      project_id: 'project 1',
      assignee_id: 'user/1',
      limit: 20,
      offset: 40,
    };
    const createPayload = { title: 'Replace toner', project_id: 'project 1' };
    const updatePayload = { title: 'Replace toner cartridge', priority: 'high' };
    const reviewPayload = { decision: 'approve', comment: 'Looks good' };

    const listResult = await hubTasksAPI.getTasks(filters);
    apiClientMock.get.mockResolvedValueOnce({ data: { id: 'task/1', title: 'Replace toner' } });
    const detailResult = await hubTasksAPI.getTask('task/1');
    apiClientMock.post.mockResolvedValueOnce({ data: { id: 'task-new' } });
    const createResult = await hubTasksAPI.createTask(createPayload);
    const updateResult = await hubTasksAPI.updateTask('task/1', updatePayload);
    const deleteResult = await hubTasksAPI.deleteTask('task/1');
    apiClientMock.post.mockResolvedValueOnce({ data: { id: 'task/1', status: 'in_progress' } });
    const startResult = await hubTasksAPI.startTask('task/1');
    apiClientMock.post.mockResolvedValueOnce({ data: { id: 'task/1', status: 'approved' } });
    const reviewResult = await hubTasksAPI.reviewTask('task/1', reviewPayload);

    expect(listResult).toEqual({ items: [], total: 0 });
    expect(detailResult).toEqual({ id: 'task/1', title: 'Replace toner' });
    expect(createResult).toEqual({ id: 'task-new' });
    expect(updateResult).toEqual({ id: 'task/1', title: 'Updated' });
    expect(deleteResult).toEqual({ deleted: true });
    expect(startResult).toEqual({ id: 'task/1', status: 'in_progress' });
    expect(reviewResult).toEqual({ id: 'task/1', status: 'approved' });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/hub/tasks', { params: filters });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/hub/tasks/task%2F1');
    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/hub/tasks', createPayload);
    expect(apiClientMock.patch).toHaveBeenCalledWith('/hub/tasks/task%2F1', updatePayload);
    expect(apiClientMock.delete).toHaveBeenCalledWith('/hub/tasks/task%2F1');
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/hub/tasks/task%2F1/start');
    expect(apiClientMock.post).toHaveBeenNthCalledWith(3, '/hub/tasks/task%2F1/review', reviewPayload);
  });

  it('submits tasks as multipart FormData with optional comment and file', async () => {
    const { hubTasksAPI } = await importHubTasksAPI();
    const file = new File(['report'], 'report.txt', { type: 'text/plain' });
    apiClientMock.post.mockResolvedValueOnce({ data: { id: 'task/1', status: 'submitted' } });

    const result = await hubTasksAPI.submitTask({
      taskId: 'task/1',
      comment: 'Ready for review',
      file,
    });

    expect(result).toEqual({ id: 'task/1', status: 'submitted' });
    expect(apiClientMock.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = apiClientMock.post.mock.calls[0];
    expect(url).toBe('/hub/tasks/task%2F1/submit');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('comment')).toBe('Ready for review');
    expect(body.getAll('file')).toEqual([file]);
    expect(config).toEqual({
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  });

  it('keeps client hubAPI task methods compatible with the dedicated module', async () => {
    const { hubTasksAPI } = await importHubTasksAPI();
    const { hubAPI, hubTasksAPI: clientHubTasksAPI } = await import('./client');

    expect(clientHubTasksAPI).toBe(hubTasksAPI);
    expect(hubAPI.getTasks).toBe(hubTasksAPI.getTasks);
    expect(hubAPI.getTask).toBe(hubTasksAPI.getTask);
    expect(hubAPI.createTask).toBe(hubTasksAPI.createTask);
    expect(hubAPI.updateTask).toBe(hubTasksAPI.updateTask);
    expect(hubAPI.deleteTask).toBe(hubTasksAPI.deleteTask);
    expect(hubAPI.startTask).toBe(hubTasksAPI.startTask);
    expect(hubAPI.submitTask).toBe(hubTasksAPI.submitTask);
    expect(hubAPI.reviewTask).toBe(hubTasksAPI.reviewTask);
  });
});

describe('hubTaskSupportAPI', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { id: 'created' } });
    apiClientMock.patch = vi.fn().mockResolvedValue({ data: { id: 'updated' } });
    apiClientMock.get.mockResolvedValue({ data: [] });
    window.localStorage.clear();
  });

  it('loads task support directories with route params through the dedicated module', async () => {
    const { hubTaskSupportAPI } = await importHubTaskSupportAPI();

    await hubTaskSupportAPI.getAssignees({ q: 'ivan', role: 'assignee' });
    await hubTaskSupportAPI.getControllers({ q: 'petrov', active: true });
    await hubTaskSupportAPI.getTaskProjects({ q: 'infra', include_archived: false });
    await hubTaskSupportAPI.getTaskObjects({ project_id: 'project 1', q: 'printer' });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/hub/users/assignees', {
      params: { q: 'ivan', role: 'assignee' },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/hub/users/controllers', {
      params: { q: 'petrov', active: true },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(3, '/hub/task-projects', {
      params: { q: 'infra', include_archived: false },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(4, '/hub/task-objects', {
      params: { project_id: 'project 1', q: 'printer' },
    });
  });

  it('creates and updates task projects and objects through the dedicated module', async () => {
    const { hubTaskSupportAPI } = await importHubTaskSupportAPI();
    const projectPayload = { name: 'Infra', description: 'Core systems' };
    const objectPayload = { name: 'Printer', project_id: 'project 1' };

    await hubTaskSupportAPI.createTaskProject(projectPayload);
    await hubTaskSupportAPI.createTaskObject(objectPayload);
    await hubTaskSupportAPI.updateTaskProject('project/1', { name: 'Infra updated' });
    await hubTaskSupportAPI.updateTaskObject('object 1', { name: 'Printer updated' });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/hub/task-projects', projectPayload);
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/hub/task-objects', objectPayload);
    expect(apiClientMock.patch).toHaveBeenNthCalledWith(1, '/hub/task-projects/project%2F1', {
      name: 'Infra updated',
    });
    expect(apiClientMock.patch).toHaveBeenNthCalledWith(2, '/hub/task-objects/object%201', {
      name: 'Printer updated',
    });
  });

  it('keeps client hubAPI task support methods compatible with the dedicated module', async () => {
    const { hubTaskSupportAPI } = await importHubTaskSupportAPI();
    const { hubAPI, hubTaskSupportAPI: clientHubTaskSupportAPI } = await import('./client');

    expect(clientHubTaskSupportAPI).toBe(hubTaskSupportAPI);
    expect(hubAPI.getAssignees).toBe(hubTaskSupportAPI.getAssignees);
    expect(hubAPI.getControllers).toBe(hubTaskSupportAPI.getControllers);
    expect(hubAPI.getTaskProjects).toBe(hubTaskSupportAPI.getTaskProjects);
    expect(hubAPI.createTaskProject).toBe(hubTaskSupportAPI.createTaskProject);
    expect(hubAPI.updateTaskProject).toBe(hubTaskSupportAPI.updateTaskProject);
    expect(hubAPI.getTaskObjects).toBe(hubTaskSupportAPI.getTaskObjects);
    expect(hubAPI.createTaskObject).toBe(hubTaskSupportAPI.createTaskObject);
    expect(hubAPI.updateTaskObject).toBe(hubTaskSupportAPI.updateTaskObject);
  });
});

describe('hubTaskAnalyticsAPI', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { totals: { open: 2 }, by_status: [] } });
    window.localStorage.clear();
  });

  it('loads task analytics with params through the dedicated module', async () => {
    const { hubTaskAnalyticsAPI } = await importHubTaskAnalyticsAPI();

    const result = await hubTaskAnalyticsAPI.getTaskAnalytics({
      project_id: 'project 1',
      date_from: '2026-05-01',
      date_to: '2026-05-31',
      group_by: 'assignee',
    });

    expect(result).toEqual({ totals: { open: 2 }, by_status: [] });
    expect(apiClientMock.get).toHaveBeenCalledWith('/hub/tasks/analytics', {
      params: {
        project_id: 'project 1',
        date_from: '2026-05-01',
        date_to: '2026-05-31',
        group_by: 'assignee',
      },
    });
  });

  it('returns the raw blob response when exporting task analytics Excel', async () => {
    const { hubTaskAnalyticsAPI } = await importHubTaskAnalyticsAPI();
    const blobResponse = {
      data: new Blob(['xlsx']),
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    };
    apiClientMock.get.mockResolvedValueOnce(blobResponse);

    const result = await hubTaskAnalyticsAPI.exportTaskAnalyticsExcel({
      date_from: '2026-05-01',
      date_to: '2026-05-31',
    });

    expect(result).toBe(blobResponse);
    expect(apiClientMock.get).toHaveBeenCalledWith('/hub/tasks/analytics/export', {
      params: {
        date_from: '2026-05-01',
        date_to: '2026-05-31',
      },
      responseType: 'blob',
    });
  });

  it('keeps client hubAPI task analytics methods compatible with the dedicated module', async () => {
    const { hubTaskAnalyticsAPI } = await importHubTaskAnalyticsAPI();
    const { hubAPI, hubTaskAnalyticsAPI: clientHubTaskAnalyticsAPI } = await import('./client');

    expect(clientHubTaskAnalyticsAPI).toBe(hubTaskAnalyticsAPI);
    expect(hubAPI.getTaskAnalytics).toBe(hubTaskAnalyticsAPI.getTaskAnalytics);
    expect(hubAPI.exportTaskAnalyticsExcel).toBe(hubTaskAnalyticsAPI.exportTaskAnalyticsExcel);
  });
});

describe('hubTaskFilesAPI', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { id: 'attachment-1' } });
    apiClientMock.get.mockResolvedValue({
      data: new Blob(['file']),
      headers: { 'content-type': 'application/octet-stream' },
    });
    window.localStorage.clear();
  });

  it('uploads task attachments as multipart FormData through the dedicated module', async () => {
    const { hubTaskFilesAPI } = await importHubTaskFilesAPI();
    const file = new File(['hello'], 'evidence.txt', { type: 'text/plain' });

    const result = await hubTaskFilesAPI.uploadTaskAttachment({ taskId: 'task/1', file });

    expect(result).toEqual({ id: 'attachment-1' });
    expect(apiClientMock.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = apiClientMock.post.mock.calls[0];
    expect(url).toBe('/hub/tasks/task%2F1/attachments');
    expect(body).toBeInstanceOf(FormData);
    expect(body.getAll('file')).toHaveLength(1);
    expect(body.get('file')).toBe(file);
    expect(config).toEqual({
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  });

  it('returns the raw blob response when downloading task attachments', async () => {
    const { hubTaskFilesAPI } = await importHubTaskFilesAPI();
    const blobResponse = { data: new Blob(['attachment']), headers: { 'content-type': 'text/plain' } };
    apiClientMock.get.mockResolvedValueOnce(blobResponse);

    const result = await hubTaskFilesAPI.downloadTaskAttachment({
      taskId: 'task/1',
      attachmentId: 'file 1',
    });

    expect(result).toBe(blobResponse);
    expect(apiClientMock.get).toHaveBeenCalledWith(
      '/hub/tasks/task%2F1/attachments/file%201/file',
      { responseType: 'blob' },
    );
  });

  it('returns the raw blob response when downloading task reports', async () => {
    const { hubTaskFilesAPI } = await importHubTaskFilesAPI();
    const blobResponse = { data: new Blob(['report']), headers: { 'content-type': 'application/pdf' } };
    apiClientMock.get.mockResolvedValueOnce(blobResponse);

    const result = await hubTaskFilesAPI.downloadTaskReport('report/1');

    expect(result).toBe(blobResponse);
    expect(apiClientMock.get).toHaveBeenCalledWith('/hub/tasks/reports/report%2F1/file', {
      responseType: 'blob',
    });
  });

  it('keeps client hubAPI task file methods compatible with the dedicated module', async () => {
    const { hubTaskFilesAPI } = await importHubTaskFilesAPI();
    const { hubAPI, hubTaskFilesAPI: clientHubTaskFilesAPI } = await import('./client');

    expect(clientHubTaskFilesAPI).toBe(hubTaskFilesAPI);
    expect(hubAPI.uploadTaskAttachment).toBe(hubTaskFilesAPI.uploadTaskAttachment);
    expect(hubAPI.downloadTaskAttachment).toBe(hubTaskFilesAPI.downloadTaskAttachment);
    expect(hubAPI.downloadTaskReport).toBe(hubTaskFilesAPI.downloadTaskReport);
  });
});

describe('hubMarkdownAPI', () => {
  beforeEach(() => {
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { html: '<p>ok</p>' } });
    window.localStorage.clear();
  });

  it('transforms markdown through the dedicated module with normalized text and context', async () => {
    const { hubMarkdownAPI } = await importHubMarkdownAPI();

    const result = await hubMarkdownAPI.transformMarkdown({ text: 42, context: true });
    apiClientMock.post.mockResolvedValueOnce({ data: { html: '' } });
    await hubMarkdownAPI.transformMarkdown({ text: 0, context: null });

    expect(result).toEqual({ html: '<p>ok</p>' });
    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/hub/markdown/transform', {
      text: '42',
      context: 'true',
    });
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/hub/markdown/transform', {
      text: '',
      context: '',
    });
  });

  it('keeps client hubAPI markdown method compatible with the dedicated module', async () => {
    const { hubMarkdownAPI } = await importHubMarkdownAPI();
    const { hubAPI, hubMarkdownAPI: clientHubMarkdownAPI } = await import('./client');

    expect(clientHubMarkdownAPI).toBe(hubMarkdownAPI);
    expect(hubAPI.transformMarkdown).toBe(hubMarkdownAPI.transformMarkdown);
  });
});

describe('hubTaskActivityAPI', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.get.mockResolvedValue({ data: { items: [] } });
    window.localStorage.clear();
  });

  it('loads task comments and status log through the dedicated module', async () => {
    const { hubTaskActivityAPI } = await importHubTaskActivityAPI();

    await hubTaskActivityAPI.getTaskComments('task/1');
    await hubTaskActivityAPI.getTaskStatusLog('task 1');

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/hub/tasks/task%2F1/comments');
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/hub/tasks/task%201/status-log');
  });

  it('adds comments and marks comments seen through the dedicated module', async () => {
    const { hubTaskActivityAPI } = await importHubTaskActivityAPI();

    await hubTaskActivityAPI.addTaskComment('task/1', 'Ready for review');
    await hubTaskActivityAPI.markTaskCommentsSeen('task 1');

    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/hub/tasks/task%2F1/comments', {
      body: 'Ready for review',
    });
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/hub/tasks/task%201/comments/mark-seen');
  });

  it('keeps client hubAPI task activity methods compatible with the dedicated module', async () => {
    const { hubTaskActivityAPI } = await importHubTaskActivityAPI();
    const { hubAPI, hubTaskActivityAPI: clientHubTaskActivityAPI } = await import('./client');

    expect(clientHubTaskActivityAPI).toBe(hubTaskActivityAPI);
    expect(hubAPI.getTaskComments).toBe(hubTaskActivityAPI.getTaskComments);
    expect(hubAPI.addTaskComment).toBe(hubTaskActivityAPI.addTaskComment);
    expect(hubAPI.markTaskCommentsSeen).toBe(hubTaskActivityAPI.markTaskCommentsSeen);
    expect(hubAPI.getTaskStatusLog).toBe(hubTaskActivityAPI.getTaskStatusLog);
  });
});

describe('authTrustedDevicesAPI contract', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: [] });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { revoked: true } });
  });

  it('loads and revokes trusted devices with encoded device ids', async () => {
    apiClientMock.get.mockResolvedValueOnce({
      data: [{ id: 'device/1 A', label: 'Work PC' }],
    });
    const { authTrustedDevicesAPI } = await importAuthTrustedDevicesAPI();

    await expect(authTrustedDevicesAPI.getTrustedDevices()).resolves.toEqual([
      { id: 'device/1 A', label: 'Work PC' },
    ]);
    await expect(authTrustedDevicesAPI.revokeTrustedDevice('device/1 A')).resolves.toEqual({
      revoked: true,
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/auth/trusted-devices');
    expect(apiClientMock.delete).toHaveBeenCalledWith('/auth/trusted-devices/device%2F1%20A');
  });

  it('registers trusted devices with platform_only mapping and raw credential payloads', async () => {
    const credential = { id: 'cred-1', response: { clientDataJSON: 'raw' } };
    apiClientMock.post
      .mockResolvedValueOnce({ data: { challenge_id: 'challenge-1', public_key: { challenge: 'abc' } } })
      .mockResolvedValueOnce({ data: { ok: true, device_id: 'device-1' } });
    const { authTrustedDevicesAPI } = await importAuthTrustedDevicesAPI();

    await expect(authTrustedDevicesAPI.getTrustedDeviceRegistrationOptions('Work PC', { platformOnly: true }))
      .resolves.toEqual({ challenge_id: 'challenge-1', public_key: { challenge: 'abc' } });
    await expect(authTrustedDevicesAPI.verifyTrustedDeviceRegistration('challenge-1', credential, 'Work PC'))
      .resolves.toEqual({ ok: true, device_id: 'device-1' });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/auth/trusted-devices/register/options', {
      label: 'Work PC',
      platform_only: true,
    });
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/auth/trusted-devices/register/verify', {
      challenge_id: 'challenge-1',
      credential,
      label: 'Work PC',
    });
    expect(apiClientMock.post.mock.calls[1][1].credential).toBe(credential);
  });

  it('runs trusted-device login challenge endpoints without auth-required side effects', async () => {
    const credential = { id: 'trusted-cred', response: { signature: 'raw' } };
    apiClientMock.post
      .mockResolvedValueOnce({ data: { challenge_id: 'challenge/2 B', public_key: { challenge: 'xyz' } } })
      .mockResolvedValueOnce({ data: { status: 'authenticated', session_id: 'session-1' } });
    const { authTrustedDevicesAPI } = await importAuthTrustedDevicesAPI();

    await expect(authTrustedDevicesAPI.getTrustedDeviceAuthOptions('login/1 A'))
      .resolves.toEqual({ challenge_id: 'challenge/2 B', public_key: { challenge: 'xyz' } });
    await expect(authTrustedDevicesAPI.verifyTrustedDeviceAuth('login/1 A', 'challenge/2 B', credential))
      .resolves.toEqual({ status: 'authenticated', session_id: 'session-1' });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      1,
      '/auth/trusted-devices/auth/options',
      { login_challenge_id: 'login/1 A' },
      { suppressAuthRequired: true },
    );
    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      2,
      '/auth/trusted-devices/auth/verify',
      {
        login_challenge_id: 'login/1 A',
        challenge_id: 'challenge/2 B',
        credential,
      },
      { suppressAuthRequired: true },
    );
    expect(apiClientMock.post.mock.calls[1][1].credential).toBe(credential);
  });

  it('keeps client authAPI trusted-device methods compatible with the dedicated module and re-export', async () => {
    const { authTrustedDevicesAPI } = await importAuthTrustedDevicesAPI();
    const { authAPI, authTrustedDevicesAPI: clientAuthTrustedDevicesAPI } = await import('./client');

    expect(clientAuthTrustedDevicesAPI).toBe(authTrustedDevicesAPI);
    expect(authAPI.getTrustedDevices).toBe(authTrustedDevicesAPI.getTrustedDevices);
    expect(authAPI.revokeTrustedDevice).toBe(authTrustedDevicesAPI.revokeTrustedDevice);
    expect(authAPI.getTrustedDeviceRegistrationOptions)
      .toBe(authTrustedDevicesAPI.getTrustedDeviceRegistrationOptions);
    expect(authAPI.verifyTrustedDeviceRegistration)
      .toBe(authTrustedDevicesAPI.verifyTrustedDeviceRegistration);
    expect(authAPI.getTrustedDeviceAuthOptions).toBe(authTrustedDevicesAPI.getTrustedDeviceAuthOptions);
    expect(authAPI.verifyTrustedDeviceAuth).toBe(authTrustedDevicesAPI.verifyTrustedDeviceAuth);
  });
});

describe('authSessionsAPI contract', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: [] });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { ok: true } });
  });

  it('loads sessions and terminates encoded session ids through the dedicated module', async () => {
    apiClientMock.get.mockResolvedValueOnce({
      data: [{ id: 'session/1 A', status: 'active' }],
    });
    apiClientMock.delete.mockResolvedValueOnce({ data: { terminated: true } });

    const { authSessionsAPI } = await importAuthSessionsAPI();

    await expect(authSessionsAPI.getSessions()).resolves.toEqual([
      { id: 'session/1 A', status: 'active' },
    ]);
    await expect(authSessionsAPI.terminateSession('session/1 A')).resolves.toEqual({
      terminated: true,
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/auth/sessions');
    expect(apiClientMock.delete).toHaveBeenCalledWith('/auth/sessions/session%2F1%20A');
  });

  it('runs session cleanup and inactive-session purge through the dedicated module', async () => {
    apiClientMock.post
      .mockResolvedValueOnce({ data: { cleaned: 2 } })
      .mockResolvedValueOnce({ data: { purged: 3 } });

    const { authSessionsAPI } = await importAuthSessionsAPI();

    await expect(authSessionsAPI.cleanupSessions()).resolves.toEqual({ cleaned: 2 });
    await expect(authSessionsAPI.purgeInactiveSessions()).resolves.toEqual({ purged: 3 });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/auth/sessions/cleanup');
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/auth/sessions/purge-inactive');
  });

  it('keeps client authAPI session methods compatible with the dedicated module and re-export', async () => {
    const { authSessionsAPI } = await importAuthSessionsAPI();
    const { authAPI, authSessionsAPI: clientAuthSessionsAPI } = await import('./client');

    expect(clientAuthSessionsAPI).toBe(authSessionsAPI);
    expect(authAPI.getSessions).toBe(authSessionsAPI.getSessions);
    expect(authAPI.terminateSession).toBe(authSessionsAPI.terminateSession);
    expect(authAPI.cleanupSessions).toBe(authSessionsAPI.cleanupSessions);
    expect(authAPI.purgeInactiveSessions).toBe(authSessionsAPI.purgeInactiveSessions);
  });
});

describe('authPasswordLoginAPI contract', () => {
  beforeEach(() => {
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
  });

  it('submits password login without auth-required side effects', async () => {
    const { authPasswordLoginAPI } = await importAuthPasswordLoginAPI();

    await expect(authPasswordLoginAPI.login('ivanov', 'secret')).resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/auth/login',
      { username: 'ivanov', password: 'secret' },
      { suppressAuthRequired: true },
    );
  });

  it('starts and verifies mandatory 2FA setup with login challenge and TOTP code', async () => {
    const { authPasswordLoginAPI } = await importAuthPasswordLoginAPI();

    await expect(authPasswordLoginAPI.startTwoFactorSetup('login/1 A')).resolves.toEqual({ ok: true });
    await expect(authPasswordLoginAPI.verifyTwoFactorSetup('login/1 A', '123456'))
      .resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      1,
      '/auth/enable-2fa',
      { login_challenge_id: 'login/1 A' },
      { suppressAuthRequired: true },
    );
    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      2,
      '/auth/verify-2fa',
      { login_challenge_id: 'login/1 A', totp_code: '123456' },
      { suppressAuthRequired: true },
    );
  });

  it('verifies 2FA login with TOTP or backup code and preserves undefined defaults', async () => {
    const { authPasswordLoginAPI } = await importAuthPasswordLoginAPI();

    await expect(authPasswordLoginAPI.verifyTwoFactorLogin('login/1 A', { totp_code: '654321' }))
      .resolves.toEqual({ ok: true });
    await expect(authPasswordLoginAPI.verifyTwoFactorLogin('login/1 A', { backup_code: 'AAAA-BBBB' }))
      .resolves.toEqual({ ok: true });
    await expect(authPasswordLoginAPI.verifyTwoFactorLogin('login/1 A'))
      .resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      1,
      '/auth/verify-2fa-login',
      {
        login_challenge_id: 'login/1 A',
        totp_code: '654321',
        backup_code: undefined,
      },
      { suppressAuthRequired: true },
    );
    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      2,
      '/auth/verify-2fa-login',
      {
        login_challenge_id: 'login/1 A',
        totp_code: undefined,
        backup_code: 'AAAA-BBBB',
      },
      { suppressAuthRequired: true },
    );
    expect(apiClientMock.post).toHaveBeenNthCalledWith(
      3,
      '/auth/verify-2fa-login',
      {
        login_challenge_id: 'login/1 A',
        totp_code: undefined,
        backup_code: undefined,
      },
      { suppressAuthRequired: true },
    );
  });

  it('keeps client authAPI password/2FA methods compatible with the dedicated module and re-export', async () => {
    const { authPasswordLoginAPI } = await importAuthPasswordLoginAPI();
    const { authAPI, authPasswordLoginAPI: clientAuthPasswordLoginAPI } = await import('./client');

    expect(clientAuthPasswordLoginAPI).toBe(authPasswordLoginAPI);
    expect(authAPI.login).toBe(authPasswordLoginAPI.login);
    expect(authAPI.startTwoFactorSetup).toBe(authPasswordLoginAPI.startTwoFactorSetup);
    expect(authAPI.verifyTwoFactorSetup).toBe(authPasswordLoginAPI.verifyTwoFactorSetup);
    expect(authAPI.verifyTwoFactorLogin).toBe(authPasswordLoginAPI.verifyTwoFactorLogin);
  });
});

describe('authPasskeyLoginAPI contract', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { ok: true } });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
  });

  it('loads login mode for the current network before auth UI chooses passkey or password flow', async () => {
    const { authPasskeyLoginAPI } = await importAuthPasskeyLoginAPI();

    await expect(authPasskeyLoginAPI.getLoginMode()).resolves.toEqual({ ok: true });

    expect(apiClientMock.get).toHaveBeenCalledWith(
      '/auth/login-mode',
      { suppressAuthRequired: true },
    );
  });

  it('requests passwordless passkey login options without a login challenge', async () => {
    const { authPasskeyLoginAPI } = await importAuthPasskeyLoginAPI();

    await expect(authPasskeyLoginAPI.getPasskeyLoginOptions()).resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/auth/passkey-login/options',
      null,
      { suppressAuthRequired: true },
    );
  });

  it('verifies passwordless passkey login with challenge id and raw credential payload', async () => {
    const { authPasskeyLoginAPI } = await importAuthPasskeyLoginAPI();
    const credential = {
      id: 'cred-1',
      rawId: new Uint8Array([1, 2, 3]).buffer,
      type: 'public-key',
      response: {
        clientDataJSON: new Uint8Array([4, 5, 6]).buffer,
        authenticatorData: new Uint8Array([7, 8, 9]).buffer,
        signature: new Uint8Array([10, 11, 12]).buffer,
        userHandle: null,
      },
    };

    await expect(authPasskeyLoginAPI.verifyPasskeyLogin('challenge/1 A', credential))
      .resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/auth/passkey-login/verify',
      {
        challenge_id: 'challenge/1 A',
        credential,
      },
      { suppressAuthRequired: true },
    );
    expect(apiClientMock.post.mock.calls[0][1].credential).toBe(credential);
  });

  it('keeps client authAPI passkey-first methods compatible with the dedicated module and re-export', async () => {
    const { authPasskeyLoginAPI } = await importAuthPasskeyLoginAPI();
    const { authAPI, authPasskeyLoginAPI: clientAuthPasskeyLoginAPI } = await import('./client');

    expect(clientAuthPasskeyLoginAPI).toBe(authPasskeyLoginAPI);
    expect(authAPI.getLoginMode).toBe(authPasskeyLoginAPI.getLoginMode);
    expect(authAPI.getPasskeyLoginOptions).toBe(authPasskeyLoginAPI.getPasskeyLoginOptions);
    expect(authAPI.verifyPasskeyLogin).toBe(authPasskeyLoginAPI.verifyPasskeyLogin);
  });
});

describe('authAccountSecurityAPI contract', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { id: 7, username: 'ivanov' } });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
  });

  it('loads the current user with explicit auth-required suppression defaults', async () => {
    const { authAccountSecurityAPI } = await importAuthAccountSecurityAPI();

    await expect(authAccountSecurityAPI.getCurrentUser()).resolves.toEqual({
      id: 7,
      username: 'ivanov',
    });
    await expect(authAccountSecurityAPI.getCurrentUser({ suppressAuthRequired: true }))
      .resolves.toEqual({ id: 7, username: 'ivanov' });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      1,
      '/auth/me',
      { suppressAuthRequired: false },
    );
    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      2,
      '/auth/me',
      { suppressAuthRequired: true },
    );
  });

  it('logs out through the current auth endpoint and unwraps response data', async () => {
    const { authAccountSecurityAPI } = await importAuthAccountSecurityAPI();

    await expect(authAccountSecurityAPI.logout()).resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenCalledWith('/auth/logout');
  });

  it('regenerates backup codes and resets own 2FA through self-service endpoints', async () => {
    apiClientMock.post
      .mockResolvedValueOnce({ data: { backup_codes: ['AAAA-BBBB'] } })
      .mockResolvedValueOnce({ data: { success: true } });

    const { authAccountSecurityAPI } = await importAuthAccountSecurityAPI();

    await expect(authAccountSecurityAPI.regenerateBackupCodes()).resolves.toEqual({
      backup_codes: ['AAAA-BBBB'],
    });
    await expect(authAccountSecurityAPI.resetOwnTwoFactor()).resolves.toEqual({ success: true });

    expect(apiClientMock.post).toHaveBeenNthCalledWith(1, '/auth/backup-codes/regenerate');
    expect(apiClientMock.post).toHaveBeenNthCalledWith(2, '/auth/reset-2fa-self');
  });

  it('keeps client authAPI account-security methods compatible with the dedicated module and re-export', async () => {
    const { authAccountSecurityAPI } = await importAuthAccountSecurityAPI();
    const { authAPI, authAccountSecurityAPI: clientAuthAccountSecurityAPI } = await import('./client');

    expect(clientAuthAccountSecurityAPI).toBe(authAccountSecurityAPI);
    expect(authAPI.getCurrentUser).toBe(authAccountSecurityAPI.getCurrentUser);
    expect(authAPI.logout).toBe(authAccountSecurityAPI.logout);
    expect(authAPI.regenerateBackupCodes).toBe(authAccountSecurityAPI.regenerateBackupCodes);
    expect(authAPI.resetOwnTwoFactor).toBe(authAccountSecurityAPI.resetOwnTwoFactor);
  });
});

describe('authUserAdminAPI contract', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: [] });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.patch = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.put = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.delete = vi.fn().mockResolvedValue({ data: { ok: true } });
  });

  it('loads users and unwraps response data', async () => {
    apiClientMock.get.mockResolvedValueOnce({
      data: [{ id: 7, username: 'ivanov', role: 'admin' }],
    });

    const { authUserAdminAPI } = await importAuthUserAdminAPI();

    await expect(authUserAdminAPI.getUsers()).resolves.toEqual([
      { id: 7, username: 'ivanov', role: 'admin' },
    ]);

    expect(apiClientMock.get).toHaveBeenCalledWith('/auth/users');
  });

  it('creates and updates users with raw payloads and current unencoded update ids', async () => {
    const createPayload = {
      username: 'petrov',
      password: 'secret123',
      custom_permissions: ['settings.users.manage'],
    };
    const updatePayload = {
      full_name: 'Petr Petrov',
      role: 'manager',
      is_active: true,
    };
    apiClientMock.post.mockResolvedValueOnce({ data: { id: 'user/1 A', username: 'petrov' } });
    apiClientMock.patch.mockResolvedValueOnce({ data: { id: 'user/1 A', username: 'petrov' } });

    const { authUserAdminAPI } = await importAuthUserAdminAPI();

    await expect(authUserAdminAPI.createUser(createPayload)).resolves.toEqual({
      id: 'user/1 A',
      username: 'petrov',
    });
    await expect(authUserAdminAPI.updateUser('user/1 A', updatePayload)).resolves.toEqual({
      id: 'user/1 A',
      username: 'petrov',
    });

    expect(apiClientMock.post).toHaveBeenCalledWith('/auth/users', createPayload);
    expect(apiClientMock.post.mock.calls[0][1]).toBe(createPayload);
    expect(apiClientMock.patch).toHaveBeenCalledWith('/auth/users/user/1 A', updatePayload);
    expect(apiClientMock.patch.mock.calls[0][1]).toBe(updatePayload);
  });

  it('deletes users with the current unencoded user id URL behavior', async () => {
    apiClientMock.delete.mockResolvedValueOnce({ data: { deleted: true } });

    const { authUserAdminAPI } = await importAuthUserAdminAPI();

    await expect(authUserAdminAPI.deleteUser('user/1 A')).resolves.toEqual({ deleted: true });

    expect(apiClientMock.delete).toHaveBeenCalledWith('/auth/users/user/1 A');
  });

  it('loads and updates task delegates with current unencoded owner ids and raw array pass-through', async () => {
    const delegateItems = [
      { delegate_user_id: 12, role_type: 'assistant', is_active: true },
      { delegate_user_id: 13, role_type: 'deputy', is_active: false },
    ];
    apiClientMock.get.mockResolvedValueOnce({ data: delegateItems });
    apiClientMock.put.mockResolvedValueOnce({ data: { items: delegateItems } });

    const { authUserAdminAPI } = await importAuthUserAdminAPI();

    await expect(authUserAdminAPI.getTaskDelegates('user/1 A')).resolves.toEqual(delegateItems);
    await expect(authUserAdminAPI.updateTaskDelegates('user/1 A', delegateItems))
      .resolves.toEqual({ items: delegateItems });

    expect(apiClientMock.get).toHaveBeenCalledWith('/auth/users/user/1 A/task-delegates');
    expect(apiClientMock.put).toHaveBeenCalledWith(
      '/auth/users/user/1 A/task-delegates',
      { items: delegateItems },
    );
    expect(apiClientMock.put.mock.calls[0][1].items).toBe(delegateItems);
  });

  it('loads task delegates in bulk with comma-separated numeric owner ids', async () => {
    const bulkPayload = {
      items: [
        { owner_user_id: 1, task_delegate_links: [{ delegate_user_id: 12, role_type: 'assistant' }] },
        { owner_user_id: 2, task_delegate_links: [] },
      ],
    };
    apiClientMock.get.mockResolvedValueOnce({ data: bulkPayload });

    const { authUserAdminAPI } = await importAuthUserAdminAPI();

    await expect(authUserAdminAPI.getTaskDelegatesBulk([1, '2', 'bad', 0])).resolves.toEqual(bulkPayload);

    expect(apiClientMock.get).toHaveBeenCalledWith('/auth/task-delegates', {
      params: { owner_ids: '1,2' },
    });

    apiClientMock.get.mockClear();

    await expect(authUserAdminAPI.getTaskDelegatesBulk([])).resolves.toEqual({ items: [] });
    expect(apiClientMock.get).not.toHaveBeenCalled();
  });

  it('chunks large task delegate bulk requests to avoid oversized query strings', async () => {
    const ownerIds = Array.from({ length: 85 }, (_, index) => index + 1);
    apiClientMock.get
      .mockResolvedValueOnce({ data: { items: [{ owner_user_id: 1, task_delegate_links: [] }] } })
      .mockResolvedValueOnce({ data: { items: [{ owner_user_id: 81, task_delegate_links: [] }] } });

    const { authUserAdminAPI } = await importAuthUserAdminAPI();

    await expect(authUserAdminAPI.getTaskDelegatesBulk(ownerIds)).resolves.toEqual({
      items: [
        { owner_user_id: 1, task_delegate_links: [] },
        { owner_user_id: 81, task_delegate_links: [] },
      ],
    });

    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    expect(apiClientMock.get.mock.calls[0][1].params.owner_ids.split(',').length).toBe(80);
    expect(apiClientMock.get.mock.calls[1][1].params.owner_ids.split(',').length).toBe(5);
  });

  it('falls back to an empty delegate items array for non-array update payloads', async () => {
    const { authUserAdminAPI } = await importAuthUserAdminAPI();

    await expect(authUserAdminAPI.updateTaskDelegates('user/2 B', { bad: true }))
      .resolves.toEqual({ ok: true });

    expect(apiClientMock.put).toHaveBeenCalledWith(
      '/auth/users/user/2 B/task-delegates',
      { items: [] },
    );
  });

  it('keeps client authAPI user-admin methods compatible with the dedicated module and re-export', async () => {
    const { authUserAdminAPI } = await importAuthUserAdminAPI();
    const { authAPI, authUserAdminAPI: clientAuthUserAdminAPI } = await import('./client');

    expect(clientAuthUserAdminAPI).toBe(authUserAdminAPI);
    expect(authAPI.getUsers).toBe(authUserAdminAPI.getUsers);
    expect(authAPI.createUser).toBe(authUserAdminAPI.createUser);
    expect(authAPI.updateUser).toBe(authUserAdminAPI.updateUser);
    expect(authAPI.deleteUser).toBe(authUserAdminAPI.deleteUser);
    expect(authAPI.getTaskDelegates).toBe(authUserAdminAPI.getTaskDelegates);
    expect(authAPI.getTaskDelegatesBulk).toBe(authUserAdminAPI.getTaskDelegatesBulk);
    expect(authAPI.updateTaskDelegates).toBe(authUserAdminAPI.updateTaskDelegates);
    expect(authUserAdminAPI.syncAD).toBeUndefined();
    expect(authUserAdminAPI.adminResetTwoFactor).toBeUndefined();
    expect(authUserAdminAPI.changePassword).toBeUndefined();
    expect(authAPI.syncAD).toEqual(expect.any(Function));
    expect(authAPI.adminResetTwoFactor).toEqual(expect.any(Function));
    expect(authAPI.changePassword).toEqual(expect.any(Function));
  });
});


describe('settingsAPI app settings endpoints', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.patch = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.get.mockResolvedValue({
      data: {
        transfer_act_reminder_controller_username: 'kozlovskii.me',
        admin_login_allowed_ips: ['10.105.0.42'],
      },
    });
  });

  it('loads global app settings through the dedicated settings module', async () => {
    const { settingsAPI } = await import('./settings');

    await settingsAPI.getAppSettings();

    expect(apiClientMock.get).toHaveBeenCalledWith('/settings/app');
  });

  it('keeps the client settingsAPI export compatible with the dedicated module', async () => {
    const { settingsAPI: directSettingsAPI } = await import('./settings');
    const { settingsAPI: clientSettingsAPI } = await import('./client');

    expect(clientSettingsAPI).toBe(directSettingsAPI);
  });

  it('loads global app settings for reminder controller', async () => {
    const { settingsAPI } = await import('./client');

    await settingsAPI.getAppSettings();

    expect(apiClientMock.get).toHaveBeenCalledWith('/settings/app');
  });

  it('updates global app settings for reminder controller', async () => {
    const { settingsAPI } = await import('./client');

    await settingsAPI.updateAppSettings({
      transfer_act_reminder_controller_username: 'backup.admin',
    });

    expect(apiClientMock.patch).toHaveBeenCalledWith('/settings/app', {
      transfer_act_reminder_controller_username: 'backup.admin',
    });
  });

  it('updates global app settings for admin login allowlist', async () => {
    const { settingsAPI } = await import('./client');

    await settingsAPI.updateAppSettings({
      admin_login_allowed_ips: ['10.105.0.42', '10.105.0.43'],
    });

    expect(apiClientMock.patch).toHaveBeenCalledWith('/settings/app', {
      admin_login_allowed_ips: ['10.105.0.42', '10.105.0.43'],
    });
  });
});

describe('networksAPI.exportMapPdf', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.get.mockResolvedValue({
      data: new Blob([]),
      headers: { 'content-type': 'application/pdf' },
    });
  });

  it('requests backend PDF export through the dedicated networks module', async () => {
    const { networksAPI } = await import('./networks');

    await networksAPI.exportMapPdf(17);

    expect(apiClientMock.get).toHaveBeenCalledWith('/networks/maps/17/export-pdf', {
      params: {},
      responseType: 'blob',
    });
  });

  it('keeps the client networksAPI export compatible with the dedicated module', async () => {
    const { networksAPI: directNetworksAPI } = await import('./networks');
    const { networksAPI: clientNetworksAPI } = await import('./client');

    expect(clientNetworksAPI).toBe(directNetworksAPI);
  });

  it('keeps resolveSocketFio as a local alias for host context sync', async () => {
    const { networksAPI } = await import('./networks');

    await networksAPI.resolveSocketFio(12, { dry_run: true });

    expect(apiClientMock.post).toHaveBeenCalledWith('/networks/branches/12/sockets/sync-host-context', {
      dry_run: true,
    });
  });

  it('requests backend PDF export for the selected map', async () => {
    const { networksAPI } = await import('./client');

    await networksAPI.exportMapPdf(17);

    expect(apiClientMock.get).toHaveBeenCalledWith('/networks/maps/17/export-pdf', {
      params: {},
      responseType: 'blob',
    });
  });
});

describe('mfuAPI contract', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: {} });
    window.localStorage.clear();
  });

  it('loads grouped MFU devices through the dedicated module', async () => {
    const { mfuAPI } = await importMfuAPI();
    const params = { period_days: 365, recent_limit: 8, limit: 5000 };
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        grouped: {
          Branch: {
            Office: [{ key: 'device-1', model: 'HP' }],
          },
        },
      },
    });

    await expect(mfuAPI.getDevices(params)).resolves.toEqual({
      grouped: {
        Branch: {
          Office: [{ key: 'device-1', model: 'HP' }],
        },
      },
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/mfu/devices', { params });
  });

  it('loads monthly page counters with raw device params through the dedicated module', async () => {
    const { mfuAPI } = await importMfuAPI();
    const params = { device_key: 'INV/100 A', months: 6 };
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        device_key: 'INV/100 A',
        months: [{ month: '2026-04', pages_total: 1200 }],
      },
    });

    await expect(mfuAPI.getMonthlyPages(params)).resolves.toEqual({
      device_key: 'INV/100 A',
      months: [{ month: '2026-04', pages_total: 1200 }],
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/mfu/pages/monthly', { params });
  });

  it('keeps client mfuAPI compatibility through the dedicated module and re-export', async () => {
    const { mfuAPI } = await importMfuAPI();
    const { mfuAPI: clientMfuAPI } = await import('./client');

    expect(clientMfuAPI).toBe(mfuAPI);
    expect(clientMfuAPI.getDevices).toBe(mfuAPI.getDevices);
    expect(clientMfuAPI.getMonthlyPages).toBe(mfuAPI.getMonthlyPages);
  });
});

describe('scanOverviewAPI contract', () => {
  const scanOverviewMethods = [
    'getDashboard',
    'getBranches',
    'getHostsTable',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { total: 1, items: [] } });
    window.localStorage.clear();
  });

  it('loads dashboard summary through the dedicated scan overview module', async () => {
    const { scanOverviewAPI } = await importScanOverviewAPI();
    apiClientMock.get.mockResolvedValueOnce({
      data: { hosts_total: 12, incidents_new: 3 },
    });

    await expect(scanOverviewAPI.getDashboard()).resolves.toEqual({
      hosts_total: 12,
      incidents_new: 3,
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/dashboard');
  });

  it('loads branch options through the dedicated scan overview module', async () => {
    const { scanOverviewAPI } = await importScanOverviewAPI();
    apiClientMock.get.mockResolvedValueOnce({
      data: [{ branch: 'Tyumen', hosts_total: 4 }],
    });

    await expect(scanOverviewAPI.getBranches()).resolves.toEqual([
      { branch: 'Tyumen', hosts_total: 4 },
    ]);

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/branches');
  });

  it('requests paginated host table data through the dedicated scan overview module', async () => {
    const { scanOverviewAPI } = await importScanOverviewAPI();
    const params = {
      q: 'host-02',
      branch: 'Tyumen',
      status: 'new',
      severity: 'high',
      limit: 100,
      offset: 0,
      sort_by: 'incidents_new',
      sort_dir: 'desc',
    };

    await expect(scanOverviewAPI.getHostsTable(params)).resolves.toEqual({ total: 1, items: [] });

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/hosts/table', { params });
  });

  it('keeps client scanAPI overview methods compatible with the dedicated module and re-export', async () => {
    const { scanOverviewAPI } = await importScanOverviewAPI();
    const { scanAPI, scanOverviewAPI: clientScanOverviewAPI } = await import('./client');

    expect(clientScanOverviewAPI).toBe(scanOverviewAPI);
    scanOverviewMethods.forEach((methodName) => {
      expect(scanAPI[methodName]).toBe(scanOverviewAPI[methodName]);
    });
  });

  it('resolves scanAPI overview methods through the dedicated module getters', async () => {
    const { scanOverviewAPI } = await importScanOverviewAPI();
    const { scanAPI } = await import('./client');
    const params = { limit: 1 };
    const spy = vi.spyOn(scanOverviewAPI, 'getHostsTable').mockResolvedValue({ total: 0, items: [] });

    await expect(scanAPI.getHostsTable(params)).resolves.toEqual({ total: 0, items: [] });

    expect(spy).toHaveBeenCalledWith(params);
    spy.mockRestore();
  });
});

describe('scanAgentsAPI contract', () => {
  const scanAgentMethods = [
    'getAgents',
    'getAgentsTable',
    'getAgentsActivity',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { total: 1, items: [] } });
    window.localStorage.clear();
  });

  it('loads agent summaries through the dedicated scan agents module', async () => {
    const { scanAgentsAPI } = await importScanAgentsAPI();

    await expect(scanAgentsAPI.getAgents()).resolves.toEqual({ total: 1, items: [] });

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/agents');
  });

  it('requests paginated agent table data through the dedicated scan agents module', async () => {
    const { scanAgentsAPI } = await importScanAgentsAPI();

    await scanAgentsAPI.getAgentsTable({
      q: 'host-01',
      branch: 'Tyumen',
      online: 'online',
      task_status: 'active',
      limit: 25,
      offset: 50,
      sort_by: 'online',
      sort_dir: 'desc',
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/agents/table', {
      params: {
        q: 'host-01',
        branch: 'Tyumen',
        online: 'online',
        task_status: 'active',
        limit: 25,
        offset: 50,
        sort_by: 'online',
        sort_dir: 'desc',
      },
    });
  });

  it('requests batched agent activity updates with normalized repeated agent_id query params', async () => {
    const { scanAgentsAPI } = await importScanAgentsAPI();

    await scanAgentsAPI.getAgentsActivity([' agent-1 ', '', null, 'agent-2']);

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/agents/activity?agent_id=agent-1&agent_id=agent-2');
  });

  it('omits the activity query string when no valid agent ids are present', async () => {
    const { scanAgentsAPI } = await importScanAgentsAPI();

    await scanAgentsAPI.getAgentsActivity([' ', null]);
    await scanAgentsAPI.getAgentsActivity('agent-1');

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/scan/agents/activity');
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/scan/agents/activity');
  });

  it('keeps URLSearchParams encoding for special agent ids', async () => {
    const { scanAgentsAPI } = await importScanAgentsAPI();

    await scanAgentsAPI.getAgentsActivity(['agent/1', 'agent 2']);

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/agents/activity?agent_id=agent%2F1&agent_id=agent+2');
  });

  it('keeps client scanAPI agent methods compatible with the dedicated module and re-export', async () => {
    const { scanAgentsAPI } = await importScanAgentsAPI();
    const { scanAPI, scanAgentsAPI: clientScanAgentsAPI } = await import('./client');

    expect(clientScanAgentsAPI).toBe(scanAgentsAPI);
    scanAgentMethods.forEach((methodName) => {
      expect(scanAPI[methodName]).toBe(scanAgentsAPI[methodName]);
    });
  });

  it('resolves scanAPI agent methods through the dedicated module getters', async () => {
    const { scanAgentsAPI } = await importScanAgentsAPI();
    const { scanAPI } = await import('./client');
    const spy = vi.spyOn(scanAgentsAPI, 'getAgentsTable').mockResolvedValue({ total: 0, items: [] });

    await expect(scanAPI.getAgentsTable({ limit: 1 })).resolves.toEqual({ total: 0, items: [] });

    expect(spy).toHaveBeenCalledWith({ limit: 1 });
    spy.mockRestore();
  });
});

describe('scanIncidentsAPI contract', () => {
  const scanIncidentMethods = [
    'getIncidents',
    'getHostScanRuns',
    'getTaskObservations',
    'exportScanTaskIncidents',
    'ackIncident',
    'ackIncidentsBatch',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.get.mockResolvedValue({ data: { total: 1, items: [] } });
    window.localStorage.clear();
  });

  it('loads incidents through the dedicated scan incidents module with signal passthrough', async () => {
    const { scanIncidentsAPI } = await importScanIncidentsAPI();
    const controller = new AbortController();
    const params = {
      hostname: 'host/1',
      status: 'new',
      severity: 'high',
      limit: 50,
      offset: 100,
    };

    await expect(scanIncidentsAPI.getIncidents(params, { signal: controller.signal }))
      .resolves.toEqual({ total: 1, items: [] });

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/incidents', {
      params,
      signal: controller.signal,
    });
  });

  it('loads encoded host scan runs and task observations through the dedicated module', async () => {
    const { scanIncidentsAPI } = await importScanIncidentsAPI();

    await expect(scanIncidentsAPI.getHostScanRuns('HOST/1 A', { limit: 30, offset: 0 }))
      .resolves.toEqual({ total: 1, items: [] });
    await expect(scanIncidentsAPI.getTaskObservations('task/1 A', { limit: 10, offset: 5 }))
      .resolves.toEqual({ total: 1, items: [] });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/scan/hosts/HOST%2F1%20A/scan-runs', {
      params: { limit: 30, offset: 0 },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/scan/tasks/task%2F1%20A/observations', {
      params: { limit: 10, offset: 5 },
    });
  });

  it('returns the raw blob response when exporting task incidents and encodes task ids', async () => {
    const { scanIncidentsAPI } = await importScanIncidentsAPI();
    const blobResponse = { data: new Blob(['xlsx']), headers: { 'content-type': 'application/vnd.ms-excel' } };
    apiClientMock.get.mockResolvedValueOnce(blobResponse);

    const result = await scanIncidentsAPI.exportScanTaskIncidents('task/1 A');

    expect(result).toBe(blobResponse);
    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/tasks/task%2F1%20A/incidents/export', {
      responseType: 'blob',
    });
  });

  it('acks one incident without trusting a client-supplied actor', async () => {
    const { scanIncidentsAPI } = await importScanIncidentsAPI();

    await expect(scanIncidentsAPI.ackIncident('incident/1 A'))
      .resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenCalledWith('/scan/incidents/incident%2F1%20A/ack', {});
  });

  it('posts bulk ack payloads unchanged through the dedicated scan incidents module', async () => {
    const { scanIncidentsAPI } = await importScanIncidentsAPI();
    const payload = {
      incident_ids: ['incident/1', 'incident 2'],
      ack_by: 'petrov',
      reason: 'reviewed',
    };

    await expect(scanIncidentsAPI.ackIncidentsBatch(payload)).resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenCalledWith('/scan/incidents/bulk-ack', payload);
  });

  it('keeps client scanAPI incident methods compatible with the dedicated module and re-export', async () => {
    const { scanIncidentsAPI } = await importScanIncidentsAPI();
    const { scanAPI, scanIncidentsAPI: clientScanIncidentsAPI } = await import('./client');

    expect(clientScanIncidentsAPI).toBe(scanIncidentsAPI);
    scanIncidentMethods.forEach((methodName) => {
      expect(scanAPI[methodName]).toBe(scanIncidentsAPI[methodName]);
    });
  });

  it('resolves scanAPI incident methods through the dedicated module getters', async () => {
    const { scanIncidentsAPI } = await importScanIncidentsAPI();
    const { scanAPI } = await import('./client');
    const controller = new AbortController();
    const params = { limit: 1 };
    const options = { signal: controller.signal };
    const spy = vi.spyOn(scanIncidentsAPI, 'getIncidents').mockResolvedValue({ total: 0, items: [] });

    await expect(scanAPI.getIncidents(params, options)).resolves.toEqual({ total: 0, items: [] });

    expect(spy).toHaveBeenCalledWith(params, options);
    spy.mockRestore();
  });
});

describe('scanTasksAPI contract', () => {
  const scanTaskMethods = [
    'getPatterns',
    'getTasks',
    'createTask',
  ];

  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.get.mockResolvedValue({ data: { total: 1, items: [] } });
    window.localStorage.clear();
  });

  it('loads scan patterns through the dedicated scan tasks module', async () => {
    const { scanTasksAPI } = await importScanTasksAPI();
    apiClientMock.get.mockResolvedValueOnce({
      data: { patterns: [{ id: 'pattern-1', name: 'Quick scan' }] },
    });

    await expect(scanTasksAPI.getPatterns()).resolves.toEqual({
      patterns: [{ id: 'pattern-1', name: 'Quick scan' }],
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/patterns');
  });

  it('passes getTasks params through to the scan tasks endpoint', async () => {
    const { scanTasksAPI } = await importScanTasksAPI();
    const params = {
      agent_id: 'agent-1',
      status: 'active',
      command: 'scan_now',
      limit: 20,
      offset: 40,
      sort_by: 'created_at',
      sort_dir: 'desc',
    };

    await expect(scanTasksAPI.getTasks(params)).resolves.toEqual({ total: 1, items: [] });

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/tasks', { params });
  });

  it('posts createTask payloads unchanged through the dedicated scan tasks module', async () => {
    const { scanTasksAPI } = await importScanTasksAPI();
    const payload = {
      agent_id: 'agent-1',
      pattern_id: 'pattern-1',
      command: 'scan_now',
      options: {
        include_profiles: true,
        max_depth: 3,
      },
    };

    await expect(scanTasksAPI.createTask(payload)).resolves.toEqual({ ok: true });

    expect(apiClientMock.post).toHaveBeenCalledWith('/scan/tasks', payload);
  });

  it('keeps client scanAPI task methods compatible with the dedicated module and re-export', async () => {
    const { scanTasksAPI } = await importScanTasksAPI();
    const { scanAPI, scanTasksAPI: clientScanTasksAPI } = await import('./client');

    expect(clientScanTasksAPI).toBe(scanTasksAPI);
    scanTaskMethods.forEach((methodName) => {
      expect(scanAPI[methodName]).toBe(scanTasksAPI[methodName]);
    });
  });

  it('resolves scanAPI task methods through the dedicated module getters', async () => {
    const { scanTasksAPI } = await importScanTasksAPI();
    const { scanAPI } = await import('./client');
    const params = { status: 'active', limit: 1 };
    const spy = vi.spyOn(scanTasksAPI, 'getTasks').mockResolvedValue({ total: 0, items: [] });

    await expect(scanAPI.getTasks(params)).resolves.toEqual({ total: 0, items: [] });

    expect(spy).toHaveBeenCalledWith(params);
    spy.mockRestore();
  });
});

describe('scanHostsAPI contract', () => {
  beforeEach(() => {
    vi.resetModules();
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: [] });
    window.localStorage.clear();
  });

  it('loads hosts through the dedicated scan hosts module', async () => {
    const { scanHostsAPI } = await importScanHostsAPI();
    const params = { limit: 50, offset: 100, q: 'host-01' };
    apiClientMock.get.mockResolvedValueOnce({
      data: [{ hostname: 'HOST-01', incidents_total: 2 }],
    });

    await expect(scanHostsAPI.getHosts(params)).resolves.toEqual([
      { hostname: 'HOST-01', incidents_total: 2 },
    ]);

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/hosts', { params });
  });

  it('marks scan hosts 404s and falls back to aggregated incident hosts', async () => {
    const { scanHostsAPI } = await importScanHostsAPI();
    const notFoundError = { response: { status: 404 } };
    apiClientMock.get
      .mockRejectedValueOnce(notFoundError)
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              hostname: 'host-01',
              status: 'new',
              severity: 'low',
              created_at: '2026-05-04T05:00:00Z',
              file_ext: 'txt',
              source_kind: 'filesystem',
            },
            {
              hostname: 'HOST-01',
              status: 'acknowledged',
              severity: 'high',
              detected_at: '2026-05-04T06:00:00Z',
              extension: 'exe',
              source: 'process',
            },
            {
              hostname: 'host-02',
              status: 'new',
              severity: 'medium',
              updated_at: '2026-05-04T07:00:00Z',
              file_ext: 'dll',
              source_kind: 'registry',
            },
          ],
        },
      });

    await expect(scanHostsAPI.getHosts({ limit: 50 })).resolves.toEqual([
      {
        hostname: 'HOST-01',
        incidents_total: 2,
        incidents_new: 1,
        last_incident_at: 1777874400,
        top_severity: 'high',
        top_exts: ['exe', 'txt'],
        top_source_kinds: ['filesystem', 'process'],
      },
      {
        hostname: 'HOST-02',
        incidents_total: 1,
        incidents_new: 1,
        last_incident_at: 1777878000,
        top_severity: 'medium',
        top_exts: ['dll'],
        top_source_kinds: ['registry'],
      },
    ]);

    expect(Number(window.localStorage.getItem('itinvent_scan_hosts_404'))).toBeGreaterThan(0);
    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/scan/hosts', { params: { limit: 50 } });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/scan/incidents', {
      params: { limit: 500, offset: 0 },
    });
  });

  it('skips the scan hosts endpoint on a fresh import when the 404 flag exists', async () => {
    window.localStorage.setItem('itinvent_scan_hosts_404', String(Date.now()));
    const { scanHostsAPI } = await importScanHostsAPI();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        items: [
          {
            hostname: 'host-03',
            status: 'new',
            severity: 'medium',
            created_at: '2026-05-04T08:00:00Z',
          },
        ],
      },
    });

    await expect(scanHostsAPI.getHosts({ limit: 200 })).resolves.toEqual([
      {
        hostname: 'HOST-03',
        incidents_total: 1,
        incidents_new: 1,
        last_incident_at: 1777881600,
        top_severity: 'medium',
        top_exts: [],
        top_source_kinds: [],
      },
    ]);

    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/incidents', {
      params: { limit: 800, offset: 0 },
    });
  });

  it('rethrows non-404 scan hosts errors without falling back', async () => {
    const { scanHostsAPI } = await importScanHostsAPI();
    const serverError = { response: { status: 500 }, message: 'scan service failed' };
    apiClientMock.get.mockRejectedValueOnce(serverError);

    await expect(scanHostsAPI.getHosts({ limit: 10 })).rejects.toBe(serverError);

    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/hosts', { params: { limit: 10 } });
  });

  it('keeps client scanAPI hosts compatibility through the dedicated module getter', async () => {
    const { scanHostsAPI } = await importScanHostsAPI();
    const { scanAPI, scanHostsAPI: clientScanHostsAPI } = await import('./client');
    const spy = vi.spyOn(scanHostsAPI, 'getHosts').mockResolvedValue([{ hostname: 'HOST-04' }]);

    expect(clientScanHostsAPI).toBe(scanHostsAPI);
    await expect(scanAPI.getHosts({ limit: 1 })).resolves.toEqual([{ hostname: 'HOST-04' }]);
    expect(spy).toHaveBeenCalledWith({ limit: 1 });

    spy.mockRestore();
  });
});

describe('scanAPI table endpoints', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { total: 1, items: [] } });
  });

  it('requests paginated agents table data with server-side filters', async () => {
    const { scanAPI } = await import('./client');

    await scanAPI.getAgentsTable({
      q: 'host-01',
      branch: 'РўСЋРјРµРЅСЊ',
      online: 'online',
      task_status: 'active',
      limit: 25,
      offset: 50,
      sort_by: 'online',
      sort_dir: 'desc',
    });

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/agents/table', {
      params: {
        q: 'host-01',
        branch: 'РўСЋРјРµРЅСЊ',
        online: 'online',
        task_status: 'active',
        limit: 25,
        offset: 50,
        sort_by: 'online',
        sort_dir: 'desc',
      },
    });
  });

  it('loads branch options for scan center filter', async () => {
    const { scanAPI } = await import('./client');

    await scanAPI.getBranches();

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/branches');
  });

  it('loads scan pattern options for task launch dialog', async () => {
    const { scanAPI } = await import('./client');

    await scanAPI.getPatterns();

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/patterns');
  });

  it('requests paginated host and task data without client-side fallbacks', async () => {
    const { scanAPI } = await import('./client');

    await scanAPI.getHostsTable({
      q: 'host-02',
      branch: 'РњРѕСЃРєРІР°',
      status: 'new',
      severity: 'high',
      limit: 100,
      offset: 0,
      sort_by: 'incidents_new',
      sort_dir: 'desc',
    });
    await scanAPI.getTasks({
      agent_id: 'agent-1',
      status: 'active',
      command: 'scan_now',
      limit: 20,
      offset: 0,
    });

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/scan/hosts/table', {
      params: {
        q: 'host-02',
        branch: 'РњРѕСЃРєРІР°',
        status: 'new',
        severity: 'high',
        limit: 100,
        offset: 0,
        sort_by: 'incidents_new',
        sort_dir: 'desc',
      },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/scan/tasks', {
      params: {
        agent_id: 'agent-1',
        status: 'active',
        command: 'scan_now',
        limit: 20,
        offset: 0,
      },
    });
  });

  it('requests batched agent activity updates with repeated agent_id query params', async () => {
    const { scanAPI } = await import('./client');

    await scanAPI.getAgentsActivity(['agent-1', 'agent-2']);

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/agents/activity?agent_id=agent-1&agent_id=agent-2');
  });

  it('requests scan task incident Excel export as a blob', async () => {
    const { scanAPI } = await import('./client');

    await scanAPI.exportScanTaskIncidents('task-1');

    expect(apiClientMock.get).toHaveBeenCalledWith('/scan/tasks/task-1/incidents/export', {
      responseType: 'blob',
    });
  });
});
