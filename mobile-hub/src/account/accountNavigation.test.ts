import { getAvailableAdminSections } from './accountNavigation';

describe('getAvailableAdminSections', () => {
  it('shows only native admin sections to an admin', () => {
    const sections = getAvailableAdminSections({
      user: { role: 'admin' },
      hasPermission: () => false,
    });
    expect(sections.map((item) => item.key)).toEqual([
      'users',
      'departments',
      'sessions',
    ]);
  });

  it('hides Users without settings.users.manage', () => {
    const sections = getAvailableAdminSections({
      user: { role: 'operator' },
      hasPermission: (permission) => permission === 'departments.manage',
    });
    expect(sections.map((item) => item.key)).toEqual(['departments']);
    expect(sections.some((item) => item.key === 'users')).toBe(false);
  });
});
