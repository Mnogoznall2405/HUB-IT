import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ActionMenu from './ActionMenu';

describe('ActionMenu', () => {
  it('renders delete action when requested and dispatches it', async () => {
    const onAction = vi.fn();
    const item = { inv_no: '1001' };

    render(<ActionMenu onAction={onAction} actions={['view', 'delete']} item={item} />);

    fireEvent.click(screen.getByRole('button', { name: 'Действия' }));
    fireEvent.click(await screen.findByText('Удалить'));

    expect(onAction).toHaveBeenCalledWith('delete', item);
  });

  it('does not render delete action when it is not included', async () => {
    const onAction = vi.fn();

    render(<ActionMenu onAction={onAction} actions={['view', 'transfer']} item={{ inv_no: '1001' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Действия' }));

    expect(screen.queryByText('Удалить')).not.toBeInTheDocument();
  });
});
