import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentAPI } from '../../api/client';
import { useDatabaseUploadActWorkflow } from './useDatabaseUploadActWorkflow';

vi.mock('../../api/client', () => ({
  equipmentAPI: {
    getTransferReminder: vi.fn(),
    parseUploadedAct: vi.fn(),
    commitUploadedActDraft: vi.fn(),
    sendUploadedActEmail: vi.fn(),
  },
}));

const createPdfFile = (name = 'act.pdf') => new File(['%PDF-1.4'], name, { type: 'application/pdf' });

const createProps = (overrides = {}) => ({
  canDatabaseWrite: true,
  dbName: 'main',
  location: { pathname: '/database', search: '' },
  navigate: vi.fn(),
  searchOwnersCached: vi.fn(async () => ({ owners: [] })),
  notifyDatabaseSuccess: vi.fn(),
  notifyDatabaseInfo: vi.fn(),
  notifyDatabaseWarning: vi.fn(),
  getEmailStatusItemSx: vi.fn((overridesArg) => ({ ...overridesArg })),
  ...overrides,
});

const renderUploadActHook = (overrides = {}) => {
  const props = createProps(overrides);
  return {
    props,
    ...renderHook((hookProps) => useDatabaseUploadActWorkflow(hookProps), {
      initialProps: props,
    }),
  };
};

