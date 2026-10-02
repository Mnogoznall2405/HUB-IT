import { addressBookAPI } from '../api/addressBook';
import { chatConversationsAPI } from '../api/chatConversations';
import { chatDirectoryAPI } from '../api/chatDirectory';
import { collectAddressBookChatLookup } from '../components/addressBook/addressBookUtils';

const normalizeText = (value) => String(value || '').trim();
const normalizeEmail = (value) => normalizeText(value).toLowerCase();
const normalizePersonText = (value) => normalizeText(value).toLowerCase().replace(/\s+/g, ' ');

const collectEntryEmails = (entry) => [
  ...(Array.isArray(entry?.work_emails) ? entry.work_emails : []),
  ...(Array.isArray(entry?.personal_emails) ? entry.personal_emails : []),
]
  .map((item) => normalizeEmail(item?.normalized || item?.value))
  .filter(Boolean);

const findEntryByEmail = async (email) => {
  const payload = await addressBookAPI.search({ q: email, limit: 10 });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.find((item) => collectEntryEmails(item).includes(email)) || null;
};

const findEntryByFullName = async (user) => {
  const fullName = normalizePersonText(user?.full_name);
  if (!fullName) return null;
  const payload = await addressBookAPI.search({ q: fullName, limit: 20 });
  const items = (Array.isArray(payload?.items) ? payload.items : [])
    .filter((item) => normalizePersonText(item?.full_name) === fullName);
  if (items.length === 1) return items[0];
  if (items.length > 1) {
    const department = normalizePersonText(user?.department);
    const position = normalizePersonText(user?.job_title);
    const narrowed = items.filter((item) => (
      (department && normalizePersonText(item?.department) === department)
      || (position && normalizePersonText(item?.position) === position)
    ));
    if (narrowed.length === 1) return narrowed[0];
  }
  return null;
};

/**
 * Strictly match a HUB chat user to an address-book entry (same order as the
 * backend ZUP resolver: work email first, then a unique exact full name).
 * Returns null when the match is missing or ambiguous so caller UI can hide
 * the workplace fields instead of showing another employee's office.
 */
export const findAddressBookEntryForChatUser = async (user) => {
  if (!user || typeof user !== 'object') return null;
  const emails = [...new Set(
    [user.corporate_email, user.email, user.mailbox_email, user.mailbox_login, user.username]
      .map(normalizeEmail)
      .filter((value) => value.includes('@')),
  )];
  for (const email of emails) {
    const entry = await findEntryByEmail(email);
    if (entry) return entry;
  }
  return findEntryByFullName(user);
};

/** Public workplace fields the chat info panel shows for a direct peer. */
export const pickAddressBookWorkplace = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const officeAddress = normalizeText(entry.office_address);
  const officeRoomRaw = normalizeText(entry.office_room);
  const officeRoom = officeRoomRaw && officeRoomRaw !== '0' ? officeRoomRaw : '';
  if (!officeAddress && !officeRoom) return null;
  return { office_address: officeAddress, office_room: officeRoom };
};

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
