export function parseNativeMailEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function resolveNativeMailEnabled(value: string | undefined): boolean {
  return value === undefined ? true : parseNativeMailEnabled(value);
}

export const NATIVE_MAIL_ENABLED = resolveNativeMailEnabled(
  process.env.EXPO_PUBLIC_NATIVE_MAIL_ENABLED,
);

type MailListParams = {
  mailboxId?: string;
  folder?: string;
  q?: string;
  view?: 'messages' | 'conversations';
  unreadOnly?: string;
  hasAttachments?: string;
  dateFrom?: string;
  dateTo?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  importance?: string;
  folderScope?: 'current' | 'all';
};

type MailDetailParams = {
  messageId: string;
  mailboxId?: string;
  folder?: string;
};

type MailConversationParams = {
  conversationId: string;
  mailboxId?: string;
  folder?: string;
};

export type NativeMailComposeMode = 'new' | 'reply' | 'reply_all' | 'forward' | 'draft';

type MailComposeParams = {
  mode: NativeMailComposeMode;
  mailboxId?: string;
  sourceMessageId?: string;
  draftId?: string;
  to?: string;
  subject?: string;
};

export type NativeMailDestination =
  | { pathname: '/(shell)/mail'; params?: MailListParams }
  | { pathname: '/(shell)/mail/[messageId]'; params: MailDetailParams }
  | { pathname: '/(shell)/mail/conversation/[conversationId]'; params: MailConversationParams }
  | { pathname: '/(shell)/mail/compose'; params: MailComposeParams };

function normalizedParam(parsed: URL, key: string, maxLength = 8_192): string | undefined {
  const value = String(parsed.searchParams.get(key) || '').trim();
  return value && value.length <= maxLength ? value : undefined;
}

function decodedPathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function mailListParams(parsed: URL, pathFolder = ''): MailListParams | undefined {
  const folder = normalizedParam(parsed, 'folder', 2_048) || pathFolder || undefined;
  const mailboxId = normalizedParam(parsed, 'mailbox_id', 256);
  const q = normalizedParam(parsed, 'q', 512);
  const rawView = normalizedParam(parsed, 'view', 32);
  const view: MailListParams['view'] = rawView === 'conversations' || rawView === 'messages' ? rawView : undefined;
  const unreadOnly = ['1', 'true'].includes(String(parsed.searchParams.get('unread_only') || '').toLowerCase()) ? '1' : undefined;
  const hasAttachments = ['1', 'true'].includes(String(parsed.searchParams.get('has_attachments') || '').toLowerCase()) ? '1' : undefined;
  const rawFolderScope = normalizedParam(parsed, 'folder_scope', 32);
  const folderScope: 'current' | 'all' | undefined = rawFolderScope === 'all'
    ? 'all'
    : rawFolderScope === 'current'
      ? 'current'
      : undefined;
  const rawImportance = normalizedParam(parsed, 'importance', 16);
  const importance = ['high', 'normal', 'low'].includes(String(rawImportance || '')) ? rawImportance : undefined;
  const params = {
    mailboxId,
    folder,
    q,
    view,
    unreadOnly,
    hasAttachments,
    dateFrom: normalizedParam(parsed, 'date_from', 10),
    dateTo: normalizedParam(parsed, 'date_to', 10),
    from: normalizedParam(parsed, 'from_filter', 512),
    to: normalizedParam(parsed, 'to_filter', 512),
    subject: normalizedParam(parsed, 'subject_filter', 512),
    body: normalizedParam(parsed, 'body_filter', 512),
    importance,
    folderScope,
  };
  return Object.values(params).some(Boolean) ? params : undefined;
}

