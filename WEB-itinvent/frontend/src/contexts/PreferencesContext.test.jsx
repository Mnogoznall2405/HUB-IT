import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      <button
        type="button"
        onClick={() => savePreferences({ dashboard_mobile_sections: ['tasks', 'invalid', 'urgent', 'tasks'] })}
      >
        save-sections
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

  it('defers loading user settings until after the initial render', async () => {
    getMySettingsMock.mockResolvedValue({
      dashboard_mobile_sections: ['tasks', 'urgent'],
    });

    render(
      <PreferencesProvider>
        <PreferencesProbe />
      </PreferencesProvider>,
    );

    expect(screen.getByTestId('sections')).toHaveTextContent('urgent,announcements,tasks');
    expect(getMySettingsMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(getMySettingsMock).toHaveBeenCalledWith({ suppressAuthRequired: true });
    });
  });

  it('reads and normalizes dashboard mobile sections from the settings API', async () => {
    getMySettingsMock.mockResolvedValue({
      dashboard_mobile_sections: ['tasks', 'invalid', 'urgent', 'tasks'],
    });
    updateMySettingsMock.mockResolvedValue({
      dashboard_mobile_sections: ['tasks', 'urgent'],
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
    });
  });

  it('falls back to default sections for invalid settings payload and saves normalized values', async () => {
    getMySettingsMock.mockResolvedValue({
      dashboard_mobile_sections: ['invalid'],
    });
    updateMySettingsMock.mockResolvedValue({
      dashboard_mobile_sections: ['tasks', 'urgent'],
    });

    render(
      <PreferencesProvider>
        <PreferencesProbe />
      </PreferencesProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('sections')).toHaveTextContent('urgent,announcements,tasks');
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

  it('still refreshes settings after auth changes', async () => {
    getMySettingsMock.mockResolvedValue({
      dashboard_mobile_sections: ['tasks', 'urgent'],
    });

    render(
      <PreferencesProvider>
        <PreferencesProbe />
      </PreferencesProvider>,
    );

    await waitFor(() => {
      expect(getMySettingsMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      window.dispatchEvent(new Event('auth-changed'));
    });

    await waitFor(() => {
      expect(getMySettingsMock).toHaveBeenCalledTimes(2);
    });
  });
});
