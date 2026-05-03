import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import QrScannerDialog from './QrScannerDialog';

describe('QrScannerDialog', () => {
  it('keeps the html5-qrcode mount node and shows loading overlay', () => {
    render(<QrScannerDialog open onClose={() => {}} loading />);

    expect(document.getElementById('qr-reader')).toBeInTheDocument();
    expect(screen.getByText('Инициализация камеры...')).toBeInTheDocument();
  });

  it('shows ready, result and error states', () => {
    const { rerender } = render(<QrScannerDialog open onClose={() => {}} ready />);

    expect(screen.getByText('Камера активна. Держите QR-код в центре рамки.')).toBeInTheDocument();

    rerender(<QrScannerDialog open onClose={() => {}} result="INV: 1001" />);
    expect(screen.getByText('Распознано: INV: 1001')).toBeInTheDocument();

    rerender(<QrScannerDialog open onClose={() => {}} error="Нет доступа к камере" />);
    expect(screen.getByText('Нет доступа к камере')).toBeInTheDocument();
  });

  it('wires title close and footer close actions', () => {
    const onClose = vi.fn();

    render(<QrScannerDialog open onClose={onClose} />);

    fireEvent.click(screen.getByLabelText('close'));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
