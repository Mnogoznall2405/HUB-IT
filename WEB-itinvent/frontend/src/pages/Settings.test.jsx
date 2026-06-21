import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import {
  AI_AD_TOOL_OPTIONS,
  AI_NETWORK_TOOL_OPTIONS,
  createAiBotDraft,
  AiBotsAdminSection,
  MobileBottomNavSettingsCard,
  PasswordVaultGroupsSettingsCard,
  mergeTaskDelegatesIntoUsers,
  normalizeTaskDelegateLinks,
} from './Settings';

const theme = createTheme();

function renderWithTheme(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

describe('AI_AD_TOOL_OPTIONS', () => {
  const expectedNewAdToolIds = [
    'ad.mailbox.password_status',
    'ad.mailboxes.expiring_soon',
    'ad.user.lockout_status',
    'ad.action.unlock_draft',
    'ad.user.groups',
    'ad.user.logon_history',
  ];

  it('contains all new AD tool entries', () => {
    const ids = AI_AD_TOOL_OPTIONS.map((item) => item.id);
    for (const toolId of expectedNewAdToolIds) {
      expect(ids).toContain(toolId);
    }
  });

  it('each entry has id and label', () => {
    for (const option of AI_AD_TOOL_OPTIONS) {
      expect(option).toHaveProperty('id');
      expect(option).toHaveProperty('label');
      expect(option.id).toBeTruthy();
      expect(option.label).toBeTruthy();
    }
  });
});

describe('AI_NETWORK_TOOL_OPTIONS', () => {
  const expectedNewNetworkToolIds = [
    'network.host.ping',
    'network.dns.lookup',
    'network.ssl.check',
    'network.action.wol_draft',
    'network.host.info',
  ];

  it('contains all new network tool entries', () => {
    const ids = AI_NETWORK_TOOL_OPTIONS.map((item) => item.id);
    for (const toolId of expectedNewNetworkToolIds) {
      expect(ids).toContain(toolId);
    }
  });

  it('each entry has id and label', () => {
    for (const option of AI_NETWORK_TOOL_OPTIONS) {
      expect(option).toHaveProperty('id');
      expect(option).toHaveProperty('label');
      expect(option.id).toBeTruthy();
      expect(option.label).toBeTruthy();
    }
  });
});

describe('createAiBotDraft', () => {
  it('initializes max_tool_rounds to 6 by default', () => {
    const draft = createAiBotDraft();
    expect(draft.max_tool_rounds).toBe(6);
  });

  it('initializes max_tool_calls_per_round to 3 by default', () => {
    const draft = createAiBotDraft();
    expect(draft.max_tool_calls_per_round).toBe(3);
  });

  it('reads max_tool_rounds from tool_settings', () => {
    const draft = createAiBotDraft({ tool_settings: { max_tool_rounds: 10 } });
    expect(draft.max_tool_rounds).toBe(10);
  });

  it('reads max_tool_calls_per_round from tool_settings', () => {
    const draft = createAiBotDraft({ tool_settings: { max_tool_calls_per_round: 5 } });
    expect(draft.max_tool_calls_per_round).toBe(5);
  });

  it('falls back to defaults when tool_settings is missing', () => {
    const draft = createAiBotDraft({ title: 'Test Bot' });
    expect(draft.max_tool_rounds).toBe(6);
    expect(draft.max_tool_calls_per_round).toBe(3);
  });
});

describe('task delegate user merging', () => {
  it('normalizes and maps bulk task delegates by owner id', () => {
    const users = [
      { id: 1, username: 'owner-a' },
      { id: 2, username: 'owner-b', task_delegate_links: [{ delegate_user_id: 99 }] },
    ];
    const merged = mergeTaskDelegatesIntoUsers(users, {
      items: [
        {
          owner_user_id: 1,
          task_delegate_links: [
            { delegate_user_id: 12, role_type: 'deputy', is_active: true },
            { delegate_user_id: 12, role_type: 'assistant', is_active: true },
          ],
        },
      ],
    });

    expect(merged[0].task_delegate_links).toEqual([
      expect.objectContaining({ delegate_user_id: '12', role_type: 'deputy' }),
    ]);
    expect(merged[1].task_delegate_links).toEqual([]);
  });

  it('falls back to an empty delegate list for invalid payloads', () => {
    expect(normalizeTaskDelegateLinks(null)).toEqual([]);
    expect(mergeTaskDelegatesIntoUsers([{ id: 1, username: 'owner-a' }], null)).toEqual([
      { id: 1, username: 'owner-a', task_delegate_links: [] },
    ]);
  });
});

describe('AiBotsAdminSection warning display', () => {
  const defaultProps = {
    bots: [],
    loading: false,
    savingBotId: null,
    runsByBotId: {},
    onRefresh: vi.fn(),
    onCreate: vi.fn(),
    onSave: vi.fn(),
    openrouterConfigured: true,
    dbOptions: [],
  };

  it('shows warning when bot has max_tool_rounds > 8', () => {
    const bot = {
      id: 'bot-1',
      title: 'Test Bot',
      slug: 'test-bot',
      tool_settings: { max_tool_rounds: 9, max_tool_calls_per_round: 3 },
      enabled_tools: [],
    };
    renderWithTheme(<AiBotsAdminSection {...defaultProps} bots={[bot]} />);
    expect(
      screen.getByText(/больше 8 раундов может значительно увеличить время ответа/i)
    ).toBeInTheDocument();
  });

  it('does not show warning when bot has max_tool_rounds <= 8', () => {
    const bot = {
      id: 'bot-2',
      title: 'Test Bot',
      slug: 'test-bot',
      tool_settings: { max_tool_rounds: 6, max_tool_calls_per_round: 3 },
      enabled_tools: [],
    };
    renderWithTheme(<AiBotsAdminSection {...defaultProps} bots={[bot]} />);
    expect(
      screen.queryByText(/больше 8 раундов может значительно увеличить время ответа/i)
    ).not.toBeInTheDocument();
  });
});

describe('PasswordVaultGroupsSettingsCard', () => {
  it('shows empty warning when groups list is empty', () => {
    renderWithTheme(
      <PasswordVaultGroupsSettingsCard
        groups={[]}
        loading={false}
        saving={false}
        onRefresh={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onArchive={vi.fn()}
      />,
    );
    expect(screen.getByText(/список групп пуст/i)).toBeInTheDocument();
  });

  it('renders active group row', () => {
    renderWithTheme(
      <PasswordVaultGroupsSettingsCard
        groups={[{ id: 'g-1', name: 'VPN', is_active: true, sort_order: 0 }]}
        loading={false}
        saving={false}
        onRefresh={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onArchive={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('VPN')).toBeInTheDocument();
    expect(screen.getByText('Сохранить')).toBeInTheDocument();
  });
});

describe('MobileBottomNavSettingsCard', () => {
  const availableItems = [
    { path: '/dashboard', label: 'Главная', shortLabel: 'Главная', icon: <span>D</span> },
    { path: '/tasks', label: 'Задачи', shortLabel: 'Задачи', icon: <span>T</span> },
    { path: '/chat', label: 'Чат', shortLabel: 'Чат', icon: <span>C</span> },
    { path: '/mail', label: 'Почта', shortLabel: 'Почта', icon: <span>M</span> },
    { path: '/database', label: 'Учёт', shortLabel: 'Учёт', icon: <span>I</span> },
  ];
  const menuItem = { path: '/menu', label: 'Меню', shortLabel: 'Меню', icon: <span>O</span> };

  it('limits selection to four items and removes a selected tile', () => {
    const onChange = vi.fn();
    renderWithTheme(
      <MobileBottomNavSettingsCard
        availableItems={availableItems}
        selectedPaths={['/dashboard', '/tasks', '/chat', '/mail']}
        resolvedItems={[...availableItems.slice(0, 4), menuItem]}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('Выбрано 4 из 4')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-bottom-nav-option-database')).toBeDisabled();

    fireEvent.click(screen.getByTestId('mobile-bottom-nav-option-chat'));
    expect(onChange).toHaveBeenCalledWith(['/dashboard', '/tasks', '/mail']);
  });

  it('resets the draft to the default navigation items', () => {
    const onChange = vi.fn();
    renderWithTheme(
      <MobileBottomNavSettingsCard
        availableItems={availableItems}
        selectedPaths={['/database']}
        resolvedItems={[...availableItems.slice(0, 4), menuItem]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'По умолчанию' }));
    expect(onChange).toHaveBeenCalledWith(['/dashboard', '/tasks', '/chat', '/mail']);
  });
});
