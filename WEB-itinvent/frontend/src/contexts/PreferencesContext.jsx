import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { alpha, createTheme } from '@mui/material/styles';
import { settingsAPI } from '../api/client';

const PreferencesContext = createContext(null);
const CACHE_KEY = 'web_preferences_cache';
export const DASHBOARD_MOBILE_SECTION_KEYS = ['urgent', 'announcements', 'tasks'];
export const DEFAULT_DASHBOARD_MOBILE_SECTIONS = ['urgent', 'announcements', 'tasks'];

const DEFAULT_PREFERENCES = {
  pinned_database: null,
  theme_mode: 'light',
  font_family: 'Segoe UI',
  font_scale: 1.0,
  dashboard_mobile_sections: DEFAULT_DASHBOARD_MOBILE_SECTIONS,
};

const FONT_MAP = {
  Inter: '"Inter", "Segoe UI", "Roboto", sans-serif',
  Roboto: '"Roboto", "Segoe UI", Arial, sans-serif',
  'Segoe UI': '"Segoe UI", "Roboto", Arial, sans-serif',
};

export function normalizeDashboardMobileSections(value) {
  const source = Array.isArray(value) ? value : [];
  const result = [];
  source.forEach((item) => {
    const token = String(item || '').trim().toLowerCase();
    if (DASHBOARD_MOBILE_SECTION_KEYS.includes(token) && !result.includes(token)) {
      result.push(token);
    }
  });
  return result.length ? result : [...DEFAULT_DASHBOARD_MOBILE_SECTIONS];
}

function readCachedPreferences() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      dashboard_mobile_sections: normalizeDashboardMobileSections(parsed?.dashboard_mobile_sections),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function cachePreferences(value) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(value));
}

function syncSelectedDatabase(databaseId) {
  if (databaseId) {
    localStorage.setItem('selected_database', databaseId);
    return;
  }
  localStorage.removeItem('selected_database');
}

