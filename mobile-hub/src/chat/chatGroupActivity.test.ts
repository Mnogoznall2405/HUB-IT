import { buildInviteLink, describeGroupActivity } from './chatGroupActivity';

describe('chat group activity', () => {
  it('describes role and profile changes without exposing text', () => {
    expect(describeGroupActivity({
      id: '1', action: 'role_changed', target_name: 'Анна', details: { role: 'moderator' },
    })).toBe('изменил(а) роль: Анна (модератор)');
    expect(describeGroupActivity({
      id: '2', action: 'profile_updated', details: { fields: ['title', 'posting_policy'] },
    })).toBe('изменил(а) профиль группы: название, правила отправки');
  });

  it('builds the web invite link from the portal origin', () => {
    expect(buildInviteLink('https://hub.example/', 'a b')).toBe('https://hub.example/chat?join=a%20b');
  });
});
