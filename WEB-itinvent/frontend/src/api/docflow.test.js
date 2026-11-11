import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiClientMock } = vi.hoisted(() => ({
  apiClientMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('./client', () => ({
  default: apiClientMock,
}));

import { DOCFLOW_1C_QUERY_TIMEOUT_MS, docflowAPI } from './docflow';

describe('docflow API timeouts', () => {
  beforeEach(() => {
    Object.values(apiClientMock).forEach((mock) => mock.mockReset());
    apiClientMock.get.mockResolvedValue({ data: {} });
    apiClientMock.post.mockResolvedValue({ data: {} });
    apiClientMock.put.mockResolvedValue({ data: {} });
  });

  it('allows slow first-time 1C authentication and credential save', async () => {
    const credentials = { login: 'test.user', password: 'test-password' };

    await docflowAPI.testCredentials(credentials);
    await docflowAPI.saveCredentials(credentials);

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/docflow/profile/test',
      credentials,
      { timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS },
    );
    expect(apiClientMock.put).toHaveBeenCalledWith(
      '/docflow/profile/credentials',
      credentials,
      { timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS },
    );
  });

  it('allows slow task and metadata reads without changing the fast profile request', async () => {
    await docflowAPI.getProfile();
    await docflowAPI.listTasks({ scope: 'completed', q: '', limit: 50 });
    await docflowAPI.getMetadata();

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/docflow/profile', {
      headers: { 'Cache-Control': 'no-store' },
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/docflow/tasks', {
      params: { scope: 'completed', q: '', limit: 50 },
      headers: { 'Cache-Control': 'no-store' },
      timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(3, '/docflow/metadata', {
      headers: { 'Cache-Control': 'no-store' },
      timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
    });
  });

  it('uses encoded task and file references for detail, download, and preview reads', async () => {
    await docflowAPI.getTask('task ref');
    await docflowAPI.downloadFile('task ref', 'file/ref', { disposition: 'inline' });
    await docflowAPI.getFilePreview('task ref', 'file/ref');
    await docflowAPI.downloadFilePreviewPdf('task ref', 'file/ref');

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/docflow/tasks/task%20ref', {
      headers: { 'Cache-Control': 'no-store' },
      params: { include_related: 1 },
      timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
    });
    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      2,
      '/docflow/tasks/task%20ref/files/file%2Fref/content',
      {
        params: { disposition: 'inline' },
        responseType: 'blob',
        timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
      },
    );
    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      3,
      '/docflow/tasks/task%20ref/files/file%2Fref/preview',
      { signal: undefined, timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS },
    );
    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      4,
      '/docflow/tasks/task%20ref/files/file%2Fref/preview/pdf',
      { responseType: 'blob', timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS },
    );
  });

  it('sends task actions with an idempotency key and checks command status', async () => {
    apiClientMock.post.mockResolvedValueOnce({ data: { status: 'applied' } });
    apiClientMock.get.mockResolvedValueOnce({ data: { status: 'state_unknown' } });

    await docflowAPI.applyTaskAction(
      'task ref',
      { action: 'approve', comment: '', state_token: 'state-token' },
      'request-key-1',
    );
    await docflowAPI.getCommand('command ref');

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/docflow/tasks/task%20ref/actions',
      { action: 'approve', comment: '', state_token: 'state-token' },
      expect.objectContaining({
        headers: { 'Idempotency-Key': 'request-key-1' },
        timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
      }),
    );
    expect(apiClientMock.get).toHaveBeenCalledWith(
      '/docflow/commands/command%20ref',
      expect.objectContaining({ timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS }),
    );
  });

  it('searches assignment choices and creates once with an idempotency key', async () => {
    await docflowAPI.getAssignmentCapability();
    await docflowAPI.searchAssignmentDocuments({ q: 'договор', limit: 10 });
    await docflowAPI.searchAssignmentAssignees({ q: 'иванов', limit: 10 });
    await docflowAPI.createAssignment({ title: 'HUB-IT TEST' }, 'assignment-key-1');
    await docflowAPI.getAssignmentCommand('command ref');

    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      1,
      '/docflow/assignments/capability',
      { headers: { 'Cache-Control': 'no-store' } },
    );
    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      2,
      '/docflow/assignments/documents',
      expect.objectContaining({ params: { q: 'договор', limit: 10 } }),
    );
    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      3,
      '/docflow/assignments/assignees',
      expect.objectContaining({ params: { q: 'иванов', limit: 10 } }),
    );
    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/docflow/assignments',
      { title: 'HUB-IT TEST' },
      {
        headers: { 'Idempotency-Key': 'assignment-key-1' },
        timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
      },
    );
    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      4,
      '/docflow/assignments/commands/command%20ref',
      expect.objectContaining({ timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS }),
    );
  });
});
