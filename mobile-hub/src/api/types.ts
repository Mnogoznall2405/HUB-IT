export type HubUser = {
  id: number;
  username: string;
  full_name?: string | null;
  email?: string | null;
  role: string;
  permissions: string[];
  avatar_url?: string | null;
  is_2fa_enabled?: boolean;
};

export type LoginResponse = {
  status: 'authenticated' | '2fa_required' | '2fa_setup_required';
  access_token?: string | null;
  refresh_token?: string | null;
  user?: HubUser | null;
  session_id?: string | null;
  login_challenge_id?: string | null;
  available_second_factors?: string[];
};

export type ChatConversationSummary = {
  id: string;
  title?: string | null;
  peer_user_id?: number | null;
  last_message_preview?: string | null;
  last_message_at?: string | null;
  unread_count?: number;
  avatar_url?: string | null;
  is_group?: boolean;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_user_id: number;
  body_text?: string | null;
  created_at?: string | null;
  is_own?: boolean;
  attachments?: Array<{ id: string; file_name?: string; mime_type?: string; url?: string }>;
  reactions?: Array<{ emoji: string; count: number; reacted_by_me?: boolean }>;
};
