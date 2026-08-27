export type HubUser = {
  id: number;
  username: string;
  full_name?: string | null;
  first_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  role: string;
  permissions: string[];
  avatar_url?: string | null;
  job_title?: string | null;
  department?: string | null;
  is_active?: boolean;
  is_2fa_enabled?: boolean;
  use_custom_permissions?: boolean;
  custom_permissions?: string[];
  auth_source?: string | null;
  telegram_id?: number | string | null;
  assigned_database?: string | null;
  twofa_policy?: string | null;
  twofa_required_for_current_request?: boolean;
  network_zone?: string | null;
  trusted_devices_count?: number;
  about_onboarding_completed_at?: string | null;
};

export type LoginResponse = {
  status: 'authenticated' | '2fa_required' | '2fa_setup_required';
  access_token?: string | null;
  refresh_token?: string | null;
  user?: HubUser | null;
  session_id?: string | null;
  login_challenge_id?: string | null;
  available_second_factors?: string[];
  client_device_id?: string | null;
  biometric_enrollment_code?: string | null;
};

export type MobileBiometricEnrollResponse = {
  renewal_token: string;
};

export type ChatUserSummary = {
  id: number;
  username: string;
  full_name?: string | null;
  avatar_url?: string | null;
  role?: string;
  department?: string | null;
  job_title?: string | null;
  city?: string | null;
  corporate_email?: string | null;
  corporate_phone?: string | null;
  is_active?: boolean;
  presence?: {
    status?: 'online' | 'offline' | string;
    is_online?: boolean;
    last_seen_at?: string | null;
  } | null;
};

export type ChatMember = {
  user: ChatUserSummary;
  member_role: 'owner' | 'moderator' | 'member' | string;
  joined_at?: string | null;
};

export type ChatConversationKind = 'direct' | 'group' | 'ai' | 'notes' | 'task';

export type ChatAiBot = {
  id: string;
  name: string;
  title?: string;
  slug?: string;
  description?: string | null;
  surface?: string;
  conversation_id?: string | null;
  conversation_ids?: string[];
  use_personal_memory?: boolean;
  allow_file_input?: boolean;
};

export type ChatConversationSummary = {
  id: string;
  kind?: ChatConversationKind;
  title?: string | null;
  peer_user_id?: number | null;
  last_message_preview?: string | null;
  last_message_at?: string | null;
  last_message_seq?: number;
  viewer_last_read_seq?: number;
  unread_count?: number;
  avatar_url?: string | null;
  is_group?: boolean;
  is_pinned?: boolean;
  is_muted?: boolean;
  is_archived?: boolean;
  pinned_message_id?: string | null;
  online_member_count?: number;
  member_count?: number;
  viewer_member_role?: string | null;
  members?: ChatMember[];
  member_preview?: ChatMember[];
  direct_peer?: ChatUserSummary | null;
};

export type ChatTaskPreview = {
  id: string;
  title: string;
  status?: string;
  priority?: string;
  assignee_full_name?: string | null;
  assignee_username?: string | null;
  due_at?: string | null;
  is_overdue?: boolean;
};

export type ChatConversationPage = {
  items: ChatConversationSummary[];
  has_more: boolean;
  next_cursor: string | null;
};

export type ChatAttachment = {
  id: string;
  message_id?: string;
  kind?: 'image' | 'video' | 'file' | 'audio' | 'sticker';
  file_name?: string;
  mime_type?: string | null;
  media_kind?: 'image' | 'video' | 'file' | 'audio' | 'sticker' | null;
  file_size?: number;
  duration_seconds?: number | null;
  original_url?: string | null;
  download_url?: string | null;
  variant_urls?: Record<string, string>;
  /** Compatibility with older mobile/chat payloads. */
  url?: string;
  preview_url?: string;
  /** Local-only URI used while a native attachment is still uploading. */
  local_uri?: string;
};

