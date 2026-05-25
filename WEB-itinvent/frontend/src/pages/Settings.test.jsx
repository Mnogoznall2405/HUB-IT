import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import {
  AI_AD_TOOL_OPTIONS,
  AI_NETWORK_TOOL_OPTIONS,
  createAiBotDraft,
  AiBotsAdminSection,
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
