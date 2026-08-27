import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useMailComposeSessionController from './useMailComposeSessionController';

const createMemoryStorage = (initial = {}) => {
  const memory = { ...initial };
  return {
    memory,
    getItem: (key) => (Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null),
    setItem: (key, value) => {
      memory[key] = String(value);
    },
    removeItem: (key) => {
      delete memory[key];
    },
  };
};

const resolveComposeMailboxId = (candidate = '') => String(candidate || 'mailbox-primary');

describe('useMailComposeSessionController', () => {
  const renderComposeHook = (overrides = {}) => renderHook(
    (props) => useMailComposeSessionController(props),
    {
      initialProps: {
        composeDraftKey: 'mail_compose_draft_v2:mailbox-primary',
        resolveComposeMailboxId,
        storage: createMemoryStorage(),
        navigate: vi.fn(),
        ...overrides,
      },
    },
  );

  it('opens a new compose session for the active mailbox', () => {
    const { result } = renderComposeHook();

    act(() => {
      result.current.openCompose();
    });

    expect(result.current.composeOpen).toBe(true);
    expect(result.current.composeSession.initialState).toMatchObject({
      composeMode: 'new',
      composeFromMailboxId: 'mailbox-primary',
    });
  });

  it('restores a stored draft instead of a blank new message', () => {
    const storage = createMemoryStorage({
      'mail_compose_draft_v2:mailbox-primary': JSON.stringify({
        compose_mode: 'new',
        from_mailbox_id: 'mailbox-primary',
        to: ['draft@example.com'],
        subject: 'Saved draft',
        body: '<p>Hello</p>',
      }),
    });
    const { result } = renderComposeHook({ storage });

    act(() => {
      result.current.openCompose();
    });

    expect(result.current.composeSession.initialState).toMatchObject({
      composeToValues: ['draft@example.com'],
      composeSubject: 'Saved draft',
      composeBody: '<p>Hello</p>',
    });
  });

  it('opens reply and forward from the selected message and clears the stored draft', () => {
    const storage = createMemoryStorage({
      'mail_compose_draft_v2:mailbox-primary': JSON.stringify({ composeSubject: 'stale' }),
    });
    const selectedMessage = {
      id: 'msg-1',
      mailbox_id: 'mailbox-message',
      subject: 'Budget',
      compose_context: {
        reply: {
          mailbox_id: 'mailbox-reply',
          to: ['Boss <boss@example.com>'],
          cc: ['copy@example.com'],
          subject: 'Budget',
          quote_html: '<blockquote>original</blockquote>',
        },
        forward: {
          mailbox_id: 'mailbox-forward',
          subject: 'Budget',
        },
      },
    };
    const { result, rerender } = renderComposeHook({ selectedMessage, storage });

    act(() => {
      result.current.openComposeFromMessage('reply');
    });
    expect(result.current.composeSession.initialState).toMatchObject({
      composeMode: 'reply',
      composeFromMailboxId: 'mailbox-reply',
      composeToValues: ['boss@example.com'],
      composeCcValues: ['copy@example.com'],
      composeSubject: 'Re: Budget',
      composeBody: '<p><br></p>',
      composeQuotedOriginalHtml: '<blockquote>original</blockquote>',
      composeReplyToMessageId: 'msg-1',
      composeForwardMessageId: '',
    });
    expect(storage.memory['mail_compose_draft_v2:mailbox-primary']).toBeUndefined();

    rerender({
      composeDraftKey: 'mail_compose_draft_v2:mailbox-primary',
      resolveComposeMailboxId,
      selectedMessage,
      storage,
      navigate: vi.fn(),
    });

    act(() => {
      result.current.openComposeFromMessage('forward');
    });
    expect(result.current.composeSession.initialState).toMatchObject({
      composeMode: 'forward',
      composeFromMailboxId: 'mailbox-forward',
      composeSubject: 'Fwd: Budget',
      composeReplyToMessageId: '',
      composeForwardMessageId: 'msg-1',
    });
  });

  it('opens a drafts-folder message as a synced compose session and ignores other folders', () => {
    const { result } = renderComposeHook();

    act(() => {
      result.current.openComposeFromDraftMessage({
        id: 'draft-1',
        folder: 'inbox',
        subject: 'Not a draft',
      });
    });
    expect(result.current.composeOpen).toBe(false);

    act(() => {
      result.current.openComposeFromDraftMessage({
        id: 'draft-1',
        folder: 'drafts',
        mailbox_id: 'mailbox-draft',
        to: ['to@example.com'],
        cc: [],
        bcc: [],
        subject: 'Draft subject',
        body_html: '<p>Hello</p><blockquote>quoted</blockquote>',
        attachments: [{ id: 'a1' }],
        draft_context: {
          compose_mode: 'reply',
          mailbox_id: 'mailbox-draft',
          reply_to_message_id: 'msg-origin',
        },
      });
    });

    expect(result.current.composeSession.initialState).toMatchObject({
      composeMode: 'reply',
      composeFromMailboxId: 'mailbox-draft',
      composeToValues: ['to@example.com'],
      composeSubject: 'Draft subject',
      composeDraftId: 'draft-1',
      composeReplyToMessageId: 'msg-origin',
      draftSyncState: 'synced',
      composeDraftAttachments: [{ id: 'a1' }],
    });
    expect(result.current.composeSession.initialState.composeBody).toContain('Hello');
    expect(result.current.composeSession.initialState.composeQuotedOriginalHtml).toContain('blockquote');
  });

  it('opens compose from compose=new and compose_to query params, and ignores invalid recipients', () => {
    const navigate = vi.fn();
    const { rerender, result } = renderComposeHook({
      locationSearch: '?compose=new&mailbox_id=primary',
      navigate,
    });

    expect(result.current.composeOpen).toBe(true);
    expect(result.current.composeSession.initialState.composeMode).toBe('new');
    expect(navigate).toHaveBeenCalledWith('/mail?mailbox_id=primary', { replace: true });

    rerender({
      composeDraftKey: 'mail_compose_draft_v2:mailbox-primary',
      resolveComposeMailboxId,
      storage: createMemoryStorage(),
      locationSearch: '?compose_to=Boss%20%3Cboss@example.com%3E',
      navigate,
    });
    expect(result.current.composeSession.initialState).toMatchObject({
      composeMode: 'new',
      composeToValues: ['boss@example.com'],
    });
    expect(navigate).toHaveBeenCalledWith('/mail', { replace: true });

    rerender({
      composeDraftKey: 'mail_compose_draft_v2:mailbox-primary',
      resolveComposeMailboxId,
      storage: createMemoryStorage(),
      locationSearch: '?compose_to=not-an-address',
      navigate,
    });
    expect(result.current.composeSession.initialState.composeToValues).toEqual(['boss@example.com']);
  });

  it('opens an explicit APK text share as a draft without sending it', () => {
    const navigate = vi.fn();
    const consumeIncomingShare = vi.fn(() => ({
      id: 'share-1',
      target: 'mail',
      subject: 'Отчёт',
      text: 'Ссылка: https://example.com/report',
      receivedAt: Date.now(),
    }));
    const { result } = renderComposeHook({
      locationSearch: '?folder=inbox&compose=android-share&android_share_id=share-1',
      navigate,
      consumeIncomingShare,
    });

    expect(consumeIncomingShare).toHaveBeenCalledWith('mail');
    expect(result.current.composeSession.initialState).toMatchObject({
      composeMode: 'new',
      composeSubject: 'Отчёт',
    });
    expect(result.current.composeSession.initialState.composeBody).toContain('https://example.com/report');
    expect(navigate).toHaveBeenCalledWith('/mail?folder=inbox', { replace: true });
  });

  it('closes the compose session', () => {
    const { result } = renderComposeHook();

    act(() => {
      result.current.openCompose();
    });
    act(() => {
      result.current.closeComposeSession();
    });

    expect(result.current.composeOpen).toBe(false);
    expect(result.current.composeSession).toBeNull();
  });
});
