import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DetailQrDialog from './DetailQrDialog';

describe('DetailQrDialog', () => {
  it('shows generated QR content and enables download', () => {
    const onClose = vi.fn();

    render(
      <DetailQrDialog
        open
        onClose={onClose}
        borderColor="#ddd"
        url="data:image/png;base64,qr"
        text="INV: 1001"
        fileName="qr-1001.png"
      />
    );

    expect(screen.getByAltText('Equipment QR')).toHaveAttribute('src', 'data:image/png;base64,qr');
    expect(screen.getByLabelText('Содержимое QR')).toHaveValue('INV: 1001');
    expect(screen.getByRole('link', { name: 'Скачать PNG' })).toHaveAttribute('download', 'qr-1001.png');

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows warning and disables download without QR data', () => {
    render(<DetailQrDialog open onClose={() => {}} text="" />);

    expect(screen.getByText('Недостаточно данных для генерации QR-code.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Скачать PNG' })).toHaveAttribute('aria-disabled', 'true');
  });
});
