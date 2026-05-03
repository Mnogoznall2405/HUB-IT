import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ActionHistoryPanel from './ActionHistoryPanel';

const ui = {
  panelBg: '#f8fafc',
  borderSoft: '#d8dee9',
  actionBg: '#fff',
};

describe('ActionHistoryPanel', () => {
  it('shows loading state until history is available', () => {
    render(<ActionHistoryPanel ui={ui} title="ИСТОРИЯ ЗАМЕНЫ" />);

    expect(screen.getByText('ИСТОРИЯ ЗАМЕНЫ')).toBeInTheDocument();
    expect(screen.getByText('Загрузка истории...')).toBeInTheDocument();
  });

  it('formats last replacement date, elapsed text and count', () => {
    const formatDate = vi.fn((value) => `date:${value}`);

    render(
      <ActionHistoryPanel
        ui={ui}
        title="ИСТОРИЯ ЧИСТОК"
        history={{ last_date: '2026-05-01', time_ago_str: '1 день', count: 3 }}
        formatDate={formatDate}
        countLabel="Всего чисток"
      />
    );

    expect(screen.getByText('Последняя: date:2026-05-01')).toBeInTheDocument();
    expect(screen.getByText('Прошло: 1 день')).toBeInTheDocument();
    expect(screen.getByText('Всего чисток: 3')).toBeInTheDocument();
    expect(formatDate).toHaveBeenCalledWith('2026-05-01');
  });

  it('supports multiple and empty states', () => {
    const { rerender } = render(
      <ActionHistoryPanel
        ui={ui}
        title="ИСТОРИЯ"
        history={{ multiple: true }}
      />
    );

    expect(screen.getByText('Для групповой операции история не отображается.')).toBeInTheDocument();

    rerender(
      <ActionHistoryPanel
        ui={ui}
        title="ИСТОРИЯ"
        history={{ count: 0, last_date: null }}
        emptyMessage="История чисток пуста"
      />
    );

    expect(screen.getByText('История чисток пуста')).toBeInTheDocument();
  });
});