describe('useDatabaseUploadActWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    equipmentAPI.getTransferReminder.mockResolvedValue(null);
    equipmentAPI.parseUploadedAct.mockResolvedValue({
      draft_id: 'draft-1',
      document_title: 'Act',
      from_employee: 'Ivanov',
      to_employee: 'Petrov',
      equipment_inv_nos: ['1001'],
    });
    equipmentAPI.commitUploadedActDraft.mockResolvedValue({ doc_no: 12, file_no: 34 });
    equipmentAPI.sendUploadedActEmail.mockResolvedValue({
      success_count: 1,
      failed_count: 0,
      recipients: [{ owner_no: 7, email: 'ivanov@example.test', status: 'sent' }],
    });

    URL.createObjectURL = vi.fn((file) => `blob:${file.name}`);
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens, resets, closes, and clears upload-act reminder deep links', async () => {
    equipmentAPI.getTransferReminder.mockResolvedValueOnce({
      reminder_id: 'rem-1',
      task_id: 'task-1',
      pending_groups_total: 2,
      completed_groups_total: 1,
      pending_groups: [{ key: 'pending' }],
      completed_groups: [{ key: 'done' }],
    });
    const { result, props } = renderUploadActHook({
      location: {
        pathname: '/database',
        search: '?upload_act=1&reminder_id=rem-1&source_task_id=task-1&db_id=main&keep=1',
      },
    });

    await waitFor(() => expect(result.current.uploadActModalOpen).toBe(true));
    await waitFor(() => expect(equipmentAPI.getTransferReminder).toHaveBeenCalledWith('rem-1'));
    expect(result.current.uploadActReminderBinding).toEqual({
      reminder_id: 'rem-1',
      task_id: 'task-1',
      pending_groups_total: 2,
      completed_groups_total: 1,
      pending_groups: [{ key: 'pending' }],
      completed_groups: [{ key: 'done' }],
    });

    act(() => {
      result.current.setUploadActError('stale error');
      result.current.setUploadActEmailRecipients([{ OWNER_NO: 1 }]);
    });
    act(() => {
      result.current.closeUploadActModal();
    });

    expect(result.current.uploadActModalOpen).toBe(false);
    expect(result.current.uploadActError).toBe('');
    expect(result.current.uploadActEmailRecipients).toEqual([]);
    expect(props.navigate).toHaveBeenCalledWith(
      { pathname: '/database', search: '?keep=1' },
      { replace: true }
    );

    const blocked = renderHook(() => useDatabaseUploadActWorkflow(createProps({ canDatabaseWrite: false })));
    act(() => {
      blocked.result.current.openUploadActModal();
    });
    expect(blocked.result.current.uploadActModalOpen).toBe(false);
  });

  it('creates and revokes PDF preview object URLs when selected files change', async () => {
    const { result, unmount } = renderUploadActHook();
    const firstFile = createPdfFile('first.pdf');
    const secondFile = createPdfFile('second.pdf');

    act(() => {
      result.current.handleUploadActFileSelect({ target: { files: [firstFile] } });
    });
    await waitFor(() => expect(result.current.uploadActPreviewUrl).toBe('blob:first.pdf'));

    act(() => {
      result.current.handleUploadActFileSelect({ target: { files: [secondFile] } });
    });
    await waitFor(() => expect(result.current.uploadActPreviewUrl).toBe('blob:second.pdf'));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first.pdf');

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second.pdf');
  });

  it('falls back to manual parse mode when automatic PDF parsing is unavailable', async () => {
    const { result, props } = renderUploadActHook();
    const file = createPdfFile();
    const fallbackDraft = {
      draft_id: 'manual-draft',
      document_title: '',
      from_employee: '',
      to_employee: '',
      equipment_inv_nos: [],
    };
    equipmentAPI.parseUploadedAct
      .mockRejectedValueOnce({
        response: { status: 503, data: { detail: 'openrouter timeout' } },
      })
      .mockResolvedValueOnce(fallbackDraft);

    act(() => {
      result.current.handleUploadActFileSelect({ target: { files: [file] } });
    });
    await act(async () => {
      await result.current.handleUploadActParse(false);
    });

    expect(equipmentAPI.parseUploadedAct).toHaveBeenNthCalledWith(1, file, { manualMode: false });
    expect(equipmentAPI.parseUploadedAct).toHaveBeenNthCalledWith(2, file, { manualMode: true });
    expect(result.current.uploadActDraft).toEqual(fallbackDraft);
    expect(result.current.uploadActParsing).toBe(false);
    expect(result.current.uploadActError).toBe('');
    expect(props.notifyDatabaseWarning).toHaveBeenCalledWith(expect.stringContaining('OpenRouter'));
  });

  it('commits a draft and auto-sends email to parsed participants', async () => {
    const { result, props } = renderUploadActHook();
    const draft = {
      draft_id: 'draft-1',
      document_title: 'Transfer act',
      from_employee: 'Ivanov Ivan',
      to_employee: 'Petrov Petr',
      doc_date: '2026-05-03',
      equipment_inv_nos: ['1001', '1002'],
    };

    act(() => {
      result.current.applyUploadActDraft(draft);
      result.current.setUploadActInvVerified(true);
    });
    await act(async () => {
      await result.current.handleUploadActCommit();
    });

    expect(equipmentAPI.commitUploadedActDraft).toHaveBeenCalledWith(expect.objectContaining({
      draft_id: 'draft-1',
      from_employee: 'Ivanov Ivan',
      to_employee: 'Petrov Petr',
      equipment_inv_nos: ['1001', '1002'],
    }));
    expect(equipmentAPI.sendUploadedActEmail).toHaveBeenCalledWith(expect.objectContaining({
      doc_no: 12,
      mode: 'auto',
      from_employee: 'Ivanov Ivan',
      to_employee: 'Petrov Petr',
    }));
    expect(result.current.uploadActCommitResult).toEqual({ doc_no: 12, file_no: 34 });
    expect(result.current.uploadActEmailSummary).toEqual({
      mode: 'auto',
      successCount: 1,
      failedCount: 0,
    });
    expect(props.notifyDatabaseSuccess).toHaveBeenCalledWith('Акт загружен. DOC_NO: 12, FILE_NO: 34.');
  });

  it('validates selected email recipients and sends selected-recipient payloads', async () => {
    const { result } = renderUploadActHook();

    act(() => {
      result.current.setUploadActCommitResult({ doc_no: 12, file_no: 34 });
      result.current.setUploadActEmailSubject('Subject');
      result.current.setUploadActEmailBody('Body');
    });

    await act(async () => {
      await result.current.handleUploadActEmailSend();
    });
    expect(result.current.uploadActEmailError).toBeTruthy();
    expect(equipmentAPI.sendUploadedActEmail).not.toHaveBeenCalled();

    equipmentAPI.sendUploadedActEmail.mockResolvedValueOnce({
      success_count: 2,
      failed_count: 0,
      recipients: [
        { owner_no: 1, email: 'one@example.test', status: 'sent' },
        { owner_no: 2, email: 'two@example.test', status: 'sent' },
      ],
    });

    act(() => {
      result.current.setUploadActEmailRecipients([
        { OWNER_NO: 1, OWNER_DISPLAY_NAME: 'One' },
        { owner_no: 2, OWNER_DISPLAY_NAME: 'Two' },
      ]);
    });
    await act(async () => {
      await result.current.handleUploadActEmailSend();
    });

    expect(equipmentAPI.sendUploadedActEmail).toHaveBeenCalledWith({
      doc_no: 12,
      mode: 'selected',
      owner_nos: [1, 2],
      subject: 'Subject',
      body: 'Body',
    });
    expect(result.current.uploadActEmailError).toBe('');
    expect(result.current.uploadActEmailSummary).toEqual({
      mode: 'selected',
      successCount: 2,
      failedCount: 0,
    });
    expect(result.current.uploadActEmailLastRecipients).toHaveLength(2);
  });
});
