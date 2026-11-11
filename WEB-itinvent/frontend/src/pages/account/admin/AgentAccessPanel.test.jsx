import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentAccessPanel from './AgentAccessPanel';
import { aiBotAccess } from '../../../api/aiBotAccess';

vi.mock('../../../api/aiBotAccess', () => ({ aiBotAccess: { users: vi.fn(), agents: vi.fn(), set: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

describe('AgentAccessPanel', () => {
  it('loads lazily, keeps automatic access locked and saves a grant', async () => {
    aiBotAccess.users.mockResolvedValue({ items: [
      { user_id: 1, title: 'Administrator', allowed: true, automatic: true },
      { user_id: 2, title: 'Employee', allowed: false, automatic: false },
    ], has_more: false });
    aiBotAccess.set.mockResolvedValue({});
    render(<AgentAccessPanel botId="code" />);
    expect(aiBotAccess.users).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Доступ к агентам'));
    const employee = await screen.findByRole('checkbox', { name: 'Employee' });
    expect(screen.getByRole('checkbox', { name: /Administrator/ })).toBeDisabled();
    fireEvent.click(employee);
    await waitFor(() => expect(aiBotAccess.set).toHaveBeenCalledWith('code', 2, true));
    await waitFor(() => expect(employee).toBeChecked());
  });

  it('uses the same assignment endpoint from employee card and preserves state on failure', async () => {
    aiBotAccess.agents.mockResolvedValue([{ bot_id: 'code', title: 'OpenCode', allowed: true }]);
    aiBotAccess.set.mockRejectedValue(new Error('offline'));
    render(<AgentAccessPanel userId={2} />);
    fireEvent.click(screen.getByText('Доступ к агентам'));
    const checkbox = await screen.findByRole('checkbox', { name: 'OpenCode' });
    fireEvent.click(checkbox);
    await screen.findByText('Не удалось изменить доступ');
    expect(aiBotAccess.set).toHaveBeenCalledWith('code', 2, false);
    expect(checkbox).toBeChecked();
  });
});
