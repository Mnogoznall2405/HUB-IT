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

  it('offers the consumable↔MFU pair mode and renders both scan slots', () => {
    const onStart = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <QrScannerDialog open onClose={() => {}} ready pair={{ active: false, onStart }} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Списание расходника в МФУ' }));
    expect(onStart).toHaveBeenCalledTimes(1);

    rerender(
      <QrScannerDialog
        open
        onClose={() => {}}
        ready
        pair={{
          active: true,
          consumable: { MODEL_NAME: 'CF283A', QTY: 5 },
          printer: null,
          busy: false,
          onCancel,
        }}
      />,
    );

    expect(screen.getByText('CF283A · остаток 5 шт.')).toBeInTheDocument();
    expect(screen.getByText('Сканируйте QR МФУ')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Списание расходника в МФУ' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <QrScannerDialog
        open
        onClose={() => {}}
        ready
        pair={{
          active: true,
          consumable: null,
          printer: { MODEL_NAME: 'HP LaserJet M404', INV_NO: 'INV-9' },
          busy: false,
          onCancel,
        }}
      />,
    );

    expect(screen.getByText('Сканируйте QR расходника')).toBeInTheDocument();
    expect(screen.getByText('HP LaserJet M404 · инв. INV-9')).toBeInTheDocument();
  });

  it('switches the photo-after-scan mode with one big button', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <QrScannerDialog open onClose={() => {}} ready photoMode={{ enabled: false, onChange }} />,
    );

    const toggle = screen.getByRole('switch', { name: 'После скана сразу добавить фото' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<QrScannerDialog open onClose={() => {}} ready photoMode={{ enabled: true, onChange }} />);
    expect(screen.getByRole('switch', { name: 'После скана сразу добавить фото' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('switch', { name: 'После скана сразу добавить фото' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('offers the flashlight only when the camera supports it', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<QrScannerDialog open onClose={() => {}} ready />);
    expect(screen.queryByRole('button', { name: /фонарик/ })).not.toBeInTheDocument();

    rerender(<QrScannerDialog open onClose={() => {}} ready torch={{ on: false, onToggle }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Включить фонарик' }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<QrScannerDialog open onClose={() => {}} ready torch={{ on: true, onToggle }} />);
    expect(screen.getByRole('button', { name: 'Выключить фонарик' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lets the user retry camera access right under the error', () => {
    const onRetry = vi.fn();
    render(<QrScannerDialog open onClose={() => {}} onRetry={onRetry} error="Нет доступа к камере" />);

    fireEvent.click(screen.getByRole('button', { name: 'Разрешить доступ к камере' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
