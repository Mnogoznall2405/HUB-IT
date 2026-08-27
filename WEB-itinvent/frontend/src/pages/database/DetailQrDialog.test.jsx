import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DetailQrDialog from './DetailQrDialog';
import { buildEquipmentQrLabelDataUrl } from './equipmentQrLabel';

vi.mock('./equipmentQrLabel', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildEquipmentQrLabelDataUrl: vi.fn(async () => 'data:image/png;base64,label'),
  };
});

describe('DetailQrDialog', () => {
  it('shows the branded equipment label and enables its PNG download', async () => {
    const onClose = vi.fn();

    render(
      <DetailQrDialog
        open
        onClose={onClose}
        url="data:image/png;base64,qr"
        text="INV: 1001"
        fileName="qr-1001.png"
        equipment={{
          INV_NO: '1001',
          SERIAL_NO: 'SN-1',
          HW_SERIAL_NO: 'HW-1',
          PART_NO: 'PN-1',
          TYPE_NAME: 'Системный блок',
          MODEL_NAME: 'OptiPlex 7010',
          VENDOR_NAME: 'Dell',
          OWNER_DISPLAY_NAME: 'Иван Петров',
          BRANCH_NAME: 'Главный офис',
          LOCATION_NAME: 'Кабинет 12',
        }}
      />
    );

    expect(screen.getByAltText('QR-код оборудования 1001')).toHaveAttribute('src', 'data:image/png;base64,qr');
    expect(screen.getByText('HUB-IT')).toBeInTheDocument();
    expect(screen.queryByText('Модель')).not.toBeInTheDocument();
    expect(screen.queryByText('OptiPlex 7010')).not.toBeInTheDocument();
    expect(screen.getByText('СЕРИЙНЫЙ НОМЕР')).toBeInTheDocument();
    expect(screen.getByText('SN-1')).toBeInTheDocument();
    expect(screen.queryByText('HW-1')).not.toBeInTheDocument();
    expect(screen.queryByText('PN-1')).not.toBeInTheDocument();
    expect(screen.queryByText('Иван Петров')).not.toBeInTheDocument();
    expect(screen.queryByText('Главный офис / Кабинет 12')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ссылка в QR-коде')).toHaveValue('INV: 1001');

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Скачать этикетку PNG' })).toHaveAttribute(
        'href',
        'data:image/png;base64,label'
      );
    });
    expect(screen.getByRole('link', { name: 'Скачать этикетку PNG' })).toHaveAttribute('download', 'qr-1001.png');
    expect(buildEquipmentQrLabelDataUrl).toHaveBeenCalledWith(expect.objectContaining({
      qrDataUrl: 'data:image/png;base64,qr',
      equipment: expect.objectContaining({ INV_NO: '1001', SERIAL_NO: 'SN-1' }),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows warning and disables download without QR data', () => {
    render(<DetailQrDialog open onClose={() => {}} text="" />);

    expect(screen.getByText('Недостаточно данных для генерации QR-кода.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Скачать этикетку PNG' })).toHaveAttribute('aria-disabled', 'true');
  });
});
