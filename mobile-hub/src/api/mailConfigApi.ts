import apiClient from './client';

export type NativeMailConfig = {
  id?: string | null;
  mailbox_id?: string | null;
  label?: string | null;
  mailbox_email?: string | null;
  mailbox_login?: string | null;
  effective_mailbox_login?: string | null;
  auth_mode?: string | null;
  mail_auth_mode?: string | null;
  is_primary?: boolean;
  is_active?: boolean;
  mail_requires_relogin?: boolean;
  mail_requires_password?: boolean;
  mail_signature_html?: string | null;
  mail_is_configured?: boolean;
  mail_updated_at?: string | null;
};

export type SaveMyMailCredentialsPayload = {
  mailboxId?: string;
  mailboxLogin?: string;
  mailboxPassword: string;
  mailboxEmail?: string;
};

export type NativeMailPreferences = {
  reading_pane: 'right' | 'bottom' | 'off' | string;
  density: 'comfortable' | 'compact' | string;
  mark_read_on_select: boolean;
  show_preview_snippets: boolean;
  show_favorites_first: boolean;
  folder_pane_width?: number;
  message_list_width?: number;
  bottom_list_percent?: number;
};

export type NativeMailPreferencesPatch = Partial<Pick<
  NativeMailPreferences,
  'density' | 'mark_read_on_select' | 'show_preview_snippets' | 'show_favorites_first'
>>;

export const DEFAULT_NATIVE_MAIL_PREFERENCES: NativeMailPreferences = {
  reading_pane: 'right',
  density: 'comfortable',
  mark_read_on_select: false,
  show_preview_snippets: true,
  show_favorites_first: true,
};

function normalizedMailboxId(mailboxId: unknown): string {
  const value = String(mailboxId || '').trim();
  if (value.length > 256) throw new Error('Некорректный почтовый ящик');
  return value;
}

export async function getMyMailConfig(mailboxId = ''): Promise<NativeMailConfig> {
  const normalized = normalizedMailboxId(mailboxId);
  const { data } = await apiClient.get<NativeMailConfig>('/mail/config/me', {
    params: normalized ? { mailbox_id: normalized } : {},
  });
  return data;
}

export async function testMyMailConnection(mailboxId = ''): Promise<Record<string, unknown>> {
  const normalized = normalizedMailboxId(mailboxId);
  const { data } = await apiClient.post<Record<string, unknown>>('/mail/test-connection', normalized
    ? { mailbox_id: normalized }
    : {});
  return data;
}

export async function updateMyMailSignature(mailboxId: string, signatureHtml: string): Promise<NativeMailConfig> {
  const normalized = normalizedMailboxId(mailboxId);
  const { data } = await apiClient.patch<NativeMailConfig>('/mail/config/me', {
    mailbox_id: normalized || undefined,
    mail_signature_html: String(signatureHtml || ''),
  });
  return data;
}

export async function saveMyMailCredentials(payload: SaveMyMailCredentialsPayload): Promise<NativeMailConfig> {
  const mailboxId = normalizedMailboxId(payload.mailboxId);
  const mailboxPassword = String(payload.mailboxPassword || '').trim();
  if (!mailboxPassword || mailboxPassword.length > 256) {
    throw new Error('Введите корректный пароль от корпоративного компьютера');
  }
  const mailboxLogin = String(payload.mailboxLogin || '').trim();
  const mailboxEmail = String(payload.mailboxEmail || '').trim();
  const { data } = await apiClient.post<NativeMailConfig>('/mail/config/me/credentials', {
    mailbox_id: mailboxId || undefined,
    mailbox_login: mailboxLogin || undefined,
    mailbox_password: mailboxPassword,
    mailbox_email: mailboxEmail || undefined,
  });
  return data;
}

function normalizeMailPreferences(payload: unknown): NativeMailPreferences {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const nested = root.preferences && typeof root.preferences === 'object'
    ? root.preferences as Partial<NativeMailPreferences>
    : root as Partial<NativeMailPreferences>;
  return { ...DEFAULT_NATIVE_MAIL_PREFERENCES, ...nested };
}

export async function getNativeMailPreferences(): Promise<NativeMailPreferences> {
  const { data } = await apiClient.get<unknown>('/mail/preferences');
  return normalizeMailPreferences(data);
}

export async function updateNativeMailPreferences(
  patch: NativeMailPreferencesPatch,
): Promise<NativeMailPreferences> {
  const payload: NativeMailPreferencesPatch = {};
  if (patch.density !== undefined) {
    if (patch.density !== 'comfortable' && patch.density !== 'compact') {
      throw new Error('Некорректная плотность списка писем');
    }
    payload.density = patch.density;
  }
  if (patch.mark_read_on_select !== undefined) payload.mark_read_on_select = Boolean(patch.mark_read_on_select);
  if (patch.show_preview_snippets !== undefined) payload.show_preview_snippets = Boolean(patch.show_preview_snippets);
  if (patch.show_favorites_first !== undefined) payload.show_favorites_first = Boolean(patch.show_favorites_first);
  const { data } = await apiClient.patch<unknown>('/mail/preferences', payload);
  return normalizeMailPreferences(data);
}