export type TwoFactorSetupResponse = {
  login_challenge_id: string;
  otpauth_uri: string;
  issuer: string;
  account_name: string;
  manual_entry_key: string;
  qr_svg?: string | null;
};

export type TwoFactorSetupVerifyResponse = LoginResponse & {
  backup_codes: string[];
};

export type ChatConversationAttachment = ChatAttachment & {
  message_id: string;
  created_at?: string;
};

export type ChatAttachmentPage = {
  items: ChatConversationAttachment[];
  has_more: boolean;
  next_before_attachment_id: string | null;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_user_id: number;
  conversation_seq?: number;
  client_message_id?: string | null;
  kind?: 'text' | 'task_share' | 'file' | 'system';
  body_format?: 'plain' | 'markdown';
  /** Normalized mobile field. The backend field is `body`. */
  body_text?: string | null;
  body?: string | null;
  sender?: ChatUserSummary | null;
  created_at?: string | null;
  edited_at?: string | null;
  is_own?: boolean;
  /** Local-only optimistic state; never sent to the backend. */
  local_status?: 'sending' | 'failed' | 'cancelled';
  is_deleted?: boolean;
  deleted_at?: string | null;
  deleted_by_user_id?: number | null;
  deleted_reason?: string | null;
  attachments?: ChatAttachment[];
  reactions?: Array<{
    emoji: string;
    count: number;
    user_ids?: number[];
    reacted_by_me?: boolean;
  }>;
  delivery_status?: 'sent' | 'read' | null;
  read_by_count?: number;
  reply_preview?: {
    id: string;
    sender_name: string;
    kind?: 'text' | 'task_share' | 'file';
    body?: string;
    attachments_count?: number;
  } | null;
  forward_preview?: {
    id: string;
    sender_name: string;
    kind?: 'text' | 'task_share' | 'file';
    body?: string;
    attachments_count?: number;
  } | null;
  task_preview?: ChatTaskPreview | null;
  action_card?: Record<string, unknown> | null;
};

export type ChatMessageReadReceipt = {
  user: ChatUserSummary;
  read_at: string;
};

export type ChatSticker = {
  id: string;
  emoji?: string;
  format?: 'static' | 'video' | 'animated';
  mime_type?: string;
  file_size?: number;
  width?: number | null;
  height?: number | null;
  file_url?: string;
  preview_url?: string | null;
};

export type ChatStickerPack = {
  id: string;
  short_name: string;
  title: string;
  sticker_type?: string;
  is_added?: boolean;
  stickers: ChatSticker[];
};

export type ChatMessagePage = {
  items: ChatMessage[];
  has_more: boolean;
  has_older: boolean;
  has_newer: boolean;
  cursor_invalid: boolean;
  older_cursor_message_id: string | null;
  newer_cursor_message_id: string | null;
  viewer_last_read_message_id: string | null;
  viewer_last_read_at: string | null;
};

export type ChatPinnedMessagePreview = {
  id: string;
  sender_name?: string;
  preview?: string;
  created_at?: string;
};

export type ChatThreadBootstrapPage = ChatMessagePage & {
  initial_anchor_mode: 'bottom' | 'message' | 'first_unread';
  initial_anchor_message_id: string | null;
  pinned_message_id?: string | null;
  pinned_message?: ChatPinnedMessagePreview | null;
};

export type ChatGlobalMessageSearchHit = {
  conversation_id: string;
  conversation_title: string;
  conversation_kind?: string;
  message_id: string;
  created_at?: string | null;
  sender_name?: string;
  preview?: string;
};

export type ChatFolderSummary = {
  id: string;
  name: string;
  sort_order?: number;
  conversation_count?: number;
  unread_count?: number;
  conversation_ids?: string[];
  created_at?: string;
  updated_at?: string;
};

export type ChatFolderListResponse = {
  items: ChatFolderSummary[];
  conversation_ids_by_folder: Record<string, string[]>;
  folder_unread_counts?: Record<string, number>;
};
