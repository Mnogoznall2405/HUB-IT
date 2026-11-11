import { getSenderEmail } from './mailMessagePresentation';
import { getMailPersonDisplay, getMailPersonEmail } from './mailPeople';

const normalizeFolder = (value) => String(value || '').trim().toLowerCase();

const toEmailSet = (mailboxEmails) => {
  if (mailboxEmails instanceof Set) return mailboxEmails;
  if (Array.isArray(mailboxEmails)) {
    return new Set(mailboxEmails.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  }
  return new Set();
};

export function getMailSenderPerson(message) {
  return message?.sender_person || {
    display: message?.sender_display,
    name: message?.sender_name,
    email: message?.sender_email || message?.sender,
  };
}

export function getMailRecipientPeople(message) {
  if (Array.isArray(message?.to_people) && message.to_people.length > 0) return message.to_people;
  if (Array.isArray(message?.recipient_people) && message.recipient_people.length > 0) return message.recipient_people;
  if (Array.isArray(message?.to) && message.to.length > 0) return message.to;
  if (Array.isArray(message?.recipients) && message.recipients.length > 0) return message.recipients;
  return [];
}

export function isMailOutgoingMessage(message, { folder, mailboxEmails } = {}) {
  const contextFolder = normalizeFolder(folder || message?.folder);
  if (contextFolder === 'sent' || contextFolder === 'drafts') return true;
  const senderEmail = getMailPersonEmail(getMailSenderPerson(message));
  const emails = toEmailSet(mailboxEmails);
  return Boolean(senderEmail && emails.has(senderEmail));
}

export function isOwnConversationMessage(item, { folder, mailboxEmails } = {}) {
  const sender = getSenderEmail(item);
  const emails = toEmailSet(mailboxEmails);
  if (sender && emails.has(sender)) return true;
  if (folder === 'sent' || folder === 'drafts') return true;
  return false;
}

export function isMailSelfPerson(person, mailboxEmails) {
  const email = getMailPersonEmail(person);
  if (!email) return false;
  return toEmailSet(mailboxEmails).has(email);
}

export function formatMailSelfAwareName(person, mailboxEmails, { selfLabel = 'Вы', fallback = '-' } = {}) {
  if (isMailSelfPerson(person, mailboxEmails)) return selfLabel;
  return getMailPersonDisplay(person, fallback);
}

export function getPrimaryCorrespondent(message, {
  folder,
  isSearch = false,
  mailboxEmails,
} = {}) {
  const contextFolder = normalizeFolder(folder || message?.folder);
  const sender = getMailSenderPerson(message);
  const recipients = getMailRecipientPeople(message);
  const firstRecipient = recipients[0] || null;
  const extraCount = Math.max(0, recipients.length - 1);
  const outgoing = isMailOutgoingMessage(message, { folder: contextFolder, mailboxEmails });

  const fromResult = {
    kind: 'from',
    direction: 'incoming',
    person: sender,
    extraCount: 0,
    prefix: isSearch ? 'От' : '',
    emptyLabel: '',
  };
  const toResult = {
    kind: 'to',
    direction: 'outgoing',
    person: firstRecipient,
    extraCount,
    prefix: isSearch ? 'Кому' : '',
    emptyLabel: 'Без получателя',
  };

  if (isSearch) return outgoing ? toResult : fromResult;
  if (contextFolder === 'sent' || contextFolder === 'drafts') return toResult;
  if (contextFolder === 'trash') return outgoing ? toResult : fromResult;
  return fromResult;
}

export function formatPrimaryCorrespondentLabel(correspondent, fallback = '-') {
  if (!correspondent) return fallback;
  const extra = Number(correspondent.extraCount || 0) > 0 ? ` +${correspondent.extraCount}` : '';
  if (!correspondent.person) {
    const empty = correspondent.emptyLabel || fallback;
    return correspondent.prefix ? `${correspondent.prefix}: ${empty}` : empty;
  }
  const name = getMailPersonDisplay(correspondent.person, fallback);
  const labeled = correspondent.prefix ? `${correspondent.prefix}: ${name}` : name;
  return `${labeled}${extra}`;
}

export function formatMailRecipientSummary(people, { maxVisible = 2 } = {}) {
  const items = (Array.isArray(people) ? people : [])
    .map((person) => getMailPersonDisplay(person, ''))
    .filter(Boolean);
  if (!items.length) return '';
  const visible = items.slice(0, maxVisible);
  const hiddenCount = Math.max(0, items.length - visible.length);
  if (hiddenCount > 0) {
    return `${visible.join(', ')}  +${hiddenCount}`;
  }
  return visible.join(', ');
}
