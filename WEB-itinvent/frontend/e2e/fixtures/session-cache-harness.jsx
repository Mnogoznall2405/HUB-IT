import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../../src/contexts/AuthContext';
import { getOrFetchSWR, peekSWRCache, setSWRCache } from '../../src/lib/swrCache';
import { NotificationProvider, useNotification } from '../../src/contexts/NotificationContext';
import { PreferencesProvider, usePreferences } from '../../src/contexts/PreferencesContext';
import useMailAdvancedSearch from '../../src/components/mail/useMailAdvancedSearch';
import { UploadResumeHarness } from './upload-resume-harness';

function Harness() {
  const { user, logout, login, refreshSession } = useAuth();
  const { toastHistory, notifyInfo, markHubNotificationsSeen, hasSeenHubNotification } = useNotification();
  const { preferences, refreshFromServer, savePreferences } = usePreferences();
  const mailSearch = useMailAdvancedSearch({ userKey: user?.id ?? user?.username ?? '' });
  const [cache, setCache] = useState('empty');
  const [state, setState] = useState('');
  const [media, setMedia] = useState('');
  return <main>
    <UploadResumeHarness />
    <output aria-label="История поиска почты">{mailSearch.recentSearches.map((item) => item.q).join('|') || 'empty'}</output>
    <output aria-label="Применённый поиск почты">{mailSearch.advancedFiltersApplied.q || 'empty'}</output>
    <input aria-label="Поиск почты" value={mailSearch.advancedFiltersDraft.q} onChange={(event) => mailSearch.setAdvancedFiltersDraft((previous) => ({ ...previous, q: event.target.value }))} />
    <button onClick={mailSearch.handleApplyAdvancedSearch}>Применить поиск почты</button>
    <button onClick={() => {
      void fetch('/__audit/late-mail-search').then(() => mailSearch.rememberRecentSearch({ q: 'LATE_PRIVATE_A' }));
    }}>Отложить поиск почты</button>
    <output aria-label="Закреплённая БД">{preferences.pinned_database || 'empty'}</output>
    <output aria-label="Фильтры филиалов">{JSON.stringify(preferences.database_branch_filters)}</output>
    <button onClick={() => { void refreshFromServer().then(() => setState('preferences loaded')); }}>Обновить настройки</button>
    <button onClick={() => { void savePreferences({ pinned_database: 'db-a-new' }).then(() => setState('preferences saved')).catch(() => setState('preferences error')); }}>Сохранить настройки</button>
    <button onClick={() => {
      void fetch('/__audit/late-setting-save').then(() => savePreferences({ pinned_database: 'db-a-new' }))
        .then(() => setState('preferences saved')).catch(() => setState('preferences error'));
    }}>Отложить сохранение настроек</button>
    <output aria-label="История уведомлений">{toastHistory.map((item) => item.message).join('|') || 'empty'}</output>
    <output aria-label="Просмотрено A">{String(hasSeenHubNotification('private-a'))}</output>
    <button onClick={() => {
      notifyInfo('Приватное A', { persist: true, source: 'chat' });
      notifyInfo('Очередь A', { persist: true, source: 'chat' });
      markHubNotificationsSeen('private-a');
    }}>Добавить уведомления</button>
    <button onClick={() => {
      void fetch('/__audit/late-notification').then(() => notifyInfo('Позднее A', { persist: true }));
    }}>Отложенное уведомление</button>
    <output aria-label="Пользователь">{user?.username || 'anonymous'}</output>
    <output aria-label="Кэш">{cache}</output>
    <output aria-label="Результат">{state}</output>
    <output aria-label="Превью">{media}</output>
    <button onClick={() => {
      void fetch('/api/v1/chat/messages/audit-a/attachments/1/file?inline=1&variant=thumb')
        .then(async (response) => setMedia(`${response.status}:${await response.text()}`));
    }}>Превью чата</button>
    <button onClick={() => { setSWRCache('audit-private', user?.username); setState('cached'); }}>Сохранить кэш</button>
    <button onClick={() => setCache(peekSWRCache('audit-private')?.data || 'empty')}>Показать кэш</button>
    <button onClick={() => {
      void getOrFetchSWR('audit-private', () => fetch('/__audit/private-cache').then((response) => response.text()), { force: true })
        .then(() => setState('data loaded'));
    }}>Запросить данные</button>
    <button onClick={() => { void refreshSession({ suppressAuthRequired: true }).then(() => setState('session checked')).catch(() => setState('session error')); }}>Проверить сессию</button>
    <button onClick={() => { void logout().then(() => setState('logged out')); }}>Выйти</button>
    <button onClick={() => { void login('user-b', 'fixture-only').then(() => setState('logged in')); }}>Войти как B</button>
    <button onClick={() => { void login('user-a', 'fixture-only').then(() => setState('logged in')); }}>Войти как A</button>
  </main>;
}

createRoot(document.getElementById('root')).render(<PreferencesProvider><NotificationProvider><AuthProvider><Harness /></AuthProvider></NotificationProvider></PreferencesProvider>);
