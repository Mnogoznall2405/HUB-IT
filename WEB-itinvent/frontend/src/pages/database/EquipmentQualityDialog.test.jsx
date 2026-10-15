import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  summary, issues, exportCsv, ocrSummary, ocrRun,
} = vi.hoisted(() => ({
  summary: vi.fn(),
  issues: vi.fn(),
  exportCsv: vi.fn(),
  ocrSummary: vi.fn(),
  ocrRun: vi.fn(),
}));

vi.mock('../../api/equipmentQuality', () => ({
  equipmentQualityAPI: { summary, issues, exportCsv },
}));

vi.mock('../../api/equipmentPhotoOcr', () => ({
  equipmentPhotoOcrAPI: { summary: ocrSummary, run: ocrRun },
}));

import EquipmentQualityDialog from './EquipmentQualityDialog';

const SUMMARY = {
  total: 200,
  as_of: '2026-10-15T08:00:00+00:00',
  cached: false,
  rules: [
    { rule: 'no_photo', title: 'Нет фото', description: 'У позиции нет ни одной фотографии.', severity: 'warning', count: 12, total: 200, pct: 6.0, status: 'ok' },
    { rule: 'duplicate_serial', title: 'Дубли серийных номеров', description: 'Один серийный номер у нескольких позиций.', severity: 'error', count: 0, total: 200, pct: 0.0, status: 'ok' },
    { rule: 'dismissed_owner', title: 'Владелец не найден в справочнике', description: 'Вероятно, уволен.', severity: 'error', count: null, total: 200, pct: null, status: 'unknown' },
  ],
};

const ISSUE = {
  item_id: 7, inv_no: 'INV-7', serial_no: 'SN-7', type_name: 'Ноутбук', model_name: 'ThinkPad',
  employee_name: 'Иванов Иван', branch_name: 'Главный', location_name: 'Каб. 101',
};

const OCR = {
  enabled: true,
  configured: true,
  store_available: true,
  model: 'm',
  photos_total: 500,
  analyzed: 120,
  pending: 380,
  items_confirmed: 80,
  items_similar: 6,
  items_mismatch: 4,
  run: { running: false, done: 0, planned: 0, errors: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  ocrSummary.mockResolvedValue(OCR);
  ocrRun.mockResolvedValue({ started: true });
  summary.mockResolvedValue(SUMMARY);
  issues.mockResolvedValue({ rule: 'no_photo', items: [ISSUE], total: 1, offset: 0, limit: 50, status: 'ok' });
  window.URL.createObjectURL = vi.fn(() => 'blob:csv');
  window.URL.revokeObjectURL = vi.fn();
});

