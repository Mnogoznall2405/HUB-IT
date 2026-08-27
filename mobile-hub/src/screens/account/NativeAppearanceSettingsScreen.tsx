import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  DEFAULT_MOBILE_BOTTOM_NAV_ITEMS,
  normalizeMobileBottomNavItems,
  type ThemeMode,
} from '../../preferences/preferenceNormalizers';
import { getVisibleNavigationItems } from '../../navigation/mobileNavItems';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { formatApiError } from '../../api/formatError';
import {
  AccountPrimaryButton,
  AccountScreenScaffold,
  AccountSecondaryButton,
  AccountSectionCard,
  AccountStatusText,
} from './AccountChrome';
import { goBackOrReplace } from './accountBack';

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'system', label: 'Как в системе' },
];

export function NativeAppearanceSettingsScreen() {
  const { user, hasPermission } = useAuth();
  const { preferences, savePreferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const availableItems = useMemo(
    () => getVisibleNavigationItems({ user, hasPermission }),
    [hasPermission, user],
  );
  const availablePathSet = useMemo(
    () => new Set(availableItems.map((item) => item.path)),
    [availableItems],
  );
  const [selectedPaths, setSelectedPaths] = useState(() => (
    normalizeMobileBottomNavItems(preferences.mobile_bottom_nav_items)
      .filter((path) => availablePathSet.has(path))
  ));
  const [status, setStatus] = useState({ error: '', message: '' });
  const [savingNav, setSavingNav] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  useEffect(() => {
    setSelectedPaths((current) => {
      const next = current.filter((path) => availablePathSet.has(path));
      return next.length === current.length ? current : next;
    });
  }, [availablePathSet]);

  const saveTheme = useCallback(async (themeMode: ThemeMode) => {
    try {
      await savePreferences({ theme_mode: themeMode });
      setStatus({ error: '', message: 'Тема сохранена.' });
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось сохранить тему.'), message: '' });
    }
  }, [savePreferences]);

  const togglePath = useCallback((path: string) => {
    setSelectedPaths((current) => {
      if (current.includes(path)) return current.filter((item) => item !== path);
      if (current.length >= 4) return current;
      return [...current, path];
    });
  }, []);

  const saveNav = useCallback(async () => {
    const next = normalizeMobileBottomNavItems(selectedPaths);
    if (next.length === 0) {
      setStatus({ error: 'Выберите хотя бы один пункт нижнего меню.', message: '' });
      return;
    }
    setSavingNav(true);
    try {
      await savePreferences({ mobile_bottom_nav_items: next });
      setSelectedPaths(next);
      setStatus({ error: '', message: 'Нижнее меню сохранено.' });
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось сохранить нижнее меню.'), message: '' });
    } finally {
      setSavingNav(false);
    }
  }, [savePreferences, selectedPaths]);

  return (
    <AccountScreenScaffold
      title="Внешний вид"
      tokens={tokens}
      onBack={() => goBackOrReplace('/(shell)/menu/settings')}
    >
      <AccountStatusText tokens={tokens} error={status.error} message={status.message} />
      <AccountSectionCard tokens={tokens} title="Тема" description="Выберите тему нативного приложения.">
        {THEME_OPTIONS.map((option) => {
          const selected = preferences.theme_mode === option.value;
          return (
            <Pressable
              key={option.value}
              testID={`native-theme-${option.value}`}
              onPress={() => { void saveTheme(option.value); }}
              style={[
                styles.choice,
                {
                  borderColor: selected ? tokens.selectedBorder : tokens.borderSoft,
                  backgroundColor: selected ? tokens.selected : tokens.actionBg,
                },
              ]}
            >
              <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </AccountSectionCard>
      <AccountSectionCard
        tokens={tokens}
        title="Нижнее меню"
        description="Выберите до четырёх нативных разделов. Пункт «Меню» добавляется автоматически."
      >
        <Text style={{ color: tokens.textSecondary, marginBottom: 8, fontWeight: '700' }}>
          Выбрано {selectedPaths.length} из {Math.min(4, availableItems.length)}
        </Text>
        <View style={styles.grid}>
          {availableItems.map((item) => {
            const selected = selectedSet.has(item.path);
            const disabled = !selected && selectedPaths.length >= 4;
            return (
              <Pressable
                key={item.path}
                testID={`native-nav-item-${item.path.replace(/^\//, '')}`}
                onPress={() => togglePath(item.path)}
                disabled={disabled}
                style={[
                  styles.navChip,
                  {
                    opacity: disabled ? 0.45 : 1,
                    borderColor: selected ? tokens.selectedBorder : tokens.borderSoft,
                    backgroundColor: selected ? tokens.selected : tokens.actionBg,
                  },
                ]}
              >
                <Text style={{ color: tokens.textPrimary, fontWeight: '800', textAlign: 'center' }}>
                  {item.shortLabel || item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.actions}>
          <AccountSecondaryButton
            tokens={tokens}
            label="По умолчанию"
            onPress={() => setSelectedPaths(
              DEFAULT_MOBILE_BOTTOM_NAV_ITEMS.filter((path) => availablePathSet.has(path)),
            )}
          />
          <AccountPrimaryButton
            tokens={tokens}
            label={savingNav ? 'Сохранение…' : 'Сохранить меню'}
            disabled={savingNav || selectedPaths.length === 0}
            onPress={() => { void saveNav(); }}
          />
        </View>
      </AccountSectionCard>
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  choice: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  navChip: {
    width: '48%',
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  actions: { marginTop: 12, gap: 8 },
});