export function PreferencesProvider({ children }) {
  const [preferences, setPreferences] = useState(() => readCachedPreferences());
  const [loading, setLoading] = useState(false);

  const refreshFromServer = useCallback(async () => {
    const hasUser = !!localStorage.getItem('user');
    if (!hasUser) return;
    setLoading(true);
    try {
      const data = await settingsAPI.getMySettings({ suppressAuthRequired: true });
      const next = {
        ...DEFAULT_PREFERENCES,
        ...data,
        dashboard_mobile_sections: normalizeDashboardMobileSections(data?.dashboard_mobile_sections),
      };
      setPreferences(next);
      cachePreferences(next);
      syncSelectedDatabase(next.pinned_database);
    } catch (error) {
      console.error('Failed to load preferences:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let timeoutId = null;

    const scheduleRefresh = () => {
      const pathname = typeof window !== 'undefined'
        ? String(window.location?.pathname || '').trim()
        : '';
      if (pathname.startsWith('/chat')) {
        timeoutId = window.setTimeout(() => {
          void refreshFromServer();
        }, 3500);
        return;
      }
      void refreshFromServer();
    };

    scheduleRefresh();
    const authChanged = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      scheduleRefresh();
    };
    window.addEventListener('auth-changed', authChanged);
    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener('auth-changed', authChanged);
    };
  }, [refreshFromServer]);

  const savePreferences = useCallback(async (patch) => {
    const previousPreferences = preferences;
    const normalizedPatch = {
      ...patch,
      ...(patch?.dashboard_mobile_sections !== undefined
        ? { dashboard_mobile_sections: normalizeDashboardMobileSections(patch.dashboard_mobile_sections) }
        : {}),
    };
    const optimistic = { ...preferences, ...normalizedPatch };
    setPreferences(optimistic);
    cachePreferences(optimistic);

    if (normalizedPatch.pinned_database !== undefined) {
      syncSelectedDatabase(normalizedPatch.pinned_database);
    }

    try {
      const saved = await settingsAPI.updateMySettings(normalizedPatch);
      const next = {
        ...DEFAULT_PREFERENCES,
        ...saved,
        dashboard_mobile_sections: normalizeDashboardMobileSections(saved?.dashboard_mobile_sections),
      };
      setPreferences(next);
      cachePreferences(next);
      if (normalizedPatch.pinned_database !== undefined) {
        syncSelectedDatabase(next.pinned_database);
      }
      return next;
    } catch (error) {
      console.error('Failed to save preferences:', error);
      setPreferences(previousPreferences);
      cachePreferences(previousPreferences);
      if (normalizedPatch.pinned_database !== undefined) {
        syncSelectedDatabase(previousPreferences.pinned_database);
      }
      throw error;
    }
  }, [preferences]);

  const theme = useMemo(() => {
    const mode = preferences.theme_mode === 'dark' ? 'dark' : 'light';
    const fontScale = Math.min(1.2, Math.max(0.9, Number(preferences.font_scale || 1)));
    const fontFamily = FONT_MAP[preferences.font_family] || FONT_MAP['Segoe UI'];
    const isDark = mode === 'dark';
    const customAdmin = isDark
      ? {
        pageBg: '#0f1115',
        shellBg: '#11151b',
        navBg: '#171a1f',
        panelBg: '#171a1f',
        panelMuted: '#1b1f26',
        panelInset: '#262b31',
        surfaceRaised: '#1f2329',
        borderSoft: 'rgba(255, 255, 255, 0.08)',
        border: 'rgba(255, 255, 255, 0.12)',
        borderStrong: 'rgba(255, 255, 255, 0.18)',
        accent: '#0f6cbd',
        accentSoft: 'rgba(15, 108, 189, 0.18)',
        hover: 'rgba(255, 255, 255, 0.06)',
        selected: 'rgba(15, 108, 189, 0.20)',
        selectedBorder: 'rgba(102, 179, 255, 0.30)',
        actionBg: 'rgba(255, 255, 255, 0.04)',
        actionBorder: 'rgba(255, 255, 255, 0.12)',
        actionHover: 'rgba(255, 255, 255, 0.08)',
        iconPrimary: '#f3f2f1',
        iconMuted: '#d2d0ce',
        textSecondary: '#c8c6c4',
        textTertiary: '#a19f9d',
        headerBandBg: '#1b1f26',
        headerBandBorder: 'rgba(255, 255, 255, 0.08)',
        emptyStateBg: 'rgba(255, 255, 255, 0.025)',
        shadow: '0 24px 64px rgba(0, 0, 0, 0.34)',
        shadowSoft: '0 8px 24px rgba(0, 0, 0, 0.20)',
        contentMaxWidth: 2040,
      }
      : {
        pageBg: '#f3f2f1',
        shellBg: '#faf9f8',
        navBg: '#ffffff',
        panelBg: '#ffffff',
        panelMuted: '#f7f6f5',
        panelInset: '#f3f2f1',
        surfaceRaised: '#ffffff',
        borderSoft: 'rgba(32, 31, 30, 0.08)',
        border: 'rgba(32, 31, 30, 0.12)',
        borderStrong: 'rgba(32, 31, 30, 0.16)',
        accent: '#0f6cbd',
        accentSoft: 'rgba(15, 108, 189, 0.10)',
        hover: 'rgba(32, 31, 30, 0.04)',
        selected: 'rgba(15, 108, 189, 0.10)',
        selectedBorder: 'rgba(15, 108, 189, 0.18)',
        actionBg: '#f7f6f5',
        actionBorder: 'rgba(32, 31, 30, 0.10)',
        actionHover: '#f3f2f1',
        iconPrimary: '#201f1e',
        iconMuted: '#605e5c',
        textSecondary: '#605e5c',
        textTertiary: '#8a8886',
        headerBandBg: '#f7f6f5',
        headerBandBorder: 'rgba(32, 31, 30, 0.08)',
        emptyStateBg: '#f8f7f6',
        shadow: '0 16px 40px rgba(32, 31, 30, 0.10)',
        shadowSoft: '0 10px 28px rgba(32, 31, 30, 0.06)',
        contentMaxWidth: 2040,
      };

    return createTheme({
      palette: {
        mode,
        primary: {
          main: '#0f6cbd',
          light: '#479ef5',
          dark: '#115ea3',
          contrastText: '#ffffff',
        },
        secondary: {
          main: '#038387',
          light: '#00b7c3',
          dark: '#02666d',
          contrastText: '#ffffff',
        },
        background: isDark
          ? { default: customAdmin.pageBg, paper: customAdmin.panelBg }
          : { default: customAdmin.pageBg, paper: customAdmin.panelBg },
        text: isDark
          ? {
            primary: '#f3f2f1',
            secondary: '#c8c6c4',
            disabled: 'rgba(200, 198, 196, 0.62)',
          }
          : {
            primary: '#201f1e',
            secondary: '#605e5c',
            disabled: 'rgba(96, 94, 92, 0.55)',
          },
        divider: customAdmin.border,
        action: {
          hover: customAdmin.hover,
          selected: customAdmin.selected,
          active: customAdmin.accentSoft,
          disabledBackground: isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(32, 31, 30, 0.08)',
        },
        error: { main: isDark ? '#ff99a4' : '#c50f1f' },
        warning: { main: isDark ? '#ffb900' : '#8e562e' },
        success: { main: isDark ? '#6ccb5f' : '#107c10' },
      },
      customAdmin,
      typography: {
        fontFamily,
        fontSize: Math.round(14 * fontScale),
      },
      shape: {
        borderRadius: 12,
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            ':root': {
              '--app-page-bg': customAdmin.pageBg,
              '--app-surface-raised': customAdmin.surfaceRaised,
              '--app-surface-muted': customAdmin.panelMuted,
              '--app-border-soft': customAdmin.borderSoft,
              '--app-action-bg': customAdmin.actionBg,
              '--app-action-hover': customAdmin.actionHover,
              '--app-header-band-bg': customAdmin.headerBandBg,
              '--app-shadow-soft': customAdmin.shadowSoft,
              '--app-skeleton-base': isDark ? 'rgba(255,255,255,0.05)' : 'rgba(32,31,30,0.05)',
              '--app-skeleton-highlight': isDark ? 'rgba(255,255,255,0.10)' : 'rgba(32,31,30,0.09)',
            },
            body: {
              backgroundImage: 'none',
            },
            '::selection': {
              backgroundColor: alpha('#0f6cbd', isDark ? 0.36 : 0.18),
            },
            '*::-webkit-scrollbar': {
              width: 10,
              height: 10,
            },
            '*::-webkit-scrollbar-thumb': {
              borderRadius: 999,
              border: `2px solid ${customAdmin.pageBg}`,
              backgroundColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(32,31,30,0.14)',
            },
            '*::-webkit-scrollbar-track': {
              backgroundColor: 'transparent',
            },
          },
        },
        MuiPaper: {
          styleOverrides: {
            root: ({ theme, ownerState }) => ({
              backgroundImage: 'none',
              borderColor: theme.customAdmin.borderSoft,
              ...(ownerState.variant === 'outlined'
                ? {
                  backgroundColor: theme.customAdmin.surfaceRaised,
                  border: `1px solid ${theme.customAdmin.borderSoft}`,
                  boxShadow: theme.customAdmin.shadowSoft,
                  borderRadius: 14,
                }
                : {}),
            }),
          },
        },
        MuiCard: {
          styleOverrides: {
            root: ({ theme }) => ({
              backgroundImage: 'none',
              border: `1px solid ${theme.customAdmin.borderSoft}`,
              boxShadow: theme.customAdmin.shadowSoft,
              borderRadius: 16,
            }),
          },
        },
        MuiButton: {
          styleOverrides: {
            root: ({ theme }) => ({
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: 10,
              boxShadow: 'none',
              '&.MuiButton-contained': {
                boxShadow: 'none',
                backgroundImage: 'none',
                '&:hover': {
                  boxShadow: 'none',
                },
              },
              '&.MuiButton-outlined': {
                borderColor: theme.customAdmin.actionBorder,
                backgroundColor: theme.customAdmin.actionBg,
                color: theme.palette.text.primary,
                '&:hover': {
                  borderColor: theme.customAdmin.borderStrong,
                  backgroundColor: theme.customAdmin.actionHover,
                },
              },
              '&.MuiButton-outlinedPrimary': {
                borderColor: theme.customAdmin.selectedBorder,
                backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.08),
                color: theme.palette.primary.main,
                '&:hover': {
                  borderColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.42 : 0.28),
                  backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.12),
                },
              },
              '&.MuiButton-outlinedError': {
                borderColor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.34 : 0.24),
                backgroundColor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.14 : 0.08),
                color: theme.palette.error.main,
                '&:hover': {
                  borderColor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.48 : 0.32),
                  backgroundColor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.20 : 0.12),
                },
              },
              '&.MuiButton-outlinedWarning': {
                borderColor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.34 : 0.24),
                backgroundColor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.14 : 0.08),
                color: theme.palette.warning.main,
                '&:hover': {
                  borderColor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.48 : 0.32),
                  backgroundColor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.20 : 0.12),
                },
              },
              '&.MuiButton-outlinedSuccess': {
                borderColor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.34 : 0.24),
                backgroundColor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.14 : 0.08),
                color: theme.palette.success.main,
                '&:hover': {
                  borderColor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.48 : 0.32),
                  backgroundColor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.20 : 0.12),
                },
              },
              '&.MuiButton-text': {
                color: theme.palette.text.primary,
                '&:hover': {
                  backgroundColor: theme.customAdmin.hover,
                },
              },
            }),
          },
        },
        MuiIconButton: {
          styleOverrides: {
            root: ({ theme }) => ({
              color: theme.customAdmin.iconPrimary,
              borderRadius: 10,
              transition: theme.transitions.create(['background-color', 'border-color', 'color'], {
                duration: theme.transitions.duration.shorter,
              }),
              '&:hover': {
                backgroundColor: theme.customAdmin.actionHover,
              },
            }),
          },
        },
        MuiOutlinedInput: {
          styleOverrides: {
            root: ({ theme }) => ({
              borderRadius: 10,
              backgroundColor: theme.customAdmin.panelMuted,
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: theme.customAdmin.actionBorder,
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: theme.customAdmin.borderStrong,
              },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: theme.palette.primary.main,
                borderWidth: 1,
              },
            }),
          },
        },
        MuiChip: {
          styleOverrides: {
            root: ({ theme, ownerState }) => {
              const variant = ownerState.variant || 'filled';
              const colorKey = ownerState.color || 'default';
              const palette = colorKey !== 'default' ? theme.palette[colorKey] : null;
              const toneColor = palette
                ? (theme.palette.mode === 'dark' ? palette.main : (palette.dark || palette.main))
                : theme.palette.text.primary;
              const toneBg = palette
                ? alpha(palette.main, theme.palette.mode === 'dark' ? (variant === 'outlined' ? 0.14 : 0.18) : (variant === 'outlined' ? 0.08 : 0.12))
                : theme.customAdmin.actionBg;
              const toneBorder = palette
                ? alpha(palette.main, theme.palette.mode === 'dark' ? 0.34 : 0.22)
                : theme.customAdmin.actionBorder;

              return {
                borderRadius: 999,
                fontWeight: 600,
                color: toneColor,
                backgroundColor: toneBg,
                border: `1px solid ${toneBorder}`,
                '& .MuiChip-label': {
                  color: 'inherit',
                },
                '& .MuiChip-icon, & .MuiChip-deleteIcon': {
                  color: 'inherit',
                },
              };
            },
          },
        },
        MuiTabs: {
          styleOverrides: {
            indicator: ({ theme }) => ({
              height: 2,
              borderRadius: 999,
              backgroundColor: theme.palette.primary.main,
            }),
          },
        },
        MuiTab: {
          styleOverrides: {
            root: ({ theme }) => ({
              textTransform: 'none',
              fontWeight: 600,
              color: theme.palette.text.secondary,
              '&.Mui-selected': {
                color: theme.palette.text.primary,
              },
            }),
          },
        },
        MuiDrawer: {
          styleOverrides: {
            paper: ({ theme }) => ({
              backgroundImage: 'none',
              backgroundColor: theme.customAdmin.surfaceRaised,
              borderColor: theme.customAdmin.borderSoft,
              boxShadow: theme.customAdmin.shadow,
            }),
          },
        },
        MuiAppBar: {
          styleOverrides: {
            root: ({ theme }) => ({
              backgroundImage: 'none',
              boxShadow: 'none',
            }),
          },
        },
        MuiDialog: {
          styleOverrides: {
            paper: ({ theme }) => ({
              backgroundImage: 'none',
              backgroundColor: theme.customAdmin.surfaceRaised,
              border: `1px solid ${theme.customAdmin.borderSoft}`,
              boxShadow: theme.customAdmin.shadow,
            }),
          },
        },
        MuiDialogTitle: {
          styleOverrides: {
            root: ({ theme }) => ({
              padding: '16px 20px',
              borderBottom: `1px solid ${theme.customAdmin.borderSoft}`,
              backgroundColor: theme.customAdmin.headerBandBg,
              fontWeight: 700,
            }),
          },
        },
        MuiDialogContent: {
          styleOverrides: {
            root: ({ theme }) => ({
              padding: '20px',
              backgroundColor: theme.customAdmin.surfaceRaised,
            }),
            dividers: ({ theme }) => ({
              borderTop: `1px solid ${theme.customAdmin.borderSoft}`,
              borderBottom: `1px solid ${theme.customAdmin.borderSoft}`,
            }),
          },
        },
        MuiDialogActions: {
          styleOverrides: {
            root: ({ theme }) => ({
              padding: '14px 20px',
              borderTop: `1px solid ${theme.customAdmin.borderSoft}`,
              backgroundColor: theme.customAdmin.headerBandBg,
            }),
          },
        },
        MuiMenu: {
          styleOverrides: {
            paper: ({ theme }) => ({
              backgroundImage: 'none',
              backgroundColor: theme.customAdmin.surfaceRaised,
              border: `1px solid ${theme.customAdmin.borderSoft}`,
              boxShadow: theme.customAdmin.shadow,
            }),
          },
        },
        MuiMenuItem: {
          styleOverrides: {
            root: ({ theme }) => ({
              borderRadius: 8,
              margin: '2px 6px',
              '&:hover': {
                backgroundColor: theme.customAdmin.hover,
              },
              '&.Mui-selected': {
                backgroundColor: theme.customAdmin.selected,
              },
              '&.Mui-selected:hover': {
                backgroundColor: theme.customAdmin.selected,
              },
            }),
          },
        },
        MuiListItemButton: {
          styleOverrides: {
            root: ({ theme }) => ({
              borderRadius: 10,
              '&:hover': {
                backgroundColor: theme.customAdmin.hover,
              },
              '&.Mui-selected': {
                backgroundColor: theme.customAdmin.selected,
              },
              '&.Mui-selected:hover': {
                backgroundColor: theme.customAdmin.selected,
              },
            }),
          },
        },
        MuiListItemIcon: {
          styleOverrides: {
            root: ({ theme }) => ({
              color: theme.customAdmin.iconMuted,
            }),
          },
        },
        MuiAccordion: {
          styleOverrides: {
            root: ({ theme }) => ({
              backgroundImage: 'none',
              backgroundColor: theme.customAdmin.surfaceRaised,
              border: `1px solid ${theme.customAdmin.borderSoft}`,
              boxShadow: theme.customAdmin.shadowSoft,
              '&:before': {
                display: 'none',
              },
            }),
          },
        },
        MuiAccordionSummary: {
          styleOverrides: {
            root: ({ theme }) => ({
              minHeight: 46,
              paddingLeft: 16,
              paddingRight: 16,
              backgroundColor: theme.customAdmin.headerBandBg,
              borderBottom: `1px solid ${theme.customAdmin.borderSoft}`,
              '&.Mui-expanded': {
                minHeight: 46,
              },
              '& .MuiAccordionSummary-content': {
                marginTop: 10,
                marginBottom: 10,
              },
              '& .MuiAccordionSummary-content.Mui-expanded': {
                marginTop: 10,
                marginBottom: 10,
              },
            }),
          },
        },
        MuiAccordionDetails: {
          styleOverrides: {
            root: ({ theme }) => ({
              padding: 16,
              backgroundColor: theme.customAdmin.surfaceRaised,
            }),
          },
        },
        MuiAlert: {
          styleOverrides: {
            root: ({ theme }) => ({
              borderRadius: 12,
              border: `1px solid ${theme.customAdmin.borderSoft}`,
            }),
            standardInfo: ({ theme }) => ({
              backgroundColor: isDark ? 'rgba(15,108,189,0.12)' : 'rgba(15,108,189,0.08)',
            }),
            standardWarning: ({ theme }) => ({
              backgroundColor: isDark ? 'rgba(255,185,0,0.10)' : 'rgba(255,185,0,0.08)',
            }),
            standardError: ({ theme }) => ({
              backgroundColor: isDark ? 'rgba(197,15,31,0.12)' : 'rgba(197,15,31,0.08)',
            }),
            standardSuccess: ({ theme }) => ({
              backgroundColor: isDark ? 'rgba(16,124,16,0.12)' : 'rgba(16,124,16,0.08)',
            }),
          },
        },
        MuiTableContainer: {
          styleOverrides: {
            root: ({ theme }) => ({
              borderRadius: 12,
              border: `1px solid ${theme.customAdmin.borderSoft}`,
              backgroundColor: theme.customAdmin.surfaceRaised,
              boxShadow: theme.customAdmin.shadowSoft,
            }),
          },
        },
        MuiTableCell: {
          styleOverrides: {
            root: ({ theme }) => ({
              borderColor: theme.customAdmin.borderSoft,
              paddingTop: 10,
              paddingBottom: 10,
            }),
            head: ({ theme }) => ({
              fontWeight: 700,
              color: theme.palette.text.secondary,
              backgroundColor: theme.customAdmin.headerBandBg,
              borderBottomColor: theme.customAdmin.borderStrong,
            }),
          },
        },
        MuiTableRow: {
          styleOverrides: {
            root: ({ theme }) => ({
              transition: theme.transitions.create(['background-color', 'border-color'], {
                duration: theme.transitions.duration.shorter,
              }),
              '&.MuiTableRow-hover:hover': {
                backgroundColor: theme.customAdmin.hover,
              },
              '&.Mui-selected': {
                backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.14 : 0.07),
              },
              '&.Mui-selected:hover': {
                backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.10),
              },
            }),
          },
        },
        MuiDivider: {
          styleOverrides: {
            root: ({ theme }) => ({
              borderColor: theme.customAdmin.borderSoft,
            }),
          },
        },
        MuiInputLabel: {
          styleOverrides: {
            root: ({ theme }) => ({
              color: theme.palette.text.secondary,
              '&.Mui-focused': {
                color: theme.palette.primary.main,
              },
            }),
          },
        },
      },
    });
  }, [preferences.theme_mode, preferences.font_family, preferences.font_scale]);

  const value = useMemo(() => ({
    preferences,
    loading,
    savePreferences,
    refreshFromServer,
  }), [preferences, loading, savePreferences, refreshFromServer]);

  return (
    <PreferencesContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }
  return context;
}

export default PreferencesContext;
