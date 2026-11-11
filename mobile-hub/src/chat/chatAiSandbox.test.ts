import {
  canAttachSandboxFile,
  isSandboxAiBot,
  normalizeAiSandboxPayload,
  sandboxStatusLabel,
} from './chatAiSandbox';

describe('native OpenCode sandbox helpers', () => {
  it('normalizes workspace status, permissions and files', () => {
    const state = normalizeAiSandboxPayload({
      enabled: true,
      job: { status: 'waiting_permission' },
      pending_permissions: [{
        id: 'perm-1',
        title: 'Запись файла',
        reason: 'src/app.ts',
        arguments: { path: 'src/app.ts' },
      }],
      files: [{
        id: 'file-1',
        path: 'src/app.ts',
        kind: 'output',
        status: 'modified',
        availability: 'attached',
        message_id: 'm1',
        attachment_id: 'a1',
      }],
      diff: [{ path: 'src/app.ts', diff: '+const x = 1;' }],
      archive: { download_url: '/archive.zip', message_id: 'm2', attachment_id: 'a2' },
    });

    expect(isSandboxAiBot({ surface: 'sandbox' })).toBe(true);
    expect(sandboxStatusLabel('waiting_permission')).toBe('Нужно разрешение');
    expect(state.jobLabel).toBe('Нужно разрешение');
    expect(state.pendingPermissions[0]).toEqual(expect.objectContaining({
      id: 'perm-1',
      title: 'Запись файла',
      detail: 'src/app.ts',
    }));
    expect(canAttachSandboxFile(state.files[0])).toBe(true);
    expect(state.diffs[0].patch).toContain('const x');
    expect(state.archive?.messageId).toBe('m2');
  });

  it('treats a missing workspace as disabled without permissions', () => {
    expect(normalizeAiSandboxPayload({ enabled: false })).toEqual(expect.objectContaining({
      enabled: false,
      pendingPermissions: [],
      files: [],
      archive: null,
    }));
  });
});
