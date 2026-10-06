import { filterNavItems, firstNavRoute } from './navItems';

describe('firstNavRoute', () => {
  it('opens the chats first for a user who can read them', () => {
    expect(firstNavRoute(filterNavItems(() => true, 'user'))).toBe('/(shell)/chat');
  });

  it('falls back to the dashboard when chats are not available', () => {
    expect(firstNavRoute(filterNavItems((permission) => permission === 'dashboard.read', 'user'))).toBe('/(shell)/dashboard');
  });
});
