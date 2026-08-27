import { Suspense } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MailComposeHost from './MailComposeHost';

const {
  mockDeleteDraft,
  mockSaveDraftMultipart,
  mockSearchContacts,
  mockSendMessage,
  mockSendMessageMultipart,
} = vi.hoisted(() => ({
  mockDeleteDraft: vi.fn(),
  mockSaveDraftMultipart: vi.fn(),
  mockSearchContacts: vi.fn(),
  mockSendMessage: vi.fn(),
  mockSendMessageMultipart: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  mailAPI: {
    searchContacts: mockSearchContacts,
    saveDraftMultipart: mockSaveDraftMultipart,
    deleteDraft: mockDeleteDraft,
    sendMessage: mockSendMessage,
    sendMessageMultipart: mockSendMessageMultipart,
  },
}));

vi.mock('./MailComposeDialog', () => ({
  default: ({
    open,
    layoutMode,
    composeFromMailboxId,
    composeToValues,
    composeSubject,
    composeBody,
    composeWarnings,
    composeFieldErrors,
    composeError,
    composeSending,
    composeUploadProgress,
    draftSyncState,
    onCancelComposeUpload,
    onClose,
    onComposeBodyChange,
    onOpenDesktopWindow,
    onPasteInlineImages,
    onSendCompose,
  }) => (open ? (
    <div
      data-testid="mail-compose-host-dialog"
      data-layout-mode={layoutMode}
      data-mailbox-id={composeFromMailboxId}
      data-to-values={(Array.isArray(composeToValues) ? composeToValues : []).join(',')}
      data-subject={composeSubject || ''}
      data-body={composeBody || ''}
      data-warnings={(Array.isArray(composeWarnings) ? composeWarnings : []).map((item) => item.id).join(',')}
      data-field-errors={Object.keys(composeFieldErrors || {}).join(',')}
      data-compose-error={composeError || ''}
      data-sending={composeSending ? 'true' : 'false'}
      data-upload-progress={String(composeUploadProgress || 0)}
      data-draft-sync-state={draftSyncState || ''}
    >
      <button type="button" data-testid="mail-compose-host-send" onClick={() => onSendCompose?.()}>
        send
      </button>
      <button
        type="button"
        data-testid="mail-compose-host-send-with-recipient-override"
        onClick={() => onSendCompose?.({ composeToValues: ['typed-external@example.net'] })}
      >
        send override
      </button>
      <button type="button" data-testid="mail-compose-host-close" onClick={() => onClose?.()}>
        close
      </button>
      <button type="button" data-testid="mail-compose-host-cancel-upload" onClick={() => onCancelComposeUpload?.()}>
        cancel-upload
      </button>
      <button type="button" data-testid="mail-compose-host-change-body" onClick={() => onComposeBodyChange?.('<p>Latest body</p>')}>
        change-body
      </button>
      <button
        type="button"
        data-testid="mail-compose-host-paste-inline"
        onClick={() => {
          const [descriptor] = onPasteInlineImages?.([
            new File(['image'], 'pasted.png', { type: 'image/png' }),
          ]) || [];
          if (descriptor) onComposeBodyChange?.(`<p>Image</p><img src="cid:${descriptor.contentId}">`);
        }}
      >
        paste-inline
      </button>
      <button type="button" data-testid="mail-compose-host-open-desktop" onClick={() => onOpenDesktopWindow?.()}>
        open-desktop
      </button>
    </div>
  ) : null),
}));

