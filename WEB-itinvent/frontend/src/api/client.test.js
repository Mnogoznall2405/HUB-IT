import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientMock = {
  get: vi.fn(),
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

describe('mailAPI mailbox listing', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { items: [] } });
  });

  it('passes include_unread only when explicitly requested', async () => {
    const { mailAPI } = await import('./client');

    await mailAPI.listMailboxes({ includeUnread: true });

    expect(apiClientMock.get).toHaveBeenCalledWith('/mail/mailboxes', {
      params: { include_unread: true },
    });
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

describe('authAPI trusted device registration options', () => {
  beforeEach(() => {
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
  });

  it('sends platform_only when desktop Windows Hello registration is requested', async () => {
    const { authAPI } = await import('./client');

    await authAPI.getTrustedDeviceRegistrationOptions('Work PC', { platformOnly: true });

    expect(apiClientMock.post).toHaveBeenCalledWith('/auth/trusted-devices/register/options', {
      label: 'Work PC',
      platform_only: true,
    });
  });
});

describe('authAPI passkey-first login', () => {
  beforeEach(() => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValue({ data: { ok: true } });
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { ok: true } });
  });

  it('loads login mode for the current network before auth UI chooses passkey or password flow', async () => {
    const { authAPI } = await import('./client');

    await authAPI.getLoginMode();

    expect(apiClientMock.get).toHaveBeenCalledWith(
      '/auth/login-mode',
      { suppressAuthRequired: true },
    );
  });

  it('requests passwordless passkey login options without a login challenge', async () => {
    const { authAPI } = await import('./client');

    await authAPI.getPasskeyLoginOptions();

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/auth/passkey-login/options',
      null,
      { suppressAuthRequired: true },
    );
  });

  it('verifies passwordless passkey login with challenge id and credential payload', async () => {
    const { authAPI } = await import('./client');

    await authAPI.verifyPasskeyLogin('challenge-1', { id: 'cred-1' });

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/auth/passkey-login/verify',
      {
        challenge_id: 'challenge-1',
        credential: { id: 'cred-1' },
      },
      { suppressAuthRequired: true },
    );
  });
});

describe('authAPI self reset 2FA', () => {
  beforeEach(() => {
    apiClientMock.post = vi.fn().mockResolvedValue({ data: { success: true } });
  });

  it('calls the self-service 2FA reset endpoint for the current user', async () => {
    const { authAPI } = await import('./client');

    await authAPI.resetOwnTwoFactor();

    expect(apiClientMock.post).toHaveBeenCalledWith('/auth/reset-2fa-self');
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
    apiClientMock.get.mockResolvedValue({
      data: new Blob([]),
      headers: { 'content-type': 'application/pdf' },
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
});
