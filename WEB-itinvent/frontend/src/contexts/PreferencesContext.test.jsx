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

function PreferencesProbe() {
  const { preferences, savePreferences } = usePreferences();

  return (
    <>
      <div data-testid="sections">{preferences.dashboard_mobile_sections.join(',')}</div>
      <div data-testid="mobile-nav">{preferences.mobile_bottom_nav_items.join(',')}</div>
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
      dashboard_mobile_sections: ['tasks', 'urgent'],
      mobile_bottom_nav_items: ['/mail', '/tasks', '/database', '/settings'],
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
      expect(screen.getByTestId('sections')).toHaveTextContent('tasks,urgent');
      expect(screen.getByTestId('mobile-nav')).toHaveTextContent('/mail,/tasks,/database,/settings');
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
      expect(screen.getByTestId('sections')).toHaveTextContent('urgent,announcements,tasks');
      expect(screen.getByTestId('mobile-nav')).toHaveTextContent('/dashboard,/tasks,/chat,/mail');
    });

    fireEvent.click(screen.getByRole('button', { name: 'save-sections' }));

    await waitFor(() => {
      expect(updateMySettingsMock).toHaveBeenCalledWith({
        dashboard_mobile_sections: ['tasks', 'urgent'],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('sections')).toHaveTextContent('tasks,urgent');
    });
  });

  it('optimistically saves a unique maximum of four mobile navigation paths', async () => {
    getMySettingsMock.mockResolvedValue({
      mobile_bottom_nav_items: ['/dashboard', '/tasks', '/chat', '/mail'],
    });
    updateMySettingsMock.mockResolvedValue({
      mobile_bottom_nav_items: ['/mail', '/tasks', '/database', '/settings'],
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
        mobile_bottom_nav_items: ['/mail', '/tasks', '/database', '/settings'],
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('mobile-nav')).toHaveTextContent('/mail,/tasks,/database,/settings');
    });
  });
});