const renderHost = (props = {}) => render(
  <Suspense fallback={<div data-testid="compose-loading" />}>
    <MailComposeHost
      session={{
        id: 1,
        initialState: {
          composeToValues: ['person@example.com'],
          composeSubject: 'Hello',
          composeBody: '<p>Body</p>',
        },
      }}
      layoutMode="desktop-inline"
      activeMailboxId="mb-2"
      composeFromOptions={[{ id: 'mb-2', label: 'Support' }]}
      composeDraftKey="mail-compose-host-test"
      resolveComposeMailboxId={(value) => String(value || 'mb-2').trim()}
      mailboxPrimaryDomain="example.com"
      mailboxSignatureHtml="<p>Signature</p>"
      signatureOpen={false}
      signatureHtml=""
      signatureMailboxId=""
      formatFullDate={(value) => String(value || '')}
      formatFileSize={(value) => String(value || 0)}
      sumFilesSize={() => 0}
      sumAttachmentSize={() => 0}
      onOpenSignatureEditor={vi.fn()}
      onCloseSession={vi.fn()}
      onRegisterCloseHandler={vi.fn()}
      onSendSuccess={vi.fn()}
      handleMailCredentialsRequired={vi.fn().mockResolvedValue(false)}
      getMailErrorDetail={(error, fallback) => fallback}
      {...props}
    />
  </Suspense>,
);

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('MailComposeHost', () => {
  it('coalesces autosave changes while one draft save is still running', async () => {
    vi.useFakeTimers();
    let resolveFirstSave;
    const firstSave = new Promise((resolve) => {
      resolveFirstSave = resolve;
    });
    mockSaveDraftMultipart
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue({ draft_id: 'draft-1', attachments: [] });

    try {
      renderHost();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(mockSaveDraftMultipart).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId('mail-compose-host-change-body'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(mockSaveDraftMultipart).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveFirstSave({ draft_id: 'draft-1', attachments: [] });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockSaveDraftMultipart).toHaveBeenCalledTimes(2);
      expect(mockSaveDraftMultipart).toHaveBeenLastCalledWith(expect.objectContaining({
        body: '<p>Latest body</p>',
      }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(mockSaveDraftMultipart).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('feeds initial compose state and mailbox defaults into the lazy compose dialog', async () => {
    renderHost();

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    const dialog = screen.getByTestId('mail-compose-host-dialog');
    expect(dialog).toHaveAttribute('data-layout-mode', 'desktop-inline');
    await waitFor(() => {
      expect(dialog).toHaveAttribute('data-mailbox-id', 'mb-2');
    });
    expect(dialog).toHaveAttribute('data-to-values', 'person@example.com');
    expect(dialog).toHaveAttribute('data-subject', 'Hello');
    expect(dialog).toHaveAttribute('data-body', '<p>Body</p>');
    expect(dialog.getAttribute('data-warnings')).not.toContain('external_recipients');
  });

  it('shows recipient validation errors instead of sending invalid addresses', async () => {
    renderHost({
      session: {
        id: 2,
        initialState: {
          composeToValues: ['not-an-address'],
          composeSubject: 'Hello',
          composeBody: '<p>Body</p>',
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-compose-host-send'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toHaveAttribute('data-field-errors', 'to');
    });
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSendMessageMultipart).not.toHaveBeenCalled();
  });

  it('sends with recipient values flushed by the compose dialog before submit', async () => {
    renderHost({
      session: {
        id: 6,
        initialState: {
          composeToValues: [],
          composeSubject: 'Hello',
          composeBody: '<p>Body</p>',
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-compose-host-send-with-recipient-override'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        to: ['typed-external@example.net'],
      }));
    });
  });

  it('emits external recipient warnings through the compose warning callback', async () => {
    const onComposeWarning = vi.fn();
    renderHost({
      onComposeWarning,
      session: {
        id: 7,
        initialState: {
          composeToValues: ['person@external.test'],
          composeSubject: 'Hello',
          composeBody: '<p>Body</p>',
        },
      },
    });

    await waitFor(() => {
      expect(onComposeWarning).toHaveBeenCalledWith(expect.objectContaining({
        id: 'external_recipients',
        severity: 'info',
        title: 'Внешний адресат',
        message: 'В письме есть внешние получатели.',
        source: 'mail-compose',
      }));
    });
  });

  it('notifies about an empty subject on send without blocking the message', async () => {
    const onComposeWarning = vi.fn();
    renderHost({
      onComposeWarning,
      session: {
        id: 8,
        initialState: {
          composeToValues: ['person@example.com'],
          composeSubject: '',
          composeBody: '<p>Body</p>',
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });
    expect(onComposeWarning).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('mail-compose-host-send'));

    await waitFor(() => {
      expect(onComposeWarning).toHaveBeenCalledWith(expect.objectContaining({
        id: 'empty_subject_send',
        severity: 'warning',
        title: 'Письмо без темы',
        message: 'Тема письма пустая. Письмо будет отправлено без темы.',
      }));
    });
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        subject: '',
      }));
    });
  });

  it('keeps a local draft when server draft save fails on close', async () => {
    const onCloseSession = vi.fn();
    mockSaveDraftMultipart.mockRejectedValueOnce(new Error('offline'));

    renderHost({ onCloseSession });

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-compose-host-close'));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(mockSaveDraftMultipart).toHaveBeenCalledWith(expect.objectContaining({
        fromMailboxId: 'mb-2',
        to: ['person@example.com'],
        subject: 'Hello',
        body: '<p>Body</p>',
      }));
    });
    await waitFor(() => {
      expect(onCloseSession).toHaveBeenCalled();
    });

    const storedDraft = JSON.parse(window.localStorage.getItem('mail-compose-host-test'));
    expect(storedDraft).toMatchObject({
      from_mailbox_id: 'mb-2',
      to: ['person@example.com'],
      subject: 'Hello',
      body: '<p>Body</p>',
      editor_body: '<p>Body</p>',
    });
    expect(storedDraft.saved_at).toBeTruthy();
  });

  it('discards an existing draft when the user declines saving on close', async () => {
    const onCloseSession = vi.fn();

    renderHost({
      onCloseSession,
      session: {
        id: 5,
        initialState: {
          composeToValues: ['person@example.com'],
          composeSubject: 'Draft',
          composeBody: '<p>Body</p>',
          composeDraftId: 'draft-1',
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-compose-host-close'));
    fireEvent.click(await screen.findByRole('button', { name: 'Не сохранять' }));

    await waitFor(() => {
      expect(mockDeleteDraft).toHaveBeenCalledWith('draft-1', { mailboxId: 'mb-2' });
    });
    expect(mockSaveDraftMultipart).not.toHaveBeenCalled();
    expect(onCloseSession).toHaveBeenCalled();
  });

  it('routes credential-required send errors without showing the generic compose error', async () => {
    const requestError = new Error('auth failed');
    const handleMailCredentialsRequired = vi.fn().mockResolvedValue(true);
    const getMailErrorDetail = vi.fn(() => 'Generic send error');
    const onSendSuccess = vi.fn();
    mockSendMessage.mockRejectedValueOnce(requestError);

    renderHost({ getMailErrorDetail, handleMailCredentialsRequired, onSendSuccess });

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-compose-host-send'));

    await waitFor(() => {
      expect(handleMailCredentialsRequired).toHaveBeenCalledWith(
        requestError,
        'Не удалось отправить письмо.',
      );
    });
    expect(getMailErrorDetail).not.toHaveBeenCalled();
    expect(onSendSuccess).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toHaveAttribute('data-compose-error', '');
      expect(screen.getByTestId('mail-compose-host-dialog')).toHaveAttribute('data-sending', 'false');
    });
  });

  it('retains existing draft attachments when sending a draft', async () => {
    renderHost({
      session: {
        id: 4,
        initialState: {
          composeToValues: ['person@example.com'],
          composeSubject: 'Draft',
          composeBody: '<p>Body</p>',
          composeDraftId: 'draft-1',
          composeDraftAttachments: [
            { id: 'att-1', download_token: 'token-1', name: 'report.pdf' },
            { id: 'att-2', name: 'notes.txt' },
          ],
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-compose-host-send'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        draft_id: 'draft-1',
        retain_existing_attachments: ['token-1', 'att-2'],
      }));
    });
  });

  it('autosaves a pasted inline image as a CID attachment', async () => {
    vi.useFakeTimers();
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrl = vi.fn(() => 'blob:pasted-image');
    URL.createObjectURL = createObjectUrl;
    URL.revokeObjectURL = vi.fn();
    mockSaveDraftMultipart.mockResolvedValue({ draft_id: 'draft-inline', attachments: [] });
    try {
      renderHost();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      fireEvent.click(screen.getByTestId('mail-compose-host-paste-inline'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(mockSaveDraftMultipart).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.stringContaining('src="cid:hubit-inline-'),
        inlineFiles: [expect.objectContaining({ name: 'pasted.png', type: 'image/png' })],
        inlineContentIds: [expect.stringMatching(/^hubit-inline-.+@hubit\.local$/)],
      }));
      expect(createObjectUrl).toHaveBeenCalledTimes(1);
    } finally {
      if (originalCreateObjectUrl) URL.createObjectURL = originalCreateObjectUrl;
      else delete URL.createObjectURL;
      if (originalRevokeObjectUrl) URL.revokeObjectURL = originalRevokeObjectUrl;
      else delete URL.revokeObjectURL;
      vi.useRealTimers();
    }
  });

  it('does not let an inline image satisfy the missing file warning', async () => {
    const onComposeWarning = vi.fn();
    renderHost({
      onComposeWarning,
      session: {
        id: 11,
        initialState: {
          composeToValues: ['person@example.com'],
          composeSubject: 'Attachment',
          composeBody: '<p>Прикрепил файл</p><img src="cid:inline-1@hubit.local">',
          composeInlineFiles: [{
            file: new File(['image'], 'pasted.png', { type: 'image/png' }),
            contentId: 'inline-1@hubit.local',
            previewUrl: 'blob:inline-1',
          }],
        },
      },
    });

    await waitFor(() => {
      expect(onComposeWarning).toHaveBeenCalledWith(expect.objectContaining({
        id: 'missing_attachment',
      }));
    });
  });

  it('saves every file before opening the native compose window', async () => {
    const onOpenDesktopWindow = vi.fn().mockResolvedValue(undefined);
    mockSaveDraftMultipart.mockResolvedValue({ draft_id: 'draft-transfer', attachments: [] });
    renderHost({
      onOpenDesktopWindow,
      session: {
        id: 12,
        initialState: {
          composeToValues: ['person@example.com'],
          composeSubject: 'Transfer',
          composeBody: '<p>Body</p>',
          composeFiles: [new File(['report'], 'report.txt', { type: 'text/plain' })],
        },
      },
    });

    await waitFor(() => expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mail-compose-host-open-desktop'));

    await waitFor(() => {
      expect(mockSaveDraftMultipart).toHaveBeenCalledWith(expect.objectContaining({
        files: [expect.objectContaining({ name: 'report.txt' })],
      }));
      expect(onOpenDesktopWindow).toHaveBeenCalledWith({
        draftId: 'draft-transfer',
        mailboxId: 'mb-2',
      });
    });
    expect(mockSaveDraftMultipart.mock.invocationCallOrder[0])
      .toBeLessThan(onOpenDesktopWindow.mock.invocationCallOrder[0]);
  });

  it('creates an empty draft before opening the native compose window', async () => {
    const onOpenDesktopWindow = vi.fn().mockResolvedValue(undefined);
    mockSaveDraftMultipart.mockResolvedValue({ draft_id: 'draft-empty', attachments: [] });
    renderHost({
      onOpenDesktopWindow,
      session: {
        id: 13,
        initialState: {
          composeToValues: [],
          composeSubject: '',
          composeBody: '',
        },
      },
    });

    await waitFor(() => expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mail-compose-host-open-desktop'));

    await waitFor(() => {
      expect(mockSaveDraftMultipart).toHaveBeenCalledTimes(1);
      expect(onOpenDesktopWindow).toHaveBeenCalledWith({
        draftId: 'draft-empty',
        mailboxId: 'mb-2',
      });
    });
  });

  it('aborts an in-flight multipart send when the compose host unmounts', async () => {
    let uploadSignal;
    mockSendMessageMultipart.mockImplementationOnce(({ signal }) => {
      uploadSignal = signal;
      return new Promise(() => {});
    });

    const { unmount } = renderHost({
      session: {
        id: 3,
        initialState: {
          composeToValues: ['person@example.com'],
          composeSubject: 'With file',
          composeBody: '<p>Body</p>',
          composeFiles: [new File(['report'], 'report.txt', { type: 'text/plain' })],
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-compose-host-send'));

    await waitFor(() => {
      expect(mockSendMessageMultipart).toHaveBeenCalled();
      expect(uploadSignal?.aborted).toBe(false);
    });

    unmount();

    expect(uploadSignal.aborted).toBe(true);
  });

  it('ignores a second send click while the first send is in flight', async () => {
    let resolveSend;
    mockSendMessage.mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));

    renderHost();

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-compose-host-send'));
    fireEvent.click(screen.getByTestId('mail-compose-host-send'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    resolveSend({});
    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toHaveAttribute('data-sending', 'false');
    });
  });

  it('reuses the same send idempotency key after a failed attempt', async () => {
    mockSendMessage
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce({});

    renderHost();

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-compose-host-send'));
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('mail-compose-host-dialog')).toHaveAttribute('data-sending', 'false');
    });

    fireEvent.click(screen.getByTestId('mail-compose-host-send'));
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
    });

    const firstKey = mockSendMessage.mock.calls[0][0].idempotencyKey;
    const secondKey = mockSendMessage.mock.calls[1][0].idempotencyKey;
    expect(firstKey).toEqual(expect.any(String));
    expect(firstKey.length).toBeGreaterThanOrEqual(8);
    expect(secondKey).toBe(firstKey);
  });

  it('shows maybe-sent copy on send timeout and does not auto-retry', async () => {
    const requestError = Object.assign(new Error('timeout of 115000ms exceeded'), {
      code: 'ECONNABORTED',
    });
    mockSendMessage.mockRejectedValueOnce(requestError);

    renderHost();

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-compose-host-send'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog').getAttribute('data-compose-error') || '')
        .toContain('могло быть отправлено');
    });
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('runs afterClose after an empty compose is closed without a prompt', async () => {
    const onCloseSession = vi.fn();
    const afterClose = vi.fn();
    let closeHandler;
    renderHost({
      onCloseSession,
      onRegisterCloseHandler: (handler) => { closeHandler = handler; },
      session: {
        id: 9,
        initialState: {
          composeToValues: [],
          composeSubject: '',
          composeBody: '',
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    await act(async () => {
      await closeHandler({ afterClose });
    });

    expect(onCloseSession).toHaveBeenCalledTimes(1);
    expect(afterClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
  });

  it('autosaves a typed compose and runs afterClose when switching away', async () => {
    const onCloseSession = vi.fn();
    const onDraftSaved = vi.fn().mockResolvedValue(undefined);
    const afterClose = vi.fn();
    let closeHandler;
    mockSaveDraftMultipart.mockResolvedValue({ draft_id: 'draft-1', attachments: [] });
    renderHost({
      onCloseSession,
      onDraftSaved,
      onRegisterCloseHandler: (handler) => { closeHandler = handler; },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    await act(async () => {
      await closeHandler({ afterClose });
    });

    await waitFor(() => {
      expect(mockSaveDraftMultipart).toHaveBeenCalled();
      expect(onDraftSaved).toHaveBeenCalledTimes(1);
      expect(onCloseSession).toHaveBeenCalledTimes(1);
      expect(afterClose).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
  });

  it('does not run afterClose when the user continues editing after the close button', async () => {
    const onCloseSession = vi.fn();
    const afterClose = vi.fn();
    let closeHandler;
    renderHost({
      onCloseSession,
      onRegisterCloseHandler: (handler) => { closeHandler = handler; },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    await act(async () => {
      await closeHandler();
    });

    expect(onCloseSession).not.toHaveBeenCalled();
    expect(afterClose).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Продолжить редактирование' }));
    expect(onCloseSession).not.toHaveBeenCalled();
    expect(afterClose).not.toHaveBeenCalled();
    expect(mockSaveDraftMultipart).not.toHaveBeenCalled();
  });

  it('keeps compose open when autosave fails while switching away', async () => {
    const onCloseSession = vi.fn();
    const afterClose = vi.fn();
    const onComposeWarning = vi.fn();
    let closeHandler;
    mockSaveDraftMultipart.mockRejectedValueOnce(new Error('offline'));
    renderHost({
      onCloseSession,
      onComposeWarning,
      onRegisterCloseHandler: (handler) => { closeHandler = handler; },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    await act(async () => {
      await closeHandler({ afterClose });
    });

    await waitFor(() => {
      expect(onComposeWarning).toHaveBeenCalledWith(expect.objectContaining({
        id: 'draft_save_failed',
      }));
    });
    expect(onCloseSession).not.toHaveBeenCalled();
    expect(afterClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
  });

  it('runs onCloseSession after the user confirms saving from the close prompt', async () => {
    const onCloseSession = vi.fn();
    const onDraftSaved = vi.fn().mockResolvedValue(undefined);
    let closeHandler;
    mockSaveDraftMultipart.mockResolvedValue({ draft_id: 'draft-1', attachments: [] });
    renderHost({
      onCloseSession,
      onDraftSaved,
      onRegisterCloseHandler: (handler) => { closeHandler = handler; },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-host-dialog')).toBeTruthy();
    });

    await act(async () => {
      await closeHandler();
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(mockSaveDraftMultipart).toHaveBeenCalled();
      expect(onDraftSaved).toHaveBeenCalledTimes(1);
      expect(onCloseSession).toHaveBeenCalledTimes(1);
    });
  });
});
