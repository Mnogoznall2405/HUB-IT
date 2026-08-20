import { describe, expect, it } from 'vitest';
import {
  formatPrimaryCorrespondentLabel,
  getPrimaryCorrespondent,
  isMailOutgoingMessage,
  isOwnConversationMessage,
} from './mailCorrespondent';

const currentUser = new Set(['me@company.ru']);

const incomingMessage = {
  folder: 'inbox',
  sender_person: { display: 'Иванов Сергей', email: 'ivanov@company.ru' },
  to_people: [{ display: 'Я', email: 'me@company.ru' }],
};

const sentMessage = {
  folder: 'sent',
  sender_person: { display: 'Я', email: 'me@company.ru' },
  to_people: [
    { display: 'Иванов Сергей', email: 'ivanov@company.ru' },
    { display: 'Петрова Анна', email: 'petrova@company.ru' },
    { display: 'Сидоров', email: 'sidorov@company.ru' },
  ],
};

describe('getPrimaryCorrespondent', () => {
  it('shows the sender for inbox mail', () => {
    const result = getPrimaryCorrespondent(incomingMessage, { folder: 'inbox', mailboxEmails: currentUser });
    expect(formatPrimaryCorrespondentLabel(result)).toBe('Иванов Сергей');
    expect(result.kind).toBe('from');
  });

  it('shows the first recipient and leftover count for sent mail', () => {
    const result = getPrimaryCorrespondent(sentMessage, { folder: 'sent', mailboxEmails: currentUser });
    expect(formatPrimaryCorrespondentLabel(result)).toBe('Иванов Сергей +2');
    expect(result.kind).toBe('to');
  });

  it('shows a placeholder for a draft without recipients', () => {
    const result = getPrimaryCorrespondent({
      folder: 'drafts',
      sender_person: { display: 'Я', email: 'me@company.ru' },
      to_people: [],
    }, { folder: 'drafts', mailboxEmails: currentUser });
    expect(formatPrimaryCorrespondentLabel(result)).toBe('Без получателя');
  });

  it('shows the recipient for a draft with recipients', () => {
    const result = getPrimaryCorrespondent({
      folder: 'drafts',
      sender_person: { display: 'Я', email: 'me@company.ru' },
      recipient_people: [{ display: 'Петрова Анна', email: 'petrova@company.ru' }],
    }, { folder: 'drafts', mailboxEmails: currentUser });
    expect(formatPrimaryCorrespondentLabel(result)).toBe('Петрова Анна');
  });

  it('shows the sender for junk mail', () => {
    const result = getPrimaryCorrespondent({
      ...incomingMessage,
      folder: 'junk',
    }, { folder: 'junk', mailboxEmails: currentUser });
    expect(formatPrimaryCorrespondentLabel(result)).toBe('Иванов Сергей');
  });

  it('shows the sender for deleted incoming mail and the recipient for deleted outgoing mail', () => {
    const deletedIncoming = getPrimaryCorrespondent({
      ...incomingMessage,
      folder: 'trash',
    }, { folder: 'trash', mailboxEmails: currentUser });
    expect(formatPrimaryCorrespondentLabel(deletedIncoming)).toBe('Иванов Сергей');

    const deletedOutgoing = getPrimaryCorrespondent({
      ...sentMessage,
      folder: 'trash',
    }, { folder: 'trash', mailboxEmails: currentUser });
    expect(formatPrimaryCorrespondentLabel(deletedOutgoing)).toBe('Иванов Сергей +2');
    expect(isMailOutgoingMessage(deletedOutgoing.person ? sentMessage : incomingMessage, {
      folder: 'trash',
      mailboxEmails: currentUser,
    })).toBe(true);
  });

  it('falls back to the sender when deleted-mail direction cannot be determined', () => {
    const result = getPrimaryCorrespondent({
      folder: 'trash',
      sender_person: { display: 'Неизвестный', email: 'unknown@company.ru' },
      to_people: [{ display: 'Кто-то', email: 'other@company.ru' }],
    }, { folder: 'trash', mailboxEmails: currentUser });
    expect(formatPrimaryCorrespondentLabel(result)).toBe('Неизвестный');
  });

  it('prefixes search results with direction', () => {
    const incoming = getPrimaryCorrespondent(incomingMessage, {
      folder: 'inbox',
      isSearch: true,
      mailboxEmails: currentUser,
    });
    expect(formatPrimaryCorrespondentLabel(incoming)).toBe('От: Иванов Сергей');

    const outgoing = getPrimaryCorrespondent(sentMessage, {
      folder: 'sent',
      isSearch: true,
      mailboxEmails: currentUser,
    });
    expect(formatPrimaryCorrespondentLabel(outgoing)).toBe('Кому: Иванов Сергей +2');
  });
});

describe('isOwnConversationMessage', () => {
  it('matches the mailbox sender in inbox and treats sent/drafts as own', () => {
    expect(isOwnConversationMessage(
      { sender_email: 'me@company.ru' },
      { folder: 'inbox', mailboxEmails: currentUser },
    )).toBe(true);
    expect(isOwnConversationMessage(
      { sender_email: 'ivanov@company.ru' },
      { folder: 'inbox', mailboxEmails: currentUser },
    )).toBe(false);
    expect(isOwnConversationMessage(
      { sender_email: 'ivanov@company.ru' },
      { folder: 'sent', mailboxEmails: currentUser },
    )).toBe(true);
    expect(isOwnConversationMessage(
      { sender_email: 'ivanov@company.ru' },
      { folder: 'drafts', mailboxEmails: currentUser },
    )).toBe(true);
  });

  it('uses the page folder and getSenderEmail, not isMailOutgoingMessage rules', () => {
    const sentLikeItem = {
      folder: 'sent',
      sender: 'Иванов <ivanov@company.ru>',
    };
    expect(isMailOutgoingMessage(sentLikeItem, { mailboxEmails: currentUser })).toBe(true);
    expect(isOwnConversationMessage(sentLikeItem, { folder: 'inbox', mailboxEmails: currentUser })).toBe(false);

    const mixedCaseSender = { sender: 'Me@company.ru' };
    expect(isMailOutgoingMessage(mixedCaseSender, { folder: 'inbox', mailboxEmails: currentUser })).toBe(true);
    expect(isOwnConversationMessage(mixedCaseSender, { folder: 'inbox', mailboxEmails: currentUser })).toBe(false);

    expect(isOwnConversationMessage(
      { sender: 'Boss Name <me@company.ru>' },
      { folder: 'inbox', mailboxEmails: currentUser },
    )).toBe(true);
  });
});
