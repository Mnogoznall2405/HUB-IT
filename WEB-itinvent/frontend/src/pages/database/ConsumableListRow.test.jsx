import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ConsumableListRow from './ConsumableListRow';

describe('ConsumableListRow', () => {
  it('renders inv number, title and qty', () => {
    render(
      <ConsumableListRow
        item={{
          INV_NO: '2001',
          TYPE_NAME: 'Картридж',
          MODEL_NAME: 'HP 85A',
          QTY: 3,
        }}
      />,
    );

    expect(screen.getByText('2001')).toBeInTheDocument();
    expect(screen.getByText('Картридж · HP 85A')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('calls onEditQty when edit is clicked', () => {
    const onEditQty = vi.fn();
    const item = { INV_NO: '2001', MODEL_NAME: 'HP 85A', QTY: 1 };

    render(<ConsumableListRow item={item} canWrite onEditQty={onEditQty} />);

    fireEvent.click(screen.getByRole('button', { name: 'Изменить количество 2001' }));

    expect(onEditQty).toHaveBeenCalledWith(item);
  });

  it('shows delete button when canDelete is true', () => {
    const onDelete = vi.fn();
    const item = { INV_NO: '2001', MODEL_NAME: 'HP 85A', QTY: 1 };

    render(
      <ConsumableListRow item={item} canDelete onDelete={onDelete} />,
    );

    expect(screen.getByRole('button', { name: 'Удалить расходник 2001' })).toBeInTheDocument();
  });

  it('hides delete button without canDelete', () => {
    render(
      <ConsumableListRow
        item={{ INV_NO: '2001', MODEL_NAME: 'HP 85A', QTY: 1 }}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Удалить расходник 2001' })).not.toBeInTheDocument();
  });

  it('calls onDelete when delete is clicked', () => {
    const onDelete = vi.fn();
    const item = { INV_NO: '2001', MODEL_NAME: 'HP 85A', QTY: 1 };

    render(<ConsumableListRow item={item} canDelete onDelete={onDelete} />);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить расходник 2001' }));

    expect(onDelete).toHaveBeenCalledWith(item);
  });
});
