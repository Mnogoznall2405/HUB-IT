import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMySettingsMock = vi.fn();
const updateMySettingsMock = vi.fn();

vi.mock('../api/client', () => ({
  settingsAPI: {
    getMySettings: (...args) => getMySettingsMock(...args),
    updateMySettings: (...args) => updateMySettingsMock(...args),
  },
}));

import { PreferencesProvider, usePreferences } from './PreferencesContext';
import { DATABASE_BRANCH_FILTERS_CACHE_KEY } from '../pages/database/databaseBranchPreferences';

function PreferencesProbe() {
  const { preferences, savePreferences } = usePreferences();

  return (
    <>
      <div data-testid="dashboard-sections">{preferences.dashboard_sections.join(',')}</div>
      <div data-testid="sections">{preferences.dashboard_mobile_sections.join(',')}</div>
      <div data-testid="mobile-nav">{preferences.mobile_bottom_nav_items.join(',')}</div>
      <button
        type="button"
        onClick={() => savePreferences({ dashboard_sections: ['news', 'tasks', 'invalid', 'news'] })}
      >
        save-dashboard-sections
      </button>
      <button
        type="button"
        onClick={() => savePreferences({ dashboard_mobile_sections: ['tasks', 'invalid', 'urgent', 'tasks'] })}
      >
        save-sections
      </button>
      <button
        type="button"
        onClick={() => savePreferences({
          mobile_bottom_nav_items: ['/mail', '/tasks', '/mail', '/database', '/settings', '/kb'],
        })}
      >
        save-mobile-nav
      </button>
    </>
  );
}

describe('PreferencesContext dashboard mobile sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 1, username: 'tester' }));
  });

  it('reads and normalizes dashboard mobile sections from the settings API', async () => {
    getMySettingsMock.mockResolvedValue({
      dashboard_mobile_sections: ['tasks', 'invalid', 'urgent', 'tasks'],
      mobile_bottom_nav_items: ['/mail', '/tasks', '/mail', '/database', '/settings', '/kb'],
    });
    updateMySettingsMock.mockResolvedValue({
      dashboard_sections: ['attention', 'tasks', 'communication', 'news'],
      dashboard_mobile_sections: ['tasks', 'urgent'],
      mobile_bottom_nav_items: ['/mail', '/tasks', '/database', '/kb'],
    });

    render(
      <PreferencesProvider>
        <PreferencesProbe />
      </PreferencesProvider>,
    );

    await waitFor(() => {
      expect(getMySettingsMock).toHaveBeenCalledWith({ suppressAuthRequired: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-sections')).toHaveTextContent('attention,tasks,communication');
      expect(screen.getByTestId('sections')).toHaveTextContent('urgent,tasks');
      expect(screen.getByTestId('mobile-nav')).toHaveTextContent('/mail,/tasks,/database,/kb');
    });
  });

  it('falls back to default sections for invalid settings payload and saves normalized values', async () => {
    getMySettingsMock.mockResolvedValue({
      dashboard_mobile_sections: ['invalid'],
      mobile_bottom_nav_items: null,
    });
    updateMySettingsMock.mockResolvedValue({
      dashboard_mobile_sections: ['tasks', 'urgent'],
      mobile_bottom_nav_items: ['/dashboard', '/tasks', '/chat', '/mail'],
    });

    render(
      <PreferencesProvider>
        <PreferencesProbe />
      </PreferencesProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-sections')).toHaveTextContent('attention,communication,news,tasks');
      expect(screen.getByTestId('sections')).toHaveTextContent('urgent,announcements,tasks');
      expect(screen.getByTestId('mobile-nav')).toHaveTextContent('/dashboard,/tasks,/chat,/mail');
    });

    fireEvent.click(screen.getByRole('button', { name: 'save-sections' }));

    await waitFor(() => {
      expect(updateMySettingsMock).toHaveBeenCalledWith({
        dashboard_sections: ['attention', 'tasks', 'communication'],
        dashboard_mobile_sections: ['tasks', 'urgent'],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-sections')).toHaveTextContent('attention,tasks,communication');
      expect(screen.getByTestId('sections')).toHaveTextContent('urgent,tasks');
    });
  });

  it('saves one canonical dashboard order and keeps the legacy alias compatible', async () => {
    getMySettingsMock.mockResolvedValue({
      dashboard_sections: ['attention', 'tasks', 'communication', 'news'],
    });
    updateMySettingsMock.mockResolvedValue({
      dashboard_sections: ['attention', 'news', 'tasks'],
      dashboard_mobile_sections: ['urgent', 'announcements', 'tasks'],
    });

    render(
      <PreferencesProvider>
        <PreferencesProbe />
      </PreferencesProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-sections')).toHaveTextContent('attention,tasks,communication,news');
    });

    fireEvent.click(screen.getByRole('button', { name: 'save-dashboard-sections' }));

    await waitFor(() => {
      expect(updateMySettingsMock).toHaveBeenCalledWith({
        dashboard_sections: ['attention', 'news', 'tasks'],
        dashboard_mobile_sections: ['urgent', 'announcements', 'tasks'],
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-sections')).toHaveTextContent('attention,news,tasks');
      expect(screen.getByTestId('sections')).toHaveTextContent('urgent,announcements,tasks');
    });
  });

  it('optimistically saves a unique maximum of four mobile navigation paths', async () => {
    getMySettingsMock.mockResolvedValue({
      mobile_bottom_nav_items: ['/dashboard', '/tasks', '/chat', '/mail'],
    });
    updateMySettingsMock.mockResolvedValue({
      mobile_bottom_nav_items: ['/mail', '/tasks', '/database', '/kb'],
    });

    render(
      <PreferencesProvider>
        <PreferencesProbe />
      </PreferencesProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mobile-nav')).toHaveTextContent('/dashboard,/tasks,/chat,/mail');
    });

    fireEvent.click(screen.getByRole('button', { name: 'save-mobile-nav' }));

    await waitFor(() => {
      expect(updateMySettingsMock).toHaveBeenCalledWith({
        mobile_bottom_nav_items: ['/mail', '/tasks', '/database', '/kb'],
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('mobile-nav')).toHaveTextContent('/mail,/tasks,/database,/kb');
    });
  });

  it('merges database branch filters into localStorage when settings are refreshed', async () => {
    getMySettingsMock.mockResolvedValue({
      database_branch_filters: { main: 'HQ', remote: 'Remote' },
    });

    render(
      <PreferencesProvider>
        <PreferencesProbe />
      </PreferencesProvider>,
    );

    await waitFor(() => {
      expect(localStorage.getItem(DATABASE_BRANCH_FILTERS_CACHE_KEY)).toBe(
        JSON.stringify({ main: 'HQ', remote: 'Remote' }),
      );
    });
  });
});
