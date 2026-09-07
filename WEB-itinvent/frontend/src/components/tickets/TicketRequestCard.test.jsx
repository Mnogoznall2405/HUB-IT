import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ticketsAPI } from '../../api/tickets';
import TicketRequestCard from './TicketRequestCard';

vi.mock('../../api/tickets', () => ({ ticketsAPI: { getRequest: vi.fn() } }));

it('does not replace the selected request with a late response for the previous request', async () => {
  let resolveOld;
  ticketsAPI.getRequest.mockImplementation((id) => id === 1
    ? new Promise((resolve) => { resolveOld = resolve; })
    : Promise.resolve({ id: 2, status: 'new', employee_name: 'New employee' }));
  const { rerender } = render(<TicketRequestCard requestId={1} />);
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
  rerender(<TicketRequestCard requestId={2} />);
  expect(await screen.findByText('Заявка #2')).toBeInTheDocument();
  await act(async () => resolveOld({ id: 1, status: 'new', employee_name: 'Old employee' }));
  expect(screen.getByText('Заявка #2')).toBeInTheDocument();
  expect(screen.queryByText('Заявка #1')).not.toBeInTheDocument();
});
