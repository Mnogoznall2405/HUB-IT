import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listReview, fetchContent, verifyPhoto, rejectPhoto } = vi.hoisted(() => ({
  listReview: vi.fn(),
  fetchContent: vi.fn(),
  verifyPhoto: vi.fn(),
  rejectPhoto: vi.fn(),
}));

vi.mock('../../api/equipmentPhotoReview', () => ({
  equipmentPhotoReviewAPI: { list: listReview },
}));
vi.mock('../../api/equipmentPhotos', () => ({
  equipmentPhotosAPI: { fetchContent, verify: verifyPhoto, reject: rejectPhoto },
}));

import EquipmentPhotoReviewDialog from './EquipmentPhotoReviewDialog';

const REJECTED_ROW = {
  status: 'rejected',
  item_id: 11,
  file_no: 101,
  inv_no: 'INV-11',
  model_name: 'Принтер HP',
  employee_name: 'Иванов И.И.',
  reject_reason: 'Размытое фото',
  rejected_by: 'Проверяющий',
  is_own: false,
};
const UNCHECKED_ROW = {
  status: 'unchecked',
  item_id: 22,
  file_no: 202,
  inv_no: 'INV-22',
  model_name: 'Монитор Dell',
  employee_name: 'Петров П.П.',
  uploaded_by_name: 'Сидоров',
  is_own: false,
};

const page = (items) => ({
  items, total: items.length, offset: 0, limit: 30, reject_supported: true, scan_capped: false, since_days: 30,
});

beforeEach(() => {
  vi.clearAllMocks();
  window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  window.URL.revokeObjectURL = vi.fn();
  fetchContent.mockResolvedValue({ data: new Blob(['x'], { type: 'image/jpeg' }) });
  listReview.mockImplementation(async ({ status }) => (
    status === 'unchecked' ? page([UNCHECKED_ROW]) : page([REJECTED_ROW])
  ));
});

describe('EquipmentPhotoReviewDialog', () => {
  it('shows rejected photos with the reason and opens the card on the photos tab', async () => {
    const onOpenEquipment = vi.fn();
    render(<EquipmentPhotoReviewDialog open onClose={vi.fn()} onOpenEquipment={onOpenEquipment} />);

    expect(await screen.findByText('INV-11 · Принтер HP')).toBeTruthy();
    expect(screen.getByText(/Отклонено: Размытое фото/)).toBeTruthy();
    // У отклонённого фото нет кнопок решения — оно ждёт исправления загрузившим.
    expect(screen.queryByRole('button', { name: 'Проверено' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Открыть карточку' }));
    expect(onOpenEquipment).toHaveBeenCalledWith('INV-11');
  });

  it('keeps the chosen tab and re-reads the queue when the user comes back from a card', async () => {
    const { rerender } = render(<EquipmentPhotoReviewDialog open reloadToken={0} onClose={vi.fn()} />);
    await screen.findByText('INV-11 · Принтер HP');
    fireEvent.click(screen.getByRole('tab', { name: /Не проверено/ }));
    expect(await screen.findByText('INV-22 · Монитор Dell')).toBeTruthy();
    listReview.mockClear();
    listReview.mockImplementation(async () => page([]));

    rerender(<EquipmentPhotoReviewDialog open reloadToken={1} onClose={vi.fn()} />);

    // Same tab, fresh data: the photo that was handled in the card is gone from the queue.
    await waitFor(() => expect(listReview).toHaveBeenCalledWith(expect.objectContaining({ status: 'unchecked' })));
    await waitFor(() => expect(screen.queryByText('INV-22 · Монитор Dell')).toBeNull());
  });

  it('verifies an unchecked photo and drops it from the queue', async () => {
    verifyPhoto.mockResolvedValue({ file_no: 202, verified: true });
    const onChanged = vi.fn();
    render(<EquipmentPhotoReviewDialog open onClose={vi.fn()} onChanged={onChanged} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Не проверено' }));
    expect(await screen.findByText('INV-22 · Монитор Dell')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Проверено' }));

    await waitFor(() => expect(verifyPhoto).toHaveBeenCalledWith(22, 202, {}));
    await waitFor(() => expect(screen.queryByText('INV-22 · Монитор Dell')).toBeNull());
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('rejects an unchecked photo with a chip reason', async () => {
    rejectPhoto.mockResolvedValue({ file_no: 202, rejected: true, reject_reason: 'Не виден серийный номер' });
    render(<EquipmentPhotoReviewDialog open onClose={vi.fn()} initialStatus="unchecked" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Отклонить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Отклонить фото?' });
    const submit = within(dialog).getByRole('button', { name: 'Отклонить' });
    expect(submit.disabled).toBe(true);
    fireEvent.click(within(dialog).getByText('Не виден серийный номер'));
    fireEvent.click(submit);

    await waitFor(() => expect(rejectPhoto).toHaveBeenCalledWith(22, 202, 'Не виден серийный номер', {}));
    await waitFor(() => expect(screen.queryByText('INV-22 · Монитор Dell')).toBeNull());
  });

  it('shows the server error and keeps the row when the decision fails', async () => {
    verifyPhoto.mockRejectedValue({ response: { data: { detail: 'Нельзя проверить своё фото' } } });
    render(<EquipmentPhotoReviewDialog open onClose={vi.fn()} initialStatus="unchecked" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Проверено' }));

    expect(await screen.findByText('Нельзя проверить своё фото')).toBeTruthy();
    expect(screen.getByText('INV-22 · Монитор Dell')).toBeTruthy();
  });
});
