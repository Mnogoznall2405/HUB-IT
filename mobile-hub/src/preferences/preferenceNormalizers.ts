export const DEFAULT_MOBILE_BOTTOM_NAV_ITEMS = ['/dashboard', '/tasks', '/chat', '/mail'];

export const MOBILE_BOTTOM_NAV_ALLOWED_PATHS = [
  '/dashboard',
  '/feed',
  '/tasks',
  '/chat',
  '/mail',
  '/docflow',
  '/address-book',
  '/company-structure',
  '/passwords',
  '/groups-access',
  '/my-files',
  '/database',
  '/mfu',
  '/computers',
  '/scan-center',
  '/warehouse-1c',
] as const;

export const DASHBOARD_SECTION_KEYS = ['attention', 'tasks', 'absences', 'communication', 'news'] as const;
export const DEFAULT_DASHBOARD_SECTIONS = ['attention', 'tasks', 'absences', 'communication', 'news'] as const;
export const DASHBOARD_MOBILE_SECTION_KEYS = ['urgent', 'announcements', 'tasks'] as const;
export const DEFAULT_DASHBOARD_MOBILE_SECTIONS = ['urgent', 'announcements', 'tasks'] as const;

export type DashboardSectionKey = (typeof DASHBOARD_SECTION_KEYS)[number];
export type ThemeMode = 'light' | 'dark' | 'system';

export type UserPreferences = {
  pinned_database: string | null;
  theme_mode: ThemeMode;
  font_family: string;
  font_scale: number;
  dashboard_sections: DashboardSectionKey[];
  dashboard_mobile_sections: string[];
  mobile_bottom_nav_items: string[];
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  pinned_database: null,
  theme_mode: 'light',
  font_family: 'Aptos',
  font_scale: 1,
  dashboard_sections: [...DEFAULT_DASHBOARD_SECTIONS],
  dashboard_mobile_sections: [...DEFAULT_DASHBOARD_MOBILE_SECTIONS],
  mobile_bottom_nav_items: [...DEFAULT_MOBILE_BOTTOM_NAV_ITEMS],
};

export function normalizeMobileBottomNavItems(
  value: unknown,
  fallback: string[] = DEFAULT_MOBILE_BOTTOM_NAV_ITEMS,
): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const result: string[] = [];
  value.forEach((item) => {
    const path = String(item || '').trim();
    if (
      (MOBILE_BOTTOM_NAV_ALLOWED_PATHS as readonly string[]).includes(path)
      && !result.includes(path)
      && result.length < 4
    ) {
      result.push(path);
    }
  });
  return result.length ? result : [...fallback];
}

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'light';
}

export function normalizeFontScale(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(1.2, Math.max(0.9, numeric));
}

export function normalizeDashboardMobileSections(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  const result: string[] = [];
  source.forEach((item) => {
    const token = String(item || '').trim().toLowerCase();
    if ((DASHBOARD_MOBILE_SECTION_KEYS as readonly string[]).includes(token) && !result.includes(token)) {
      result.push(token);
    }
  });
  return result.length ? result : [...DEFAULT_DASHBOARD_MOBILE_SECTIONS];
}

export function normalizeDashboardSections(value?: unknown, legacyValue?: unknown): DashboardSectionKey[] {
  let sourceValue = value;
  if (sourceValue === undefined || sourceValue === null) {
    if (legacyValue === undefined || legacyValue === null) {
      return [...DEFAULT_DASHBOARD_SECTIONS];
    }
    const legacyMap: Record<string, DashboardSectionKey> = {
      urgent: 'attention',
      tasks: 'tasks',
      announcements: 'news',
    };
    const mapped = normalizeDashboardMobileSections(legacyValue)
      .map((item) => legacyMap[item])
      .filter((item): item is DashboardSectionKey => Boolean(item));
    if (!mapped.includes('communication')) {
      const newsIndex = mapped.indexOf('news');
      mapped.splice(newsIndex >= 0 ? newsIndex : mapped.length, 0, 'communication');
    }
    sourceValue = mapped;
  }

  const source = Array.isArray(sourceValue) ? sourceValue : [];
  const result: DashboardSectionKey[] = ['attention'];
  source.forEach((item) => {
    const token = String(item || '').trim().toLowerCase();
    if (
      (DASHBOARD_SECTION_KEYS as readonly string[]).includes(token)
      && !result.includes(token as DashboardSectionKey)
    ) {
      result.push(token as DashboardSectionKey);
    }
  });
  return result;
}

export function dashboardSectionsToLegacy(value: unknown): string[] {
  const reverseMap: Record<string, string> = {
    attention: 'urgent',
    tasks: 'tasks',
    news: 'announcements',
  };
  const result = normalizeDashboardSections(value)
    .map((item) => reverseMap[item])
    .filter(Boolean);
  return result.length ? result : [...DEFAULT_DASHBOARD_MOBILE_SECTIONS];
}

export function normalizeDashboardLayoutSections(value?: unknown, legacyValue?: unknown): DashboardSectionKey[] {
  const normalized = normalizeDashboardSections(value, legacyValue);
  return [
    'attention',
    ...(normalized.includes('tasks') ? ['tasks' as const] : []),
    ...normalized.filter((key) => key === 'absences' || key === 'communication' || key === 'news'),
  ];
}

export function normalizePreferencePayload(value: Partial<UserPreferences> | Record<string, unknown> | null | undefined): UserPreferences {
  const dashboardSections = normalizeDashboardSections(
    value?.dashboard_sections,
    value?.dashboard_mobile_sections,
  );
  return {
    ...DEFAULT_PREFERENCES,
    ...value,
    pinned_database: value?.pinned_database == null ? null : String(value.pinned_database),
    theme_mode: normalizeThemeMode(value?.theme_mode),
    font_family: String(value?.font_family || DEFAULT_PREFERENCES.font_family),
    font_scale: normalizeFontScale(value?.font_scale),
    dashboard_sections: dashboardSections,
    dashboard_mobile_sections: dashboardSectionsToLegacy(dashboardSections),
    mobile_bottom_nav_items: normalizeMobileBottomNavItems(value?.mobile_bottom_nav_items),
  };
}
