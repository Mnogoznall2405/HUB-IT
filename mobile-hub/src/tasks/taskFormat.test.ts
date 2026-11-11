import {
  normalizeDueDate,
  taskDiscussionConversationId,
  taskPerson,
  taskPriorityLabel,
  todayProtocolDate,
} from './taskFormat';

describe('taskFormat', () => {
  it('normalizes a valid due date without depending on the machine timezone', () => {
    expect(normalizeDueDate('2026-08-31')).toBe('2026-08-31T18:00:00');
    expect(normalizeDueDate('')).toBeNull();
    expect(() => normalizeDueDate('2026-02-31')).toThrow('существующую дату');
    expect(() => normalizeDueDate('31.08.2026')).toThrow('ГГГГ-ММ-ДД');
  });

  it('formats stable task defaults and discussion identifiers', () => {
    expect(todayProtocolDate(new Date('2026-08-24T12:00:00Z'))).toBe('2026-08-24');
    expect(taskPriorityLabel('urgent')).toBe('Срочный');
    expect(taskDiscussionConversationId({ conversation_id: 'chat-1' })).toBe('chat-1');
    expect(taskDiscussionConversationId({ conversation: { id: 'chat-2' } })).toBe('chat-2');
  });

  it('formats every assignee of a shared task', () => {
    expect(taskPerson({
      id: 'task-1',
      assignees: [
        { user_id: 7, full_name: 'Иван Петров' },
        { user_id: 8, full_name: 'Анна Смирнова' },
      ],
    }, 'assignee')).toBe('Иван Петров, Анна Смирнова');
  });
});