describe('EquipmentQualityDialog', () => {
  it('shows rule tiles, marks unknown rules and keeps them closed', async () => {
    render(<EquipmentQualityDialog open onClose={vi.fn()} />);

    const photoTile = await screen.findByTestId('quality-rule-no_photo');
    expect(within(photoTile).getByText('12')).toBeTruthy();
    expect(within(screen.getByTestId('quality-rule-duplicate_serial')).getByText('Всё чисто')).toBeTruthy();

    // Not computed rule is "—", never a false "0 / всё чисто", and cannot be opened.
    const unknownTile = screen.getByTestId('quality-rule-dismissed_owner');
    expect(within(unknownTile).getByText('—')).toBeTruthy();
    expect(unknownTile.disabled).toBe(true);
  });

  it('opens a rule, searches, and opens the card on the right tab', async () => {
    const onOpenEquipment = vi.fn();
    render(<EquipmentQualityDialog open onClose={vi.fn()} onOpenEquipment={onOpenEquipment} />);

    fireEvent.click(await screen.findByTestId('quality-rule-no_photo'));
    expect(await screen.findByText('INV-7 · ThinkPad')).toBeTruthy();
    expect(issues).toHaveBeenCalledWith(expect.objectContaining({ rule: 'no_photo', offset: 0 }));

    fireEvent.change(screen.getByPlaceholderText(/Инв. номер/), { target: { value: 'INV-7' } });
    await waitFor(() => expect(issues).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'INV-7' })));

    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(onOpenEquipment).toHaveBeenCalledWith('INV-7', { initialTab: 'photos' });
  });

  it('refreshes the counters on demand and reports a failed load', async () => {
    summary.mockRejectedValueOnce({ response: { data: { detail: 'Панель качества данных временно недоступна' } } });
    render(<EquipmentQualityDialog open onClose={vi.fn()} />);

    expect(await screen.findByText('Панель качества данных временно недоступна')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Пересчитать' }));
    await waitFor(() => expect(summary).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true })));
    expect(await screen.findByTestId('quality-rule-no_photo')).toBeTruthy();
  });

  it('shows photo recognition coverage and lets only an administrator start a batch', async () => {
    const { unmount } = render(<EquipmentQualityDialog open onClose={vi.fn()} />);
    const panel = await screen.findByTestId('quality-ocr-panel');
    expect(within(panel).getByText(/Распознано фото: 120 из 500/)).toBeTruthy();
    expect(within(panel).getByText(/подтверждено по фото: 80/)).toBeTruthy();
    expect(within(panel).getByText(/на проверку глазами: 10/)).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: /Распознать ещё/ })).toBeNull();
    unmount();

    render(<EquipmentQualityDialog open isAdmin onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Распознать ещё 100 фото' }));
    await waitFor(() => expect(ocrRun).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 })));
    expect(await screen.findByText(/Идёт распознавание/)).toBeTruthy();
  });

  it('lists what the photo says and opens the card on the photos tab for a photo rule', async () => {
    summary.mockResolvedValue({
      ...SUMMARY,
      rules: [
        ...SUMMARY.rules,
        { rule: 'serial_photo_mismatch', title: 'Серийник не совпал с фото', description: 'Сверьте по фото.', severity: 'error', count: 1, total: 200, pct: 0.5, status: 'ok' },
      ],
    });
    issues.mockResolvedValue({
      rule: 'serial_photo_mismatch', items: [{ ...ISSUE, note: 'На фото: ABC-999' }], total: 1, offset: 0, limit: 50, status: 'ok',
    });
    const onOpenEquipment = vi.fn();
    render(<EquipmentQualityDialog open onClose={vi.fn()} onOpenEquipment={onOpenEquipment} />);

    fireEvent.click(await screen.findByTestId('quality-rule-serial_photo_mismatch'));
    expect(await screen.findByText('На фото: ABC-999')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(onOpenEquipment).toHaveBeenCalledWith('INV-7', { initialTab: 'photos' });
  });

  it('stays on the opened rule and its search when the user comes back from a card', async () => {
    const { rerender } = render(<EquipmentQualityDialog open reloadToken={0} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('quality-rule-no_photo'));
    await screen.findByText('INV-7 · ThinkPad');
    fireEvent.change(screen.getByPlaceholderText(/Инв. номер/), { target: { value: 'INV-7' } });
    await waitFor(() => expect(issues).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'INV-7' })));
    issues.mockClear();
    issues.mockResolvedValue({ rule: 'no_photo', items: [], total: 0, offset: 0, limit: 50, status: 'ok' });

    rerender(<EquipmentQualityDialog open reloadToken={1} onClose={vi.fn()} />);

    // Re-read in place: same rule, same search, the fixed item disappears from the list.
    await waitFor(() => expect(issues).toHaveBeenCalledWith(expect.objectContaining({ rule: 'no_photo', q: 'INV-7' })));
    expect(await screen.findByText(/Всё чисто — позиций с этой проблемой нет/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Инв. номер/).value).toBe('INV-7');
  });

  it('downloads the CSV of the open rule', async () => {
    exportCsv.mockResolvedValue(new Blob(['x'], { type: 'text/csv' }));
    render(<EquipmentQualityDialog open onClose={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('quality-rule-no_photo'));
    await screen.findByText('INV-7 · ThinkPad');
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));

    await waitFor(() => expect(exportCsv).toHaveBeenCalledWith(expect.objectContaining({ rule: 'no_photo' })));
    await waitFor(() => expect(window.URL.createObjectURL).toHaveBeenCalled());
  });
});
