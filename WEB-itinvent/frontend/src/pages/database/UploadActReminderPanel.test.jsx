import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UploadActReminderPanel from './UploadActReminderPanel';

describe('UploadActReminderPanel', () => {
  it('does not render when there is no reminder state', () => {
    const { container } = render(<UploadActReminderPanel />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders reminder counters, first pending groups, and actions', () => {
    const onOpenTask = vi.fn();
    const onRefreshReminder = vi.fn();

    render(
      <UploadActReminderPanel
        binding={{
          task_id: 'task-7',
          reminder_id: 'rem-9',
          pending_groups_total: 3,
          completed_groups_total: 1,
          pending_groups: [
            { id: 'g1', old_employee_name: 'Иванов И.И.', inv_nos: ['1001', '1002'] },
          ],
        }}
        onOpenTask={onOpenTask}
        onRefreshReminder={onRefreshReminder}
      />
    );

    expect(screen.getByText('Reminder по загрузке акта')).toBeInTheDocument();
    expect(screen.getByText(/Ожидается актов: 3/)).toBeInTheDocument();
    expect(screen.getByText(/Иванов И\.И\.: 1001, 1002/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Открыть задачу' }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить статус' }));

    expect(onOpenTask).toHaveBeenCalledWith('task-7');
    expect(onRefreshReminder).toHaveBeenCalledWith('rem-9');
  });

  it('renders loading and warning states', () => {
    render(<UploadActReminderPanel loading error="Не удалось загрузить напоминание" />);

    expect(screen.getByText('Загрузка данных напоминания...')).toBeInTheDocument();
    expect(screen.getByText('Не удалось загрузить напоминание')).toBeInTheDocument();
  });
});
