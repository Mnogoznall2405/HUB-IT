import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EnhancedFabAction from './EnhancedFabAction';

describe('EnhancedFabAction', () => {
  it('renders label and description and handles clicks', () => {
    const handleClick = vi.fn();

    render(
      <EnhancedFabAction
        icon={<span data-testid="icon">I</span>}
        label="Open scanner"
        description="Scan inventory QR"
        onClick={handleClick}
      />
    );

    expect(screen.getByText('Open scanner')).toBeInTheDocument();
    expect(screen.getByText('Scan inventory QR')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Open scanner'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not call click handler when disabled or loading', () => {
    const disabledClick = vi.fn();
    const loadingClick = vi.fn();

    const { rerender } = render(
      <EnhancedFabAction icon={<span />} label="Disabled" onClick={disabledClick} disabled />
    );

    fireEvent.click(screen.getByText('Disabled'));
    expect(disabledClick).not.toHaveBeenCalled();

    rerender(
      <EnhancedFabAction icon={<span />} label="Loading" onClick={loadingClick} loading />
    );

    fireEvent.click(screen.getByText('Загрузка...'));
    expect(loadingClick).not.toHaveBeenCalled();
  });
});
