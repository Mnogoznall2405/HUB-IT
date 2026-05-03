import { describe, expect, it } from 'vitest';

import {
  composeStateHasContent,
  createComposeInitialState,
  getComposeCombinedBody,
  getComposeDialogTitle,
  normalizeMailRecipient,
  readStoredComposeState,
  toRecipientEmails,
} from './mailComposeState';

const makeStorage = (entries) => ({
  getItem: (key) => entries[key] ?? null,
});

describe('mailComposeState', () => {
  it('normalizes recipients from strings and contact objects', () => {
    expect(normalizeMailRecipient('User Name <user@example.com>')).toBe('user@example.com');
    expect(toRecipientEmails([
      '  first@example.com  ',
      { email: 'second@example.com' },
      { name: 'Third Person <third@example.com>' },
      '',
      null,
    ])).toEqual(['first@example.com', 'second@example.com', 'third@example.com']);
  });

  it('creates compose state with stable defaults and aliases', () => {
    expect(createComposeInitialState({
      composeMode: 'reply',
      to: ['User <user@example.com>'],
      cc: [{ email: 'copy@example.com' }],
      subject: 'Subject',
      body: '<p>Hello</p>',
      draftAttachments: [{ id: 'a1' }],
      draftId: 42,
      dismissedComposeWarnings: [' external ', '', null],
    })).toMatchObject({
      composeMode: 'reply',
      composeToValues: ['user@example.com'],
      composeCcValues: ['copy@example.com'],
      composeSubject: 'Subject',
      composeBody: '<p>Hello</p>',
      composeDraftAttachments: [{ id: 'a1' }],
      composeDraftId: '42',
      draftSyncState: 'idle',
      dismissedComposeWarnings: [' external '],
    });
  });

  it('returns current dialog titles for compose modes', () => {
    expect(getComposeDialogTitle('new')).toBe('Новое письмо');
    expect(getComposeDialogTitle('reply')).toBe('Ответ');
    expect(getComposeDialogTitle('reply_all')).toBe('Ответ всем');
    expect(getComposeDialogTitle('forward')).toBe('Пересылка');
    expect(getComposeDialogTitle('draft')).toBe('Черновик');
  });

  it('detects meaningful compose content', () => {
    expect(composeStateHasContent(createComposeInitialState())).toBe(false);
    expect(composeStateHasContent(createComposeInitialState({ body: '<p><br></p>' }))).toBe(false);
    expect(composeStateHasContent(createComposeInitialState({ to: ['user@example.com'] }))).toBe(true);
    expect(composeStateHasContent(createComposeInitialState({ subject: 'Subject' }))).toBe(true);
    expect(composeStateHasContent(createComposeInitialState({ composeFiles: [{ name: 'a.txt' }] }))).toBe(true);
    expect(composeStateHasContent(createComposeInitialState({ draftAttachments: [{ id: 'a1' }] }))).toBe(true);
  });

  it('combines editor body with quoted history html', () => {
    const result = getComposeCombinedBody(createComposeInitialState({
      body: '<p>Hello</p>',
      quotedOriginalHtml: '<blockquote>Old message</blockquote>',
    }));

    expect(result).toContain('Hello');
    expect(result).toContain('Old message');
  });

  it('reads local drafts with explicit editor body and quoted original html', () => {
    const storage = makeStorage({
      draft: JSON.stringify({
        compose_mode: 'draft',
        from_mailbox_id: '  mbx-1 ',
        to: ['User <user@example.com>'],
        cc: ['copy@example.com'],
        subject: 'Stored subject',
        editor_body: '<p>Draft body</p>',
        quoted_original_html: '<blockquote>Original</blockquote>',
        draft_attachments: [{ id: 'att-1' }],
        draft_id: 99,
        saved_at: '2026-05-02T10:00:00Z',
      }),
    });

    expect(readStoredComposeState({
      composeDraftKey: 'draft',
      resolveComposeMailboxId: (value) => String(value || '').trim().toUpperCase(),
      storage,
    })).toMatchObject({
      composeMode: 'draft',
      composeFromMailboxId: 'MBX-1',
      composeToValues: ['user@example.com'],
      composeCcValues: ['copy@example.com'],
      composeSubject: 'Stored subject',
      composeBody: '<p>Draft body</p>',
      composeQuotedOriginalHtml: '<blockquote>Original</blockquote>',
      composeDraftAttachments: [{ id: 'att-1' }],
      composeDraftId: '99',
      draftSyncState: 'local_only',
      draftSavedAt: '2026-05-02T10:00:00Z',
    });
  });

  it('reads legacy local drafts by splitting quoted history from body', () => {
    const storage = makeStorage({
      draft: JSON.stringify({
        body: '<p>Reply text</p><blockquote><p>Quoted</p></blockquote>',
        reply_to_message_id: 123,
      }),
    });

    const state = readStoredComposeState({
      composeDraftKey: 'draft',
      resolveComposeMailboxId: (value) => value,
      storage,
    });

    expect(state.composeBody).toContain('Reply text');
    expect(state.composeQuotedOriginalHtml).toContain('Quoted');
    expect(state.composeReplyToMessageId).toBe('123');
  });

  it('ignores missing or invalid local drafts', () => {
    expect(readStoredComposeState({
      composeDraftKey: 'missing',
      storage: makeStorage({}),
    })).toBeNull();

    expect(readStoredComposeState({
      composeDraftKey: 'bad',
      storage: makeStorage({ bad: '{bad json' }),
    })).toBeNull();
  });
});
