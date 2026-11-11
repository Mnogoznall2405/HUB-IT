import {
  DEFAULT_DASHBOARD_SECTIONS,
  normalizeDashboardLayoutSections,
  normalizeDashboardSections,
  normalizeMobileBottomNavItems,
  normalizePreferencePayload,
  normalizeThemeMode,
} from './preferenceNormalizers';

describe('preference normalizers', () => {
  it('keeps at most four allowed bottom-nav paths', () => {
    expect(normalizeMobileBottomNavItems([
      '/dashboard',
      '/tasks',
      '/chat',
      '/mail',
      '/tickets',
    ])).toEqual(['/dashboard', '/tasks', '/chat', '/mail']);
    expect(normalizeMobileBottomNavItems(['/evil', '/dashboard'])).toEqual(['/dashboard']);
    expect(normalizeMobileBottomNavItems(['/tickets', '/networks', '/kb', '/dashboard']))
      .toEqual(['/dashboard']);
  });

  it('always keeps attention first and maps legacy mobile sections', () => {
    expect(normalizeDashboardSections(['news', 'tasks'])).toEqual(['attention', 'news', 'tasks']);
    expect(normalizeDashboardSections(undefined, ['urgent', 'announcements'])).toEqual([
      'attention',
      'communication',
      'news',
    ]);
    expect(normalizeDashboardLayoutSections(['news', 'tasks', 'absences'])).toEqual([
      'attention',
      'tasks',
      'news',
      'absences',
    ]);
  });

  it('normalizes a settings payload', () => {
    expect(normalizeThemeMode('system')).toBe('system');
    expect(normalizePreferencePayload({
      theme_mode: 'dark',
      dashboard_sections: [...DEFAULT_DASHBOARD_SECTIONS],
      mobile_bottom_nav_items: ['/database', '/kb', '/docflow'],
    }).mobile_bottom_nav_items).toEqual(['/database', '/docflow']);
  });
});
