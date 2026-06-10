import { chatConversationsAPI } from '../api/chatConversations';
import { chatDirectoryAPI } from '../api/chatDirectory';
import { collectAddressBookChatLookup } from '../components/addressBook/addressBookUtils';

const normalizeText = (value) => String(value || '').trim();

export const resolveAddressBookChatUser = async (entry) => {
  const lookup = collectAddressBookChatLookup(entry);
  const emails = Array.isArray(lookup.emails) ? lookup.emails : [];
  for (const email of emails) {
    try {
      const user = await chatDirectoryAPI.resolveUser({ email, full_name: lookup.fullName });
      if (user?.id) return user;
    } catch (error) {
      if (Number(error?.response?.status || 0) !== 404) {
        throw error;
      }
    }
  }
  if (lookup.fullName) {
    return chatDirectoryAPI.resolveUser({ full_name: lookup.fullName });
  }
  const notFound = new Error('Сотрудник не найден в HUB-чате.');
  notFound.response = { status: 404, data: { detail: notFound.message } };
  throw notFound;
};

export const openAddressBookChat = async ({
  entry,
  navigate,
} = {}) => {
  if (typeof navigate !== 'function') {
    throw new Error('navigate is required');
  }
  const user = await resolveAddressBookChatUser(entry);
  const peerUserId = Number(user?.id || 0);
  if (!Number.isFinite(peerUserId) || peerUserId <= 0) {
    const notFound = new Error('Сотрудник не найден в HUB-чате.');
    notFound.response = { status: 404, data: { detail: notFound.message } };
    throw notFound;
  }
  const conversation = await chatConversationsAPI.createDirectConversation(peerUserId);
  const conversationId = normalizeText(conversation?.id);
  if (!conversationId) {
    throw new Error('Не удалось открыть личный диалог.');
  }
  navigate(`/chat?conversation=${encodeURIComponent(conversationId)}`);
  return conversation;
};
