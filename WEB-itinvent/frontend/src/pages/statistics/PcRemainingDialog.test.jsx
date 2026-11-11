import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PcRemainingDialog from './PcRemainingDialog';

const { getPcCleaningRemaining, addPcCleaning } = vi.hoisted(() => ({
  getPcCleaningRemaining: vi.fn(),
  addPcCleaning: vi.fn(),
}));

vi.mock('../../api/json_client', () => ({
  jsonAPI: { getPcCleaningRemaining, addPcCleaning },
}));

const REMAINING = [
  {
    inv_no: '1002',
    serial_no: 'SN-STALE',
    location: 'Склад',
    model_name: 'Lenovo ThinkCentre',
    employee: 'Петров',
    last_cleaned_at: '2025-12-01T10:00:00',
  },
  {
    inv_no: '2001',
    serial_no: 'SN-NEVER',
    location: 'Бухгалтерия',
    model_name: 'Dell OptiPlex',
    employee: 'Сидоров',
    last_cleaned_at: '',
  },
];

const BRANCH_ROW = {
  branch: 'Москва',
  total_pc: 3,
  remaining_pc: 2,
};

describe('PcRemainingDialog', () => {
  beforeEach(() => {
    getPcCleaningRemaining.mockReset();
    addPcCleaning.mockReset();
    getPcCleaningRemaining.mockResolvedValue({
      data: {
        branch: 'Москва',
        total_pc: 3,
        remaining_pc: 2,
        remaining_pcs: REMAINING,
      },
    });
    addPcCleaning.mockResolvedValue({ data: { serial_no: 'SN-STALE' } });
    window.localStorage.setItem('selected_database', 'main');
  });

  it('loads remaining PCs for the selected branch', async () => {
    render(
      <PcRemainingDialog
        open
        branchRow={BRANCH_ROW}
        periodDays={90}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Не почищены: Москва')).toBeInTheDocument();
    expect(await screen.findByText('1002')).toBeInTheDocument();
    expect(screen.getByText('SN-NEVER')).toBeInTheDocument();
    expect(screen.getByText('Сидоров')).toBeInTheDocument();
    expect(getPcCleaningRemaining).toHaveBeenCalledWith({
      period_days: 90,
      branch: 'Москва',
    });
  });

  it('does not claim all PCs are cleaned when remaining_pc is positive but the list is empty', async () => {
    getPcCleaningRemaining.mockResolvedValueOnce({
      data: { branch: 'Москва', total_pc: 3, remaining_pc: 2, remaining_pcs: [] },
    });

    render(
      <PcRemainingDialog
        open
        branchRow={BRANCH_ROW}
        periodDays={90}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText(/список ПК не пришёл с сервера/i)).toBeInTheDocument();
    expect(screen.queryByText(/все ПК этого филиала почищены/i)).not.toBeInTheDocument();
  });

  it('filters remaining PCs by search query', async () => {
    render(
      <PcRemainingDialog
        open
        branchRow={BRANCH_ROW}
        periodDays={90}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('SN-NEVER')).toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText('Поиск по инв. №, серийнику, локации или сотруднику'),
      { target: { value: 'склад' } },
    );

    expect(screen.getByText('1002')).toBeInTheDocument();
    expect(screen.queryByText('SN-NEVER')).not.toBeInTheDocument();
  });

  it('hides the cleaning button without write permission', async () => {
    render(
      <PcRemainingDialog
        open
        branchRow={BRANCH_ROW}
        periodDays={90}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('1002')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /поставить чистку/i })).not.toBeInTheDocument();
  });

  it('registers a cleaning for the selected PC', async () => {
    const onCleaningSaved = vi.fn();
    const onNotifySuccess = vi.fn();
    render(
      <PcRemainingDialog
        open
        branchRow={BRANCH_ROW}
        periodDays={90}
        canWrite
        onClose={vi.fn()}
        onCleaningSaved={onCleaningSaved}
        onNotifySuccess={onNotifySuccess}
      />,
    );

    expect(await screen.findByText('SN-NEVER')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Поставить чистку 1002' }));
    fireEvent.click(screen.getByRole('button', { name: 'Поставить' }));

    await waitFor(() => {
      expect(addPcCleaning).toHaveBeenCalledWith(expect.objectContaining({
        serial_number: 'SN-STALE',
        employee: 'Петров',
        branch: 'Москва',
        location: 'Склад',
        inv_no: '1002',
        db_name: 'main',
      }));
    });
    expect(onCleaningSaved).toHaveBeenCalledTimes(1);
    expect(onNotifySuccess).toHaveBeenCalled();
    expect(screen.queryByText('1002')).not.toBeInTheDocument();
    expect(screen.getByText('SN-NEVER')).toBeInTheDocument();
  });
});
