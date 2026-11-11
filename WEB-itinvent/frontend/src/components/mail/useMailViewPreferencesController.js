import { useCallback, useRef, useState } from 'react';
import { MAIL_PANE_DEFAULTS, clampMailPaneSize } from './mailPaneLayout';

export const DEFAULT_MAIL_PREFERENCES = {
  reading_pane: 'right',
  density: 'compact',
  show_preview_snippets: true,
  show_favorites_first: true,
  ...MAIL_PANE_DEFAULTS,
};

export const normalizeMailPreferences = (payload, defaults = DEFAULT_MAIL_PREFERENCES) => ({
  ...defaults,
  ...((payload?.preferences || payload) || {}),
});

export default function useMailViewPreferencesController({
  mailAPI,
  onError,
  onMessage,
} = {}) {
  const [mailPreferences, setMailPreferences] = useState(DEFAULT_MAIL_PREFERENCES);
  const [mailPreferencesDraft, setMailPreferencesDraft] = useState(DEFAULT_MAIL_PREFERENCES);
  const [mailPreferencesOpen, setMailPreferencesOpen] = useState(false);
  const [mailPreferencesSaving, setMailPreferencesSaving] = useState(false);
  const mailPaneSaveChainRef = useRef(Promise.resolve());

  const openMailPreferencesDialog = useCallback(() => {
    setMailPreferencesDraft(mailPreferences);
    setMailPreferencesOpen(true);
  }, [mailPreferences]);

  const closeMailPreferencesDialog = useCallback(() => {
    setMailPreferencesOpen(false);
  }, []);

  const updateMailPreferencesDraft = useCallback((key, value) => {
    setMailPreferencesDraft((previous) => ({ ...(previous || {}), [key]: value }));
  }, []);

  const handleSaveMailPreferences = useCallback(async () => {
    setMailPreferencesSaving(true);
    try {
      const data = await mailAPI.updatePreferences(mailPreferencesDraft);
      const nextValue = normalizeMailPreferences(data);
      setMailPreferences(nextValue);
      setMailPreferencesDraft(nextValue);
      setMailPreferencesOpen(false);
      onMessage?.('Настройки вида сохранены.');
    } catch (requestError) {
      onError?.(requestError?.response?.data?.detail || 'Не удалось сохранить настройки вида.');
    } finally {
      setMailPreferencesSaving(false);
    }
  }, [mailAPI, mailPreferencesDraft, onError, onMessage]);

  const persistMailPaneSize = useCallback((key, value) => {
    const normalizedValue = clampMailPaneSize(key, value);
    const patch = { [key]: normalizedValue };
    setMailPreferences((previous) => ({ ...(previous || {}), ...patch }));
    setMailPreferencesDraft((previous) => ({ ...(previous || {}), ...patch }));
    mailPaneSaveChainRef.current = mailPaneSaveChainRef.current
      .catch(() => undefined)
      .then(() => mailAPI.updatePreferences(patch))
      .catch((requestError) => {
        onError?.(requestError?.response?.data?.detail || 'Не удалось сохранить размер почтовой панели.');
      });
  }, [mailAPI, onError]);

  return {
    mailPreferences,
    setMailPreferences,
    mailPreferencesDraft,
    setMailPreferencesDraft,
    mailPreferencesOpen,
    setMailPreferencesOpen,
    mailPreferencesSaving,
    openMailPreferencesDialog,
    closeMailPreferencesDialog,
    updateMailPreferencesDraft,
    handleSaveMailPreferences,
    persistMailPaneSize,
  };
}