export function nativeMailDestinationFromPortalPath(path: string): NativeMailDestination | null {
  let parsed: URL;
  try {
    parsed = new URL(String(path || ''), 'https://hubit.invalid');
  } catch {
    return null;
  }

  const pathMatch = parsed.pathname.match(/^\/mail(?:\/([^/]+))?\/?$/);
  if (!pathMatch) return null;
  const child = pathMatch[1] ? decodedPathSegment(pathMatch[1]) : '';
  if (child === null) return null;

  // Android incoming shares stay in the existing web composer until their
  // binary handoff store is available to the native composer.
  if (parsed.searchParams.has('android_share_id')) return null;

  const mailboxId = normalizedParam(parsed, 'mailbox_id', 256);
  const draftId = normalizedParam(parsed, 'draft_id');
  const compose = normalizedParam(parsed, 'compose', 32);
  const composeMode: NativeMailComposeMode | null = ['new', 'reply', 'reply_all', 'forward'].includes(String(compose || ''))
    ? compose as NativeMailComposeMode
    : compose ? null : 'new';
  const composeTo = normalizedParam(parsed, 'compose_to', 2_048) || normalizedParam(parsed, 'to', 2_048);
  const composeSubject = normalizedParam(parsed, 'subject', 2_048);
  const messageId = normalizedParam(parsed, 'message');
  if (child === 'compose' || draftId || compose) {
    if (!draftId && composeMode === null) return null;
    const mode: NativeMailComposeMode = draftId ? 'draft' : composeMode || 'new';
    if (mode !== 'new' && mode !== 'draft' && !messageId) return null;
    return {
      pathname: '/(shell)/mail/compose',
      params: {
        mode,
        ...(mailboxId ? { mailboxId } : {}),
        ...(draftId ? { draftId } : {}),
        ...(mode !== 'new' && mode !== 'draft' && messageId ? { sourceMessageId: messageId } : {}),
        ...(composeTo ? { to: composeTo } : {}),
        ...(composeSubject ? { subject: composeSubject } : {}),
      },
    };
  }

  if (child && !['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive'].includes(child)) return null;

  if (messageId) {
    return {
      pathname: '/(shell)/mail/[messageId]',
      params: {
        messageId,
        ...(mailboxId ? { mailboxId } : {}),
        ...(normalizedParam(parsed, 'folder', 2_048) || child
          ? { folder: normalizedParam(parsed, 'folder', 2_048) || child }
          : {}),
      },
    };
  }

  const conversationId = normalizedParam(parsed, 'conversation');
  if (conversationId) {
    return {
      pathname: '/(shell)/mail/conversation/[conversationId]',
      params: {
        conversationId,
        ...(mailboxId ? { mailboxId } : {}),
        ...(normalizedParam(parsed, 'folder', 2_048) || child
          ? { folder: normalizedParam(parsed, 'folder', 2_048) || child }
          : {}),
      },
    };
  }

  if (composeTo) {
    return {
      pathname: '/(shell)/mail/compose',
      params: {
        mode: 'new',
        ...(mailboxId ? { mailboxId } : {}),
        ...(composeTo ? { to: composeTo } : {}),
        ...(composeSubject ? { subject: composeSubject } : {}),
      },
    };
  }

  return { pathname: '/(shell)/mail', ...(mailListParams(parsed, child) ? { params: mailListParams(parsed, child) } : {}) };
}

export function nativeMailComposeDestination(payload: {
  mode: NativeMailComposeMode;
  mailboxId?: string | null;
  sourceMessageId?: string | null;
  draftId?: string | null;
  to?: string | null;
  subject?: string | null;
}): NativeMailDestination {
  return {
    pathname: '/(shell)/mail/compose',
    params: {
      mode: payload.mode,
      ...(payload.mailboxId ? { mailboxId: payload.mailboxId } : {}),
      ...(payload.sourceMessageId ? { sourceMessageId: payload.sourceMessageId } : {}),
      ...(payload.draftId ? { draftId: payload.draftId } : {}),
      ...(payload.to ? { to: payload.to } : {}),
      ...(payload.subject ? { subject: payload.subject } : {}),
    },
  };
}
