import { describe, expect, it } from 'vitest';
import {
  collectOtherMailRecipients,
  getDefaultMailReplyMode,
  getMailQuickReplyPlaceholder,
  getMailSelectedReplyMode,
  shouldDefaultToReplyAll,
} from './mailReplyIntent';

const me = ['user@example.com'];

describe('mailReplyIntent', () => {
  it('defaults to reply when the current user is the only recipient', () => {
    const message = {
      sender_email: 'boss@example.com',
      to_people: [{ display: 'User Name', email: 'user@example.com' }],
      cc_people: [],
    };

    expect(collectOtherMailRecipients(message, me)).toEqual([]);
    expect(shouldDefaultToReplyAll({ message, mailboxEmails: me })).toBe(false);
    expect(getDefaultMailReplyMode({ message, mailboxEmails: me })).toBe('reply');
    expect(getMailQuickReplyPlaceholder('reply')).toBe('Ответить на письмо…');
  });

  it('defaults to reply all when To or Cc includes other people', () => {
    const message = {
      sender_email: 'boss@example.com',
      to_people: [
        { display: 'User Name', email: 'user@example.com' },
        { display: 'Иванов Сергей', email: 'ivanov@company.ru' },
        { display: 'Петрова Анна', email: 'petrova@company.ru' },
      ],
      cc_people: [],
    };

    expect(shouldDefaultToReplyAll({ message, mailboxEmails: me })).toBe(true);
    expect(getDefaultMailReplyMode({ message, mailboxEmails: me })).toBe('reply_all');
    expect(getMailQuickReplyPlaceholder('reply_all')).toBe('Ответить всем…');
  });

  it('treats a copy recipient as enough to default to reply all', () => {
    const message = {
      sender_email: 'boss@example.com',
      to_people: [{ display: 'User Name', email: 'user@example.com' }],
      cc_people: [{ display: 'Copy Person', email: 'cc@example.com' }],
    };

    expect(shouldDefaultToReplyAll({ message, mailboxEmails: me })).toBe(true);
  });

  it('defaults to reply all only when a thread has more than one other participant', () => {
    const senderAndSelf = [
      { display: 'Boss', email: 'boss@example.com' },
      { display: 'Me', email: 'user@example.com' },
    ];
    const withColleague = [
      ...senderAndSelf,
      { display: 'Иванов Сергей', email: 'ivanov@company.ru' },
    ];

    expect(shouldDefaultToReplyAll({
      message: { to_people: [] },
      mailboxEmails: me,
      conversationParticipants: senderAndSelf,
    })).toBe(false);
    expect(shouldDefaultToReplyAll({
      message: { to_people: [] },
      mailboxEmails: me,
      conversationParticipants: withColleague,
    })).toBe(true);
  });

  it('uses conversation participants only in conversations view', () => {
    const message = {
      sender_email: 'boss@example.com',
      to_people: [{ display: 'User Name', email: 'user@example.com' }],
      cc_people: [],
    };
    const selectedConversation = {
      participant_people: [
        { display: 'Boss', email: 'boss@example.com' },
        { display: 'Me', email: 'user@example.com' },
        { display: 'Иванов Сергей', email: 'ivanov@company.ru' },
      ],
    };

    expect(getMailSelectedReplyMode({
      message,
      mailboxEmails: me,
      selectedConversation,
      viewMode: 'messages',
    })).toBe('reply');
    expect(getMailSelectedReplyMode({
      message,
      mailboxEmails: me,
      selectedConversation,
      viewMode: 'conversations',
    })).toBe('reply_all');
  });
});
