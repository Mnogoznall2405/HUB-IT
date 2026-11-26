import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WorkSchedulesAdminSection from './WorkSchedulesAdminSection';
import { dlpWorkSchedulesAPI } from '../../../api/dlpWorkSchedules';

vi.mock('../../../api/dlpWorkSchedules', () => ({
  dlpWorkSchedulesAPI: {
    getSchedules: vi.fn(),
    saveSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
  },
}));

const SCHEDULE = {
  branch_name: 'Тюмень',
  work_start_min: 540,
  work_end_min: 1080,
  lunch_start_min: 780,
  lunch_end_min: 825,
  tz_offset_minutes: 0,
  workdays_mask: 31,
  updated_by: 'admin',
  updated_at: '2026-11-12T08:00:00+00:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  dlpWorkSchedulesAPI.getSchedules.mockResolvedValue({
    items: [SCHEDULE],
    branches: ['Тюмень', 'Москва'],
  });
  dlpWorkSchedulesAPI.saveSchedule.mockResolvedValue({ schedule: SCHEDULE });
  dlpWorkSchedulesAPI.deleteSchedule.mockResolvedValue({ success: true });
});

describe('WorkSchedulesAdminSection', () => {
  it('lists branches with their schedule and saves an edit', async () => {
    render(<WorkSchedulesAdminSection />);

    const row = (await screen.findByText('Тюмень')).closest('tr');
    expect(within(row).getByText('09:00 — 18:00')).toBeInTheDocument();
    expect(within(row).getByText('13:00 — 13:45')).toBeInTheDocument();
    expect(within(row).getByText('как на сервере')).toBeInTheDocument();

    // Unconfigured branch offers "Задать", configured offers "Изменить".
    const moscowRow = screen.getByText('Москва').closest('tr');
    fireEvent.click(within(moscowRow).getByRole('button', { name: 'Задать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(dlpWorkSchedulesAPI.saveSchedule).toHaveBeenCalledWith(
      'Москва',
      expect.objectContaining({ work_start_min: 540, work_end_min: 1080, workdays_mask: 31 }),
    ));
    expect(dlpWorkSchedulesAPI.getSchedules).toHaveBeenCalledTimes(2); // reload after save
  });

  it('resets a configured branch back to default counting', async () => {
    render(<WorkSchedulesAdminSection />);

    const row = (await screen.findByText('Тюмень')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'сбросить Тюмень' }));

    await waitFor(() => expect(dlpWorkSchedulesAPI.deleteSchedule).toHaveBeenCalledWith('Тюмень'));
    expect(await screen.findByText(/график сброшен/)).toBeInTheDocument();
  });
});
