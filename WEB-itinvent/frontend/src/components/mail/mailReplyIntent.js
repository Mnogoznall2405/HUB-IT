import {
  getMailRecipientPeople,
  isMailSelfPerson,
} from './mailCorrespondent';
import { getMailPersonDisplay, getMailPersonEmail } from './mailPeople';

export function getMailCcPeople(message) {
  if (Array.isArray(message?.cc_people) && message.cc_people.length > 0) return message.cc_people;
  if (Array.isArray(message?.cc) && message.cc.length > 0) return message.cc;
  return [];
}

function asPeople(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function isOtherMailParty(person, mailboxEmails) {
  if (!person) return false;
  if (isMailSelfPerson(person, mailboxEmails)) return false;
  return Boolean(getMailPersonEmail(person) || getMailPersonDisplay(person, ''));
}

export function collectOtherMailRecipients(message, mailboxEmails) {
  return [...getMailRecipientPeople(message), ...getMailCcPeople(message)]
    .filter((person) => isOtherMailParty(person, mailboxEmails));
}

export function collectOtherMailParticipants(participants, mailboxEmails) {
  return asPeople(participants).filter((person) => isOtherMailParty(person, mailboxEmails));
}

export function shouldDefaultToReplyAll({
  message,
  mailboxEmails,
  conversationParticipants,
} = {}) {
  const conversationPeople = asPeople(conversationParticipants);
  if (conversationPeople.length > 0) {
    return collectOtherMailParticipants(conversationPeople, mailboxEmails).length > 1;
  }
  return collectOtherMailRecipients(message, mailboxEmails).length > 0;
}

export function getDefaultMailReplyMode(options = {}) {
  return shouldDefaultToReplyAll(options) ? 'reply_all' : 'reply';
}

export function getMailSelectedReplyMode({
  message,
  mailboxEmails,
  selectedConversation,
  viewMode,
} = {}) {
  return getDefaultMailReplyMode({
    message,
    mailboxEmails,
    conversationParticipants: viewMode === 'conversations'
      ? (selectedConversation?.participant_people || [])
      : [],
  });
}

export function getMailReplyActionLabel(mode) {
  return mode === 'reply_all' ? 'Ответить всем' : 'Ответить';
}

export function getMailQuickReplyPlaceholder(mode) {
  return mode === 'reply_all' ? 'Ответить всем…' : 'Ответить на письмо…';
}
