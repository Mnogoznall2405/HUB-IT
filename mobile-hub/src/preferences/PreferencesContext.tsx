import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as settingsApi from '../api/settingsApi';
import { useAuth } from '../auth/AuthContext';
import { cachePreferences, readCachedPreferences } from './preferenceCache';
import {
  DEFAULT_PREFERENCES,
  normalizeDashboardSections,
  normalizeMobileBottomNavItems,
  normalizePreferencePayload,
  type UserPreferences,
} from './preferenceNormalizers';

type PreferencesContextValue = {
  preferences: UserPreferences;
  loading: boolean;
  refreshPreferences: () => Promise<void>;
  savePreferences: (patch: Partial<UserPreferences>) => Promise<UserPreferences>;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void readCachedPreferences().then((cached) => {
      if (active) setPreferences(cached);
    });
    return () => {
      active = false;
    };
  }, []);

  const refreshPreferences = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await settingsApi.getMySettings();
      setPreferences(next);
      await cachePreferences(next);
    } catch {
      // Keep cached values when the network is unavailable.
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshPreferences();
  }, [refreshPreferences]);

  const savePreferences = useCallback(async (patch: Partial<UserPreferences>) => {
    const previous = preferences;
    const optimistic = normalizePreferencePayload({
      ...previous,
      ...patch,
      ...(patch.dashboard_sections !== undefined
        ? {
          dashboard_sections: normalizeDashboardSections(patch.dashboard_sections),
          dashboard_mobile_sections: undefined,
        }
        : {}),
      ...(patch.mobile_bottom_nav_items !== undefined
        ? { mobile_bottom_nav_items: normalizeMobileBottomNavItems(patch.mobile_bottom_nav_items) }
        : {}),
    });
    setPreferences(optimistic);
    await cachePreferences(optimistic);
    try {
      const saved = await settingsApi.updateMySettings(patch);
      setPreferences(saved);
      await cachePreferences(saved);
      return saved;
    } catch (error) {
      setPreferences(previous);
      await cachePreferences(previous);
      throw error;
    }
  }, [preferences]);

  const value = useMemo(
    () => ({ preferences, loading, refreshPreferences, savePreferences }),
    [loading, preferences, refreshPreferences, savePreferences],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);
  if (!value) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }
  return value;
}
