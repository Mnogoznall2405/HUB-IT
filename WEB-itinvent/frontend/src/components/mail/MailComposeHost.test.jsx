import { Suspense } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});
