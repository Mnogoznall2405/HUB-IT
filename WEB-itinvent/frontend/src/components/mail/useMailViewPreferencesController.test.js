import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useMailViewPreferencesController, {
  DEFAULT_MAIL_PREFERENCES,
} from './useMailViewPreferencesController';

const createMailAPI = (overrides = {}) => ({
  updatePreferences: vi.fn(async (payload) => payload),
  ...overrides,
});

describe('useMailViewPreferencesController', () => {
  let mailAPI;
  let onError;
  let onMessage;

  const renderPreferencesHook = (overrides = {}) => renderHook(() => useMailViewPreferencesController({
    mailAPI,
    onError,
    onMessage,
    ...overrides,
  }));

  beforeEach(() => {
    mailAPI = createMailAPI();
    onError = vi.fn();
    onMessage = vi.fn();
  });

  it('opens the dialog from the current saved preferences', () => {
    const { result } = renderPreferencesHook();

    act(() => {
      result.current.setMailPreferences({
        ...DEFAULT_MAIL_PREFERENCES,
        reading_pane: 'bottom',
      });
      result.current.setMailPreferencesDraft(DEFAULT_MAIL_PREFERENCES);
    });

    act(() => {
      result.current.openMailPreferencesDialog();
    });

    expect(result.current.mailPreferencesOpen).toBe(true);
    expect(result.current.mailPreferencesDraft.reading_pane).toBe('bottom');
  });

  it('saves a flat preferences payload, closes the dialog and notifies', async () => {
    mailAPI.updatePreferences.mockResolvedValueOnce({
      reading_pane: 'bottom',
      density: 'compact',
      show_preview_snippets: false,
      show_favorites_first: false,
    });
    const { result } = renderPreferencesHook();

    act(() => {
      result.current.openMailPreferencesDialog();
      result.current.updateMailPreferencesDraft('reading_pane', 'bottom');
      result.current.updateMailPreferencesDraft('show_preview_snippets', false);
      result.current.updateMailPreferencesDraft('show_favorites_first', false);
    });

    await act(async () => {
      await result.current.handleSaveMailPreferences();
    });

    expect(mailAPI.updatePreferences).toHaveBeenCalledWith({
      ...DEFAULT_MAIL_PREFERENCES,
      reading_pane: 'bottom',
      show_preview_snippets: false,
      show_favorites_first: false,
    });
    expect(result.current.mailPreferences.reading_pane).toBe('bottom');
    expect(result.current.mailPreferences.show_preview_snippets).toBe(false);
    expect(result.current.mailPreferencesOpen).toBe(false);
    expect(result.current.mailPreferencesSaving).toBe(false);
    expect(onMessage).toHaveBeenCalledWith('Настройки вида сохранены.');
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and reports the save error', async () => {
    mailAPI.updatePreferences.mockRejectedValueOnce({
      response: { data: { detail: 'Нельзя сохранить настройки.' } },
    });
    const { result } = renderPreferencesHook();

    act(() => {
      result.current.openMailPreferencesDialog();
    });

    await act(async () => {
      await result.current.handleSaveMailPreferences();
    });

    expect(result.current.mailPreferencesOpen).toBe(true);
    expect(result.current.mailPreferencesSaving).toBe(false);
    expect(onError).toHaveBeenCalledWith('Нельзя сохранить настройки.');
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('serializes pane size patches so the second wait for the first', async () => {
    let releaseFirst;
    const firstSave = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    mailAPI.updatePreferences
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValueOnce({ message_list_width: 420 });
    const { result } = renderPreferencesHook();

    act(() => {
      result.current.persistMailPaneSize('folder_pane_width', 260);
      result.current.persistMailPaneSize('message_list_width', 420);
    });

    expect(result.current.mailPreferences.folder_pane_width).toBe(260);
    expect(result.current.mailPreferences.message_list_width).toBe(420);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mailAPI.updatePreferences).toHaveBeenCalledTimes(1);
    expect(mailAPI.updatePreferences).toHaveBeenNthCalledWith(1, { folder_pane_width: 260 });

    await act(async () => {
      releaseFirst({ folder_pane_width: 260 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mailAPI.updatePreferences).toHaveBeenCalledTimes(2);
    expect(mailAPI.updatePreferences).toHaveBeenNthCalledWith(2, { message_list_width: 420 });
  });

  it('reports a pane save failure without rolling back the local size', async () => {
    mailAPI.updatePreferences.mockRejectedValueOnce({
      response: { data: { detail: 'Панель не сохранена.' } },
    });
    const { result } = renderPreferencesHook();

    await act(async () => {
      result.current.persistMailPaneSize('folder_pane_width', 260);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.mailPreferences.folder_pane_width).toBe(260);
    expect(onError).toHaveBeenCalledWith('Панель не сохранена.');
  });
});
