import {
  conversationMatchesLocalQuery,
  filterConversationsByLocalQuery,
  filterMessagesByLocalQuery,
  normalizeNativeChatSearchText,
} from './nativeChatLocalSearch';
import type { ChatConversationSummary, ChatMessage } from '../api/types';

describe('nativeChatLocalSearch', () => {
  const anna: ChatConversationSummary = {
    id: 'a',
    title: 'Анна Иванова',
    last_message_preview: 'Привет',
    direct_peer: { id: 1, username: 'anna', full_name: 'Анна Иванова' },
  };
  const boris: ChatConversationSummary = {
    id: 'b',
    title: 'Борис',
    last_message_preview: 'Отчёт',
    direct_peer: { id: 2, username: 'boris', full_name: 'Борис Петров' },
  };

  it('normalizes spaces and russian case', () => {
    expect(normalizeNativeChatSearchText('  АнНа   ')).toBe('анна');
  });

  it('finds a saved dialog offline without requiring API results', () => {
    const found = filterConversationsByLocalQuery([anna, boris], 'анна');
    expect(found.map((item) => item.id)).toEqual(['a']);
    expect(conversationMatchesLocalQuery(boris, 'анна')).toBe(false);
  });

  it('clears to empty when the local corpus has no match', () => {
    expect(filterConversationsByLocalQuery([anna, boris], 'ксения')).toEqual([]);
  });

  it('searches local message bodies', () => {
    const messages: ChatMessage[] = [
      { id: '1', conversation_id: 'a', sender_user_id: 1, body_text: 'План на понедельник' },
      { id: '2', conversation_id: 'a', sender_user_id: 1, body_text: 'Другое' },
    ];
    expect(filterMessagesByLocalQuery(messages, 'понедельник').map((item) => item.id)).toEqual(['1']);
  });
});
