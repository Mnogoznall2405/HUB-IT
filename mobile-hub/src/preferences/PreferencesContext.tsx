import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
} from 'react';
import { AppState } from 'react-native';
import * as settingsApi from '../api/settingsApi';
import { useAuth } from '../auth/AuthContext';
import { cachePreferences, readCachedPreferences, readPendingPreferences, writePendingPreferences } from './preferenceCache';
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
  const { user, offlineMode } = useAuth();
  const userId = Number(user?.id || 0);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const preferencesRef = useRef(preferences);
  const epoch = useRef(0);
  const revision = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const networkQueue = useRef<Promise<unknown>>(Promise.resolve());
  const onlineRef = useRef(!offlineMode);
  onlineRef.current = !offlineMode;
  const apply = useCallback((value: UserPreferences) => {
    preferencesRef.current = value;
    setPreferences(value);
  }, []);
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.current.catch(() => undefined).then(operation);
    queue.current = result;
    return result;
  }, []);

  const refreshPreferences = useCallback(async () => {
    const generation = epoch.current;
    const version = revision.current;
    const sync = networkQueue.current.catch(() => undefined).then(async () => {
      if (!userId || !onlineRef.current || generation !== epoch.current) return;
      try {
        const pending = await enqueue(() => readPendingPreferences(userId));
        if (generation !== epoch.current || !onlineRef.current) return;
        const hasPending = Object.keys(pending).length > 0;
        const next = hasPending ? await settingsApi.updateMySettings(pending) : await settingsApi.getMySettings();
        if (generation !== epoch.current) return;
        await enqueue(async () => {
          if (generation !== epoch.current) return;
          const latest = await readPendingPreferences(userId);
          if (JSON.stringify(latest) !== JSON.stringify(pending)) return;
          if (hasPending) await writePendingPreferences(userId, {});
          if (version === revision.current) {
            apply(next);
            await cachePreferences(next, userId);
          }
        });
      } catch {
        // Keep durable local changes for the next reconnect or foreground retry.
      } finally {
        if (generation === epoch.current) setLoading(false);
      }
    });
    networkQueue.current = sync;
    await sync;
  }, [apply, enqueue, userId]);

  useEffect(() => {
    const generation = ++epoch.current;
    revision.current += 1;
    const version = revision.current;
    setLoading(true);
    void enqueue(async () => {
      const cached = await readCachedPreferences(userId || undefined);
      const pending = userId ? await readPendingPreferences(userId) : {};
      if (generation !== epoch.current || version !== revision.current) return;
      apply(normalizePreferencePayload({ ...cached, ...pending }));
      setLoading(false);
    }).catch(() => { if (generation === epoch.current) setLoading(false); });
    return () => { epoch.current += 1; };
  }, [apply, enqueue, refreshPreferences, userId]);

  useEffect(() => {
    if (!offlineMode) void refreshPreferences();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && onlineRef.current) void refreshPreferences();
    });
    return () => subscription.remove();
  }, [offlineMode, refreshPreferences]);

  const savePreferences = useCallback(async (patch: Partial<UserPreferences>) => {
    const generation = epoch.current;
    const version = ++revision.current;
    const previous = preferencesRef.current;
    const optimistic = normalizePreferencePayload({
      ...previous, ...patch,
      ...(patch.dashboard_sections !== undefined
        ? { dashboard_sections: normalizeDashboardSections(patch.dashboard_sections), dashboard_mobile_sections: undefined } : {}),
      ...(patch.mobile_bottom_nav_items !== undefined
        ? { mobile_bottom_nav_items: normalizeMobileBottomNavItems(patch.mobile_bottom_nav_items) } : {}),
    });
    apply(optimistic);
    try {
      await enqueue(async () => {
        if (generation !== epoch.current) return;
        if (userId) {
          const pending = await readPendingPreferences(userId);
          if (generation !== epoch.current) return;
          await writePendingPreferences(userId, { ...pending, ...patch });
        }
        await cachePreferences(optimistic, userId || undefined);
      });
    } catch (error) {
      if (generation === epoch.current && version === revision.current) apply(previous);
      throw error;
    }
    if (generation === epoch.current && onlineRef.current) void refreshPreferences();
    return optimistic;
  }, [apply, enqueue, refreshPreferences, userId]);

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
