import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), setThreshold: vi.fn(), check: vi.fn() }));
vi.mock('../../../api/aiBalance', () => ({ aiBalanceAPI: api }));

import AiBalanceCard, { describeBalanceState } from './AiBalanceCard';

describe('AiBalanceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ balance: 5, threshold: 10, low: true, status: 'low', checked_at: null, check_enabled: true });
  });

  it('shows the low-balance warning line and saves a new threshold', async () => {
    api.setThreshold.mockResolvedValue({ balance: 5, threshold: 3, low: false, status: 'ok', check_enabled: true });
    render(<AiBalanceCard />);
    expect(await screen.findByText(/ниже порога 10/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Порог предупреждения о балансе'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить порог' }));
    await waitFor(() => expect(api.setThreshold).toHaveBeenCalledWith('3'));
    expect(await screen.findByText(/Остаток 5, порог предупреждения 3/)).toBeInTheDocument();
  });

  it('checks the balance on demand and reports a failure', async () => {
    api.check.mockRejectedValue(new Error('x'));
    render(<AiBalanceCard />);
    await screen.findByText(/ниже порога/);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить сейчас' }));
    expect(await screen.findByText('Не удалось проверить баланс.')).toBeInTheDocument();
  });

  it('describes every state', () => {
    expect(describeBalanceState({ status: 'error', error: '401' }).severity).toBe('warning');
    expect(describeBalanceState({ balance: null, check_enabled: false }).text).toMatch(/выключена/);
    expect(describeBalanceState({ balance: 50, threshold: 0, low: false }).text).toMatch(/порог не задан/);
  });
});
