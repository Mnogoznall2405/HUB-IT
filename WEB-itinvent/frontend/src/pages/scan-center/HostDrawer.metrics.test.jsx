import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SelectedRunSystemMetrics } from './HostDrawer';

vi.mock('../../api/scanTasks', () => ({
  scanTasksAPI: {
    getTaskSystemMetrics: vi.fn(),
  },
}));

import { scanTasksAPI } from '../../api/scanTasks';

describe('SelectedRunSystemMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sparklines when metrics items exist', async () => {
    scanTasksAPI.getTaskSystemMetrics.mockResolvedValue({
      items: [
        { captured_at: 1, cpu_percent: 10, memory_percent: 20 },
        { captured_at: 2, cpu_percent: 40, memory_percent: 30 },
      ],
      summary: { cpu_percent_max: 40, memory_percent_max: 30 },
    });

    render(<SelectedRunSystemMetrics taskId="task-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-run-system-metrics')).toBeInTheDocument();
    });
    expect(scanTasksAPI.getTaskSystemMetrics).toHaveBeenCalledWith(
      'task-1',
      {},
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText(/CPU max 40\.0%/i)).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'sparkline' })).toHaveLength(2);
  });

  it('shows empty state when no samples', async () => {
    scanTasksAPI.getTaskSystemMetrics.mockResolvedValue({ items: [], summary: {} });
    render(<SelectedRunSystemMetrics taskId="task-empty" />);
    await waitFor(() => {
      expect(screen.getByText(/Метрики для этого запуска недоступны/i)).toBeInTheDocument();
    });
  });
});
