import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TicketRequestList from './TicketRequestList';
import { STATUS_ROW_COLORS } from './ticketUi';

vi.mock('../../api/tickets', () => ({
  ticketsAPI: {
    listRequests: vi.fn().mockResolvedValue({
      items: [
        {
          id: 42,
          submitted_at: '2026-06-01T10:00:00Z',
          employee_name: 'Иванов И.И.',
          department: 'ИТ',
          position: 'Инженер',
          passport_series: '1234',
          passport_number: '567890',
          issue_date: '2020-01-15T00:00:00Z',
          issued_by: 'ОВД',
          issuer_code: '123-456',
          date_of_birth: '1990-05-20T00:00:00Z',
          birth_place: 'Москва',
          registration_address: 'ул. Примерная, 1',
          phone: '+79001234567',
          arrival_date: '2026-06-10T00:00:00Z',
          route: 'Москва',
          object_code: 'KAM',
          note: 'Срочно',
          total_cost: '15000.00',
          refund_loss: '0.00',
          status: 'at_cashier',
        },
      ],
      total: 1,
    }),
    exportRequests: vi.fn(),
  },
}));

describe('TicketRequestList', () => {
  it('renders Excel columns and applies row color by status', async () => {
    render(<TicketRequestList objects={[]} canWrite />);

    expect(await screen.findByText('Иванов И.И.')).toBeInTheDocument();
    expect(screen.getByText('Подразделение')).toBeInTheDocument();
    expect(screen.getByText('Шифр объекта')).toBeInTheDocument();
    expect(screen.getByText('1234 / 567890')).toBeInTheDocument();
    expect(screen.getByText('Срочно')).toBeInTheDocument();

    const row = screen.getByText('Иванов И.И.').closest('tr');
    expect(row).toHaveStyle({ backgroundColor: STATUS_ROW_COLORS.at_cashier });
  });
});
