import { filterNavItems } from './navItems';

describe('filterNavItems', () => {
  it('keeps only permitted native modules', () => {
    const allowed = new Set(['dashboard.read', 'chat.read']);
    expect(filterNavItems((permission) => allowed.has(permission), 'user').map((item) => item.name))
      .toEqual(['dashboard', 'chat']);
  });
});
