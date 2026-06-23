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
});
