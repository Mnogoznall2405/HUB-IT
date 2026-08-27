import {
  nativeMailComposeDestination,
  nativeMailDestinationFromPortalPath,
  resolveNativeMailEnabled,
} from './nativeMailFeature';

describe('nativeMailDestinationFromPortalPath', () => {
  it('maps the mailbox, folder and search filters to the native list', () => {
    expect(nativeMailDestinationFromPortalPath('/mail/inbox?mailbox_id=box-1&q=смета&unread_only=1')).toEqual({
      pathname: '/(shell)/mail',
      params: { mailboxId: 'box-1', folder: 'inbox', q: 'смета', unreadOnly: '1' },
    });
  });

  it('preserves backend advanced search filters in an authenticated native deep link', () => {
    expect(nativeMailDestinationFromPortalPath('/mail?date_from=2026-08-01&date_to=2026-08-25&from_filter=ops%40example.com&to_filter=me%40example.com&subject_filter=report&body_filter=approved&importance=high&folder_scope=all')).toEqual({
      pathname: '/(shell)/mail',
      params: {
        dateFrom: '2026-08-01',
        dateTo: '2026-08-25',
        from: 'ops@example.com',
        to: 'me@example.com',
        subject: 'report',
        body: 'approved',
        importance: 'high',
        folderScope: 'all',
      },
    });
  });

  it('maps mailbox-scoped messages and conversations', () => {
    expect(nativeMailDestinationFromPortalPath('/mail?message=message%2F7&mailbox_id=box-1')).toEqual({
      pathname: '/(shell)/mail/[messageId]',
      params: { messageId: 'message/7', mailboxId: 'box-1' },
    });
    expect(nativeMailDestinationFromPortalPath('/mail?conversation=thread%2F9&folder=sent')).toEqual({
      pathname: '/(shell)/mail/conversation/[conversationId]',
      params: { conversationId: 'thread/9', folder: 'sent' },
    });
  });

  it('maps standalone compose, address-book recipients and drafts', () => {
    expect(nativeMailDestinationFromPortalPath('/mail?compose=new')).toEqual({
      pathname: '/(shell)/mail/compose',
      params: { mode: 'new' },
    });
    expect(nativeMailDestinationFromPortalPath('/mail?compose_to=user%40example.com')).toEqual({
      pathname: '/(shell)/mail/compose',
      params: { mode: 'new', to: 'user@example.com' },
    });
    expect(nativeMailDestinationFromPortalPath('/mail/compose?draft_id=draft-1&mailbox_id=box-1')).toEqual({
      pathname: '/(shell)/mail/compose',
      params: { mode: 'draft', mailboxId: 'box-1', draftId: 'draft-1' },
    });
  });

  it('keeps reply intent and source message when a compose route is restored after login', () => {
    expect(nativeMailDestinationFromPortalPath('/mail?compose=reply_all&message=message%2F7&mailbox_id=box-1')).toEqual({
      pathname: '/(shell)/mail/compose',
      params: { mode: 'reply_all', mailboxId: 'box-1', sourceMessageId: 'message/7' },
    });
    expect(nativeMailDestinationFromPortalPath('/mail/compose?compose=forward&message=message-8')).toEqual({
      pathname: '/(shell)/mail/compose',
      params: { mode: 'forward', sourceMessageId: 'message-8' },
    });
  });

  it('rejects legacy binary-share routes and unsupported mail subpaths', () => {
    expect(nativeMailDestinationFromPortalPath('/mail?compose=android-share&android_share_id=share-1')).toBeNull();
    expect(nativeMailDestinationFromPortalPath('/mail?compose=prefill')).toBeNull();
    expect(nativeMailDestinationFromPortalPath('/mail/settings')).toBeNull();
    expect(nativeMailDestinationFromPortalPath('/mail/%E0%A4%A')).toBeNull();
  });
});

it('builds reply-all routes without exposing identifiers in a plain pathname', () => {
  expect(nativeMailComposeDestination({
    mode: 'reply_all',
    mailboxId: 'box-1',
    sourceMessageId: 'message/7',
  })).toEqual({
    pathname: '/(shell)/mail/compose',
    params: { mode: 'reply_all', mailboxId: 'box-1', sourceMessageId: 'message/7' },
  });
});

it('keeps the native Mail rollout default-on with an explicit rollback flag', () => {
  expect(resolveNativeMailEnabled(undefined)).toBe(true);
  expect(resolveNativeMailEnabled('false')).toBe(false);
  expect(resolveNativeMailEnabled('true')).toBe(true);
});
