import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { AiBotsAdminSection, resolveAvailableSettingsTabs, SETTINGS_PERMISSION_GROUPS } from './Settings';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin' },
  }),
}));

vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifyInfo: vi.fn(),
    notifySuccess: vi.fn(),
    notifyWarning: vi.fn(),
  }),
}));

const theme = createTheme();

describe('resolveAvailableSettingsTabs', () => {
  it('includes the dedicated AI Bots tab when settings.ai.manage is granted', () => {
    const tabs = resolveAvailableSettingsTabs({
      isAdmin: false,
      hasPermission: (permission) => permission === 'settings.ai.manage',
    });

    expect(tabs.some((item) => item.value === 'ai-bots')).toBe(true);
    expect(tabs.some((item) => item.value === 'env')).toBe(false);
  });

  it('hides the AI Bots tab when settings.ai.manage is missing', () => {
    const tabs = resolveAvailableSettingsTabs({
      isAdmin: true,
      hasPermission: () => false,
    });

    expect(tabs.some((item) => item.value === 'ai-bots')).toBe(true);
    expect(tabs.some((item) => item.value === 'env')).toBe(true);
  });

  it('keeps permission-gated tabs visible for admin even without explicit custom permissions', () => {
    const tabs = resolveAvailableSettingsTabs({
      isAdmin: true,
      hasPermission: () => false,
    });

    expect(tabs.some((item) => item.value === 'users')).toBe(true);
    expect(tabs.some((item) => item.value === 'sessions')).toBe(true);
    expect(tabs.some((item) => item.value === 'ai-bots')).toBe(true);
  });
});

describe('SETTINGS_PERMISSION_GROUPS', () => {
  it('exposes the AI permissions in the user permission matrix', () => {
    const flattened = SETTINGS_PERMISSION_GROUPS.flatMap((group) => group.permissions || []);

    expect(flattened).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'chat.ai.use', label: 'Chat: AI access' }),
      expect.objectContaining({ value: 'settings.ai.manage', label: 'Settings: AI bots manage' }),
    ]));
  });
});

describe('AiBotsAdminSection', () => {
  it('shows empty diagnostics and PM2 hints when no bots exist yet', () => {
    render(
      <ThemeProvider theme={theme}>
        <AiBotsAdminSection
          bots={[]}
          loading={false}
          savingBotId=""
          runsByBotId={{}}
          onRefresh={vi.fn()}
          onCreate={vi.fn()}
          onSave={vi.fn()}
          openrouterConfigured={false}
          dbOptions={[{ id: 'ITINVENT', name: 'ITINVENT' }]}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText(/OpenRouter:/i)).toBeInTheDocument();
    expect(screen.getByText(/PM2:/i)).toBeInTheDocument();
    expect(screen.getByText(/AI bots not created yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ITinvent live data/i)).toBeInTheDocument();
    expect(screen.getByText(/Live data \/ ITinvent tools/i)).toBeInTheDocument();
  });

  it('warns when an enabled bot has no live tools and saves the default tool set', () => {
    const onSave = vi.fn();
    const bot = {
      id: 'bot-1',
      slug: 'corp-assistant',
      title: 'Corp Assistant',
      description: 'KB bot',
      model: 'openai/gpt-4o-mini',
      allow_file_input: true,
      allow_generated_artifacts: true,
      allow_kb_document_delivery: false,
      is_enabled: true,
      configured: true,
      live_data_enabled: false,
      bot_user_id: 77,
      system_prompt: 'Prompt',
      temperature: 0.2,
      max_tokens: 2000,
      allowed_kb_scope: [],
      enabled_tools: [],
      tool_settings: {
        multi_db_mode: 'single',
        allowed_databases: [],
      },
      updated_at: '2026-04-22T20:32:00Z',
      latest_run_status: 'completed',
      latest_run_error: null,
    };

    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <AiBotsAdminSection
          bots={[bot]}
          loading={false}
          savingBotId=""
          runsByBotId={{}}
          onRefresh={vi.fn()}
          onCreate={vi.fn()}
          onSave={onSave}
          openrouterConfigured
          dbOptions={[{ id: 'ITINVENT', name: 'ITINVENT' }]}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText('Corp Assistant'));
    expect(screen.getByText(/Persisted config is enabled but has no saved live ITinvent tools/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText(/ITinvent live data/i).slice(-1)[0]);
    fireEvent.click(screen.getAllByRole('button').slice(-1)[0]);

    expect(onSave).toHaveBeenCalledWith('bot-1', expect.objectContaining({
      enabled_tools: expect.arrayContaining([
        'itinvent.database.current',
        'itinvent.equipment.search',
        'itinvent.equipment.search_universal',
        'itinvent.equipment.get_card',
        'itinvent.equipment.list_by_branch',
        'itinvent.consumables.search',
        'itinvent.directory.equipment_types',
        'itinvent.directory.statuses',
      ]),
      multi_db_mode: 'single',
    }));

    const persistedBot = {
      ...bot,
      enabled_tools: onSave.mock.calls[0][1].enabled_tools,
      live_data_enabled: true,
    };

    rerender(
      <ThemeProvider theme={theme}>
        <AiBotsAdminSection
          bots={[persistedBot]}
          loading={false}
          savingBotId=""
          runsByBotId={{}}
          onRefresh={vi.fn()}
          onCreate={vi.fn()}
          onSave={onSave}
          openrouterConfigured
          dbOptions={[{ id: 'ITINVENT', name: 'ITINVENT' }]}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText('Corp Assistant'));
    expect(screen.queryByText(/Persisted config is enabled but has no saved live ITinvent tools/i)).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/ITinvent live data/i).slice(-1)[0]).toBeChecked();
  });
});
