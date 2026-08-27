import axios from 'axios';
import { createDirectConversation, resolveChatUser } from '../api/chatApi';
import type { ChatUserSummary } from '../api/types';
import { openPortalPath } from '../navigation/moduleRegistry';
import {
  collectAddressBookChatLookup,
  type AddressBookEntry,
} from './addressBookFormat';

const NOT_FOUND_MESSAGE = 'Сотрудник не найден в HUB-чате.';

function notFoundError(detail = NOT_FOUND_MESSAGE): Error {
  const error = new Error(detail);
  (error as Error & { response?: { status: number; data: { detail: string } } }).response = {
    status: 404,
    data: { detail },
  };
  return error;
}

export function isAddressBookChatNotFound(error: unknown): boolean {
  if (axios.isAxiosError(error) && Number(error.response?.status || 0) === 404) return true;
  const status = Number((error as { response?: { status?: number } } | null)?.response?.status || 0);
  if (status === 404) return true;
  return error instanceof Error && /не найден в HUB-чате/i.test(error.message);
}

export function getAddressBookChatErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
  }
  const detail = (error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export async function resolveAddressBookChatUser(entry: AddressBookEntry | null | undefined): Promise<ChatUserSummary> {
  const lookup = collectAddressBookChatLookup(entry);
  const emails = Array.isArray(lookup.emails) ? lookup.emails : [];
  for (const email of emails) {
    try {
      const user = await resolveChatUser({ email, full_name: lookup.fullName });
      if (user?.id) return user;
    } catch (error) {
      if (!isAddressBookChatNotFound(error)) throw error;
    }
  }
  if (lookup.fullName) {
    return resolveChatUser({ full_name: lookup.fullName });
  }
  throw notFoundError();
}

export async function openAddressBookChat(entry: AddressBookEntry | null | undefined): Promise<void> {
  const user = await resolveAddressBookChatUser(entry);
  const peerUserId = Number(user?.id || 0);
  if (!Number.isFinite(peerUserId) || peerUserId <= 0) {
    throw notFoundError();
  }
  const conversation = await createDirectConversation(peerUserId);
  const conversationId = String(conversation?.id || '').trim();
  if (!conversationId) {
    throw new Error('Не удалось открыть личный диалог.');
  }
  openPortalPath(`/chat?conversation=${encodeURIComponent(conversationId)}`);
}
