import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Dialog } from '@mui/material';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listPhotos, fetchContent, uploadPhoto, removePhoto, verifyPhoto, rejectPhoto, updateReason, unverifyPhoto,
  rotatePhoto, rotateFile,
} = vi.hoisted(() => ({
  rotatePhoto: vi.fn(),
  rotateFile: vi.fn(),
  updateReason: vi.fn(),
  listPhotos: vi.fn(),
  verifyPhoto: vi.fn(),
  rejectPhoto: vi.fn(),
  unverifyPhoto: vi.fn(),
  fetchContent: vi.fn(),
  uploadPhoto: vi.fn(),
  removePhoto: vi.fn(),
}));

vi.mock('../../api/equipmentPhotos', () => ({
  equipmentPhotosAPI: {
    list: listPhotos,
    fetchContent,
    upload: uploadPhoto,
    remove: removePhoto,
    verify: verifyPhoto,
    reject: rejectPhoto,
    updateRejectReason: updateReason,
    rotate: rotatePhoto,
    unverify: unverifyPhoto,
  },
}));

vi.mock('./photoRotate', () => ({ rotateImageFile: rotateFile }));

import EquipmentDetailPhotosPanel from './EquipmentDetailPhotosPanel';
import { resetPhotoUploadQueue } from '../../lib/photoUploadQueue';

const PHOTO = {
  file_no: 42,
  file_name: 'photo_1.jpg',
  description: 'Фронт',
  size_mb: 1.2,
  has_thumb: true,
  created_at: '2026-10-07 12:00:00',
  created_by: 'admin',
};

beforeEach(() => {
  vi.clearAllMocks();
  resetPhotoUploadQueue();
  // The queue sends only under the signed-in owner of a shot, as in a real session.
  localStorage.setItem('user', JSON.stringify({ id: 15 }));
  window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  window.URL.revokeObjectURL = vi.fn();
  fetchContent.mockResolvedValue({ data: new Blob(['x'], { type: 'image/jpeg' }) });
  listPhotos.mockResolvedValue({ item_id: 10, photos: [] });
});

describe('EquipmentDetailPhotosPanel', () => {
  it('loads and lists photos when active', async () => {
    listPhotos.mockResolvedValue({ item_id: 10, photos: [PHOTO] });
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);

    await waitFor(() => expect(listPhotos).toHaveBeenCalledWith(10, {}));
    expect(await screen.findByText('Фотографий: 1')).toBeTruthy();
    expect(fetchContent).toHaveBeenCalledWith(10, 42, { thumb: true, params: {}, rev: 0 });
    expect(window.URL.createObjectURL).toHaveBeenCalled();
  });

  it('tells whether the recorded serial is confirmed by a photo, and what the doubtful photo says', async () => {
    listPhotos.mockResolvedValue({
      item_id: 10,
      photos: [
        { ...PHOTO, file_no: 1, ocr_verdict: 'match', ocr_serials: ['SN-1'] },
        { ...PHOTO, file_no: 2, ocr_verdict: 'no_label', ocr_serials: [] },
      ],
    });
    const { unmount } = render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);
    expect(await screen.findByText(/подтверждён по фото/)).toBeTruthy();
    unmount();

    listPhotos.mockResolvedValue({
      item_id: 10,
      photos: [{ ...PHOTO, ocr_verdict: 'mismatch', ocr_serials: ['QQQ-111'] }],
    });
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);
    expect(await screen.findByText(/не совпал с записанным/)).toBeTruthy();
    expect(screen.queryByText(/подтверждён по фото/)).toBeNull();
  });

  it('does not warn about the serial once a person has checked the doubtful photo', async () => {
    listPhotos.mockResolvedValue({
      item_id: 10,
      verification_available: true,
      photos: [{
        ...PHOTO, verified: true, verified_by: 'Проверяющий', ocr_verdict: 'similar', ocr_serials: ['SN-1O'],
      }],
    });
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);

    expect(await screen.findByText(/Проверено: Проверяющий/)).toBeTruthy();
    expect(screen.queryByTestId('photo-serial-notice')).toBeNull();
    expect(screen.queryByTestId('photo-ocr-line')).toBeNull();
  });

  it('shows empty state and hides upload for read-only users', async () => {
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite={false} />);

    expect(await screen.findByText(/Фотографий пока нет/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Добавить фото' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Удалить фото/ })).toBeNull();
  });

  it('does not fetch while inactive', () => {
    render(<EquipmentDetailPhotosPanel itemId={10} active={false} canWrite />);
    expect(listPhotos).not.toHaveBeenCalled();
  });

  it('uploads a selected file and reloads the list', async () => {
    listPhotos
      .mockResolvedValueOnce({ item_id: 10, photos: [] })
      .mockResolvedValueOnce({ item_id: 10, photos: [PHOTO] });
    uploadPhoto.mockResolvedValue({ file_no: 42, item_id: 10, file_name: 'photo_1.jpg' });
    const { container } = render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);
    await screen.findByText(/Фотографий пока нет/);

    const input = container.querySelector('input[type="file"]');
    const file = new File(['img'], 'photo_1.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledWith(10, file, expect.objectContaining({ params: {} })));
    expect(await screen.findByText('Фотографий: 1')).toBeTruthy();
    expect(screen.queryByTestId('photo-pending-card')).toBeNull();
  });

  it('shows a shot at once while it uploads and lets the user move on to the next item', async () => {
    let finish;
    uploadPhoto.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { container, rerender } = render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);
    await screen.findByText(/Фотографий пока нет/);

    const file = new File(['img'], 'photo_3.jpg', { type: 'image/jpeg' });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    // Снимок виден сразу, кнопки не заблокированы — можно снимать следующее.
    expect(await screen.findByTestId('photo-pending-card')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сделать фото' })).not.toBeDisabled();

    rerender(<EquipmentDetailPhotosPanel itemId={11} active canWrite />);
    expect(await screen.findByTestId('photo-queue-elsewhere')).toHaveTextContent('1');
    expect(screen.queryByTestId('photo-pending-card')).toBeNull();

    finish({ file_no: 45, item_id: 10, file_name: 'photo_3.jpg' });
    await waitFor(() => expect(screen.queryByTestId('photo-queue-elsewhere')).toBeNull());
  });

  it('keeps a file that did not go through on a dropped link and resumes it on retry', async () => {
    listPhotos.mockResolvedValue({ item_id: 10, photos: [] });
    uploadPhoto
      .mockRejectedValueOnce(Object.assign(new Error('Network Error'), { isAxiosError: true }))
      .mockResolvedValueOnce({ file_no: 44, item_id: 10, file_name: 'photo_2.jpg' });
    const { container } = render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);
    await screen.findByText(/Фотографий пока нет/);

    const file = new File(['img'], 'photo_2.jpg', { type: 'image/jpeg' });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });

    expect(await screen.findByText('Нет связи — повторим сами')).toBeTruthy();
    const retry = await screen.findByRole('button', { name: 'Повторить загрузку (1)' });
    fireEvent.click(retry);

    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(2));
    expect(uploadPhoto).toHaveBeenLastCalledWith(10, file, expect.objectContaining({ params: {} }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Повторить загрузку/ })).toBeNull());
  });

  it('uploads a camera shot straight away and offers the next QR scan', async () => {
    uploadPhoto.mockResolvedValue({ file_no: 43, item_id: 10, file_name: 'shot.jpg' });
    const onScanNext = vi.fn();
    const onCountChange = vi.fn();
    render(
      <EquipmentDetailPhotosPanel
        itemId={10}
        active
        canWrite
        onScanNext={onScanNext}
        onCountChange={onCountChange}
      />,
    );
    await screen.findByText(/Фотографий пока нет/);

    const cameraInput = screen.getByTestId('equipment-photo-camera-input');
    expect(cameraInput).toHaveAttribute('capture', 'environment');
    const shot = new File(['img'], 'shot.jpg', { type: 'image/jpeg' });
    fireEvent.change(cameraInput, { target: { files: [shot] } });
    // Снимок сначала показывается; без поворота уходит исходный файл.
    const dialog = await screen.findByRole('dialog', { name: 'Проверьте снимок' });
    expect(uploadPhoto).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }));
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledWith(10, shot, expect.objectContaining({ params: {} })));
    expect(rotateFile).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Проверьте снимок' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Следующий QR' }));
    expect(onScanNext).toHaveBeenCalledTimes(1);
  });

  it('uploads several selected files in order and keeps the refused one with its reason', async () => {
    listPhotos
      .mockResolvedValueOnce({ item_id: 10, photos: [] })
      .mockResolvedValue({ item_id: 10, photos: [PHOTO] });
    uploadPhoto
      .mockResolvedValueOnce({ file_no: 1 })
      .mockRejectedValueOnce({ response: { status: 400, data: { detail: 'Файл не принят' } } })
      .mockResolvedValueOnce({ file_no: 3 });
    const { container } = render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);
    await screen.findByText(/Фотографий пока нет/);

    const input = container.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('multiple');
    const files = ['a.jpg', 'b.jpg', 'c.jpg'].map((name) => new File(['x'], name, { type: 'image/jpeg' }));
    fireEvent.change(input, { target: { files } });

    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(3));
    expect(uploadPhoto.mock.calls.map((call) => call[1].name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    // Отказ сервера повтором не лечится: фото остаётся в очереди с причиной, остальные доехали.
    expect(await screen.findByText('Файл не принят')).toBeTruthy();
    expect(screen.getAllByTestId('photo-pending-card')).toHaveLength(1);
    expect(await screen.findByText('Фотографий: 1')).toBeTruthy();
  });

  it('takes a series of shots with the live camera and queues each one at once', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    const videoWidth = vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(4000);
    const videoHeight = vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(3000);
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() });
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlobMock(callback) {
      callback(new Blob([`frame-${this.width}x${this.height}`], { type: 'image/jpeg' }));
    });
    uploadPhoto.mockResolvedValue({ file_no: 50 });
    try {
      render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);
      await screen.findByText(/Фотографий пока нет/);

      fireEvent.click(screen.getByRole('button', { name: 'Серия' }));
      const shutter = await screen.findByRole('button', { name: 'Сделать снимок' });
      await waitFor(() => expect(shutter).not.toBeDisabled());
      fireEvent.click(shutter);
      await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(shutter).not.toBeDisabled());
      fireEvent.click(shutter);
      await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(2));

      expect(await screen.findByText('Снято: 2')).toBeTruthy();
      // Кадр режется до 2560 px по длинной стороне и уходит без подтверждения.
      const [, sent] = uploadPhoto.mock.calls[0];
      expect(sent.type).toBe('image/jpeg');
      const content = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(sent); });
      expect(content).toBe('frame-2560x1920');

      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
      await waitFor(() => expect(stop).toHaveBeenCalled());
    } finally {
      videoWidth.mockRestore();
      videoHeight.mockRestore();
      context.mockRestore();
      toBlob.mockRestore();
      delete navigator.mediaDevices;
    }
  });

  it('rejects files over the size limit without calling the API', async () => {
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);
    await screen.findByText(/Фотографий пока нет/);

    const input = document.querySelector('input[type="file"]');
    const bigFile = { size: 16 * 1024 * 1024, name: 'big.jpg', type: 'image/jpeg' };
    fireEvent.change(input, { target: { files: [bigFile] } });

    expect(await screen.findByText(/больше 15 МБ/)).toBeTruthy();
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it('deletes a photo after confirmation', async () => {
    listPhotos.mockResolvedValue({ item_id: 10, photos: [PHOTO] });
    removePhoto.mockResolvedValue({ ok: true });
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);
    await screen.findByText('Фотографий: 1');

    fireEvent.click(screen.getByRole('button', { name: /Удалить фото photo_1\.jpg/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(removePhoto).toHaveBeenCalledWith(10, 42, {}));
    expect(await screen.findByText(/Фотографий пока нет/)).toBeTruthy();
  });

  it('lets another user verify a photo but not the uploader, and reports the verified count', async () => {
    const own = {
      ...PHOTO, file_no: 41, file_name: 'own.jpg', can_verify: false, can_reject: false, is_own: true,
    };
    const foreign = {
      ...PHOTO, file_no: 42, file_name: 'foreign.jpg', can_verify: true, can_reject: true,
    };
    listPhotos.mockResolvedValue({ item_id: 10, photos: [own, foreign], verification_available: true, verify_permitted: true });
    verifyPhoto.mockResolvedValue({
      file_no: 42, verified: true, verified_by: 'Иван Петров', verified_at: '2026-10-12T10:00:00+00:00',
    });
    const onCountChange = vi.fn();
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite onCountChange={onCountChange} />);

    await screen.findByText('Фотографий: 2');
    expect(onCountChange).toHaveBeenLastCalledWith(2, 0, 0);
    // Своё фото подтвердить нельзя: кнопки нет, причина показана.
    expect(screen.queryByRole('button', { name: 'Подтвердить фото own.jpg' })).toBeNull();
    expect(screen.getByText('Загрузили вы — проверит другой')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить фото foreign.jpg' }));

    await waitFor(() => expect(verifyPhoto).toHaveBeenCalledWith(10, 42, {}));
    expect(await screen.findByText('Проверено: Иван Петров')).toBeTruthy();
    expect(onCountChange).toHaveBeenLastCalledWith(2, 1, 0);
    expect(screen.queryByRole('button', { name: 'Подтвердить фото foreign.jpg' })).toBeNull();
  });

  it('verifies right from the photo preview', async () => {
    listPhotos.mockResolvedValue({
      item_id: 10,
      photos: [{ ...PHOTO, file_name: 'foreign.jpg', can_verify: true }],
      verification_available: true,
      verify_permitted: true,
    });
    verifyPhoto.mockResolvedValue({ file_no: 42, verified: true, verified_by: 'Иван Петров', verified_at: null });
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть фото foreign.jpg' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Подтвердить фото foreign.jpg' }));

    await waitFor(() => expect(verifyPhoto).toHaveBeenCalledWith(10, 42, {}));
    expect(await within(dialog).findByText('Проверено: Иван Петров')).toBeTruthy();
  });

  it('shows the server refusal when verification fails', async () => {
    listPhotos.mockResolvedValue({
      item_id: 10, photos: [{ ...PHOTO, can_verify: true }], verification_available: true, verify_permitted: true,
    });
    verifyPhoto.mockRejectedValue({ response: { data: { detail: 'Нельзя подтвердить фото, которое загрузили вы' } } });
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);

    fireEvent.click(await screen.findByRole('button', { name: /Подтвердить фото/ }));

    expect(await screen.findByText('Нельзя подтвердить фото, которое загрузили вы')).toBeTruthy();
    expect(screen.queryByText(/Проверено:/)).toBeNull();
  });

  it('shows the plate but no verify controls to a user without the check right', async () => {
    listPhotos.mockResolvedValue({
      item_id: 10,
      photos: [
        {
          ...PHOTO, file_no: 41, file_name: 'plain.jpg', can_verify: false, is_own: true,
        },
        {
          ...PHOTO, file_no: 42, file_name: 'done.jpg', verified: true, verified_by: 'Иван Петров', can_unverify: false,
        },
      ],
      verification_available: true,
      verify_permitted: false,
    });
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);

    expect(await screen.findByText('Проверено: Иван Петров')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Подтвердить фото/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Снять отметку/ })).toBeNull();
    expect(screen.queryByText('Загрузили вы — проверит другой')).toBeNull();
  });

  it('hides verification controls until the server enables the check', async () => {
    listPhotos.mockResolvedValue({
      item_id: 10, photos: [{ ...PHOTO, can_verify: false }], verification_available: false,
    });
    const onCountChange = vi.fn();
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite onCountChange={onCountChange} />);

    await screen.findByText('Фотографий: 1');
    expect(screen.queryByRole('button', { name: /Подтвердить фото/ })).toBeNull();
    expect(screen.queryByText('Загрузили вы — проверит другой')).toBeNull();
    // Неизвестное «проверено» не превращается в 0 и не затирает отметку в списке.
    expect(onCountChange).toHaveBeenLastCalledWith(1, null, null);
  });

  it('rejects a photo with a written reason and reports the rejected count', async () => {
    const photo = {
      ...PHOTO, file_name: 'foreign.jpg', can_verify: true, can_reject: true,
    };
    listPhotos.mockResolvedValue({
      item_id: 10, photos: [photo], verification_available: true, verify_permitted: true,
    });
    rejectPhoto.mockResolvedValue({
      file_no: 42, rejected: true, rejected_by: 'Иван Петров', rejected_at: null, reject_reason: 'Размыто, не видно номер',
    });
    const onCountChange = vi.fn();
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite onCountChange={onCountChange} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Отклонить фото foreign.jpg' }));
    const dialog = await screen.findByRole('dialog', { name: 'Отклонить фото?' });
    const submit = within(dialog).getByRole('button', { name: 'Отклонить' });
    // Без причины отказать нельзя.
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Причина отказа'), { target: { value: '  Размыто, не видно номер ' } });
    fireEvent.click(submit);

    await waitFor(() => expect(rejectPhoto).toHaveBeenCalledWith(10, 42, 'Размыто, не видно номер', {}));
    expect(await screen.findByText('Отклонено: Размыто, не видно номер')).toBeTruthy();
    expect(onCountChange).toHaveBeenLastCalledWith(1, 0, 1);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Отклонить фото?' })).toBeNull());
    // Отклонённое фото повторно не отклоняется, но отметку можно снять.
    expect(screen.queryByRole('button', { name: 'Отклонить фото foreign.jpg' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Снять отметку проверки с фото foreign.jpg' })).toBeTruthy();
  });

  it('fills the reject reason from quick chips and keeps typed text', async () => {
    const photo = {
      ...PHOTO, file_name: 'foreign.jpg', can_verify: true, can_reject: true,
    };
    listPhotos.mockResolvedValue({
      item_id: 10, photos: [photo], verification_available: true, verify_permitted: true,
    });
    rejectPhoto.mockResolvedValue({
      file_no: 42, rejected: true, rejected_by: 'Иван Петров', rejected_at: null, reject_reason: 'Размытое фото; Плохое освещение',
    });
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);

    fireEvent.click(await screen.findByRole('button', { name: 'Отклонить фото foreign.jpg' }));
    const dialog = await screen.findByRole('dialog', { name: 'Отклонить фото?' });
    fireEvent.click(within(dialog).getByText('Размытое фото'));
    fireEvent.click(within(dialog).getByText('Плохое освещение'));
    expect(within(dialog).getByLabelText('Причина отказа').value).toBe('Размытое фото; Плохое освещение');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отклонить' }));

    await waitFor(() => expect(rejectPhoto).toHaveBeenCalledWith(10, 42, 'Размытое фото; Плохое освещение', {}));
  });

  it('lets the rejecter edit the reason text without withdrawing the mark', async () => {
    listPhotos.mockResolvedValue({
      item_id: 10,
      photos: [{
        ...PHOTO, file_name: 'foreign.jpg', rejected: true, rejected_by: 'Иван Петров', reject_reason: 'Размыто',
        can_reject: false, can_unverify: true,
      }],
      verification_available: true,
      verify_permitted: true,
    });
    updateReason.mockResolvedValue({
      file_no: 42, rejected: true, rejected_by: 'Иван Петров', rejected_at: null, reject_reason: 'Не видно инвентарный номер',
    });
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);

    fireEvent.click(await screen.findByRole('button', { name: 'Изменить причину отказа для фото foreign.jpg' }));
    const dialog = await screen.findByRole('dialog', { name: 'Изменить причину отказа' });
    const field = within(dialog).getByLabelText('Причина отказа');
    expect(field.value).toBe('Размыто');
    fireEvent.change(field, { target: { value: ' Не видно инвентарный номер ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(updateReason).toHaveBeenCalledWith(10, 42, 'Не видно инвентарный номер', {}));
    expect(await screen.findByText('Отклонено: Не видно инвентарный номер')).toBeTruthy();
    expect(rejectPhoto).not.toHaveBeenCalled();
    expect(unverifyPhoto).not.toHaveBeenCalled();
  });

  it('shows the rejection reason to a user without the check right and offers no actions', async () => {
    listPhotos.mockResolvedValue({
      item_id: 10,
      photos: [{
        ...PHOTO, rejected: true, rejected_by: 'Иван Петров', reject_reason: 'Не та техника', can_reject: false, can_unverify: false,
      }],
      verification_available: true,
      verify_permitted: false,
    });
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);

    expect(await screen.findByText('Отклонено: Не та техника')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Отклонить фото/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Снять отметку/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Изменить причину/ })).toBeNull();
  });

  it('rotates a camera shot before upload and uploads the turned file', async () => {
    uploadPhoto.mockResolvedValue({ file_no: 43, item_id: 10, file_name: 'shot.jpg' });
    const turned = new File(['turned'], 'shot.jpg', { type: 'image/jpeg' });
    rotateFile.mockResolvedValue(turned);
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);
    await screen.findByText(/Фотографий пока нет/);

    const shot = new File(['img'], 'shot.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('equipment-photo-camera-input'), { target: { files: [shot] } });
    const dialog = await screen.findByRole('dialog', { name: 'Проверьте снимок' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Повернуть снимок вправо' }));
    await waitFor(() => expect(rotateFile).toHaveBeenCalledWith(shot, 90));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Повернуть снимок вправо' }));
    // Всегда от исходного файла и по накопленному углу.
    await waitFor(() => expect(rotateFile).toHaveBeenLastCalledWith(shot, 180));

    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Загрузить' })).not.toBeDisabled());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить' }));
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledWith(10, turned, expect.objectContaining({ params: {} })));
  });

  it('discards a camera shot on cancel without uploading', async () => {
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);
    await screen.findByText(/Фотографий пока нет/);
    fireEvent.change(screen.getByTestId('equipment-photo-camera-input'), {
      target: { files: [new File(['img'], 'shot.jpg', { type: 'image/jpeg' })] },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Проверьте снимок' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Проверьте снимок' })).toBeNull());
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it('rotates a stored photo on the server from the card and from the preview', async () => {
    listPhotos.mockResolvedValue({ item_id: 10, photos: [{ ...PHOTO, file_name: 'side.jpg' }] });
    rotatePhoto.mockResolvedValue({ ok: true, file_no: 42 });
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);

    fireEvent.click(await screen.findByRole('button', { name: 'Повернуть фото side.jpg' }));
    await waitFor(() => expect(rotatePhoto).toHaveBeenCalledWith(10, 42, 90, {}));
    // Картинка перечитывается: контент запрашивается заново.
    // Новый URL (v=ревизия): браузер держит фото 60 с и иначе вернул бы старую картинку.
    await waitFor(() => expect(fetchContent).toHaveBeenCalledWith(10, 42, expect.objectContaining({ thumb: true, rev: 1 })));

    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото side.jpg' }));
    const preview = await screen.findByRole('dialog');
    fireEvent.click(within(preview).getByRole('button', { name: 'Повернуть влево' }));
    await waitFor(() => expect(rotatePhoto).toHaveBeenLastCalledWith(10, 42, 270, {}));
  });

  it('offers rotation to a checker without upload rights but not to a plain reader', async () => {
    listPhotos.mockResolvedValue({
      item_id: 10, photos: [PHOTO], verification_available: true, verify_permitted: true,
    });
    const { unmount } = render(<EquipmentDetailPhotosPanel itemId={10} active canWrite={false} />);
    expect(await screen.findByRole('button', { name: /Повернуть фото/ })).toBeTruthy();
    unmount();

    listPhotos.mockResolvedValue({
      item_id: 10, photos: [PHOTO], verification_available: true, verify_permitted: false,
    });
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite={false} />);
    await screen.findByText('Фотографий: 1');
    expect(screen.queryByRole('button', { name: /Повернуть фото/ })).toBeNull();
  });

  it('opens the preview dialog on card click', async () => {
    listPhotos.mockResolvedValue({ item_id: 10, photos: [PHOTO] });
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);
    await screen.findByText('Фотографий: 1');

    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото photo_1.jpg' }));
    expect(await screen.findByText('photo_1.jpg')).toBeTruthy();
    expect(fetchContent).toHaveBeenCalledWith(10, 42, { thumb: false, params: {}, rev: 0 });
  });

  it('shows an error alert when the list request fails', async () => {
    listPhotos.mockRejectedValue(new Error('network down'));
    render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);
    expect(await screen.findByText('network down')).toBeTruthy();
  });

  it('opens the photo above the parent card dialog and Esc closes only the photo', async () => {
    listPhotos.mockResolvedValue({ item_id: 10, photos: [PHOTO] });
    render(
      <Dialog
        open
        maxWidth="lg"
        fullWidth
        sx={{ zIndex: (t) => `${t.zIndex.modal + 2} !important` }}
      >
        <EquipmentDetailPhotosPanel itemId={10} active canWrite={false} />
      </Dialog>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть фото photo_1.jpg' }));
    const closeButton = await screen.findByRole('button', { name: 'Закрыть просмотр фото' });

    const [parentRoot, previewRoot] = document.querySelectorAll('.MuiModal-root');
    expect(document.querySelectorAll('.MuiModal-root')).toHaveLength(2);
    expect(previewRoot.contains(closeButton)).toBe(true);
    expect(Number(window.getComputedStyle(previewRoot).zIndex)).toBeGreaterThan(
      Number(window.getComputedStyle(parentRoot).zIndex)
    );

    fireEvent.keyDown(closeButton, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Закрыть просмотр фото' })).toBeNull();
    });
    expect(document.querySelectorAll('.MuiModal-root')).toHaveLength(1);
    expect(document.querySelector('.MuiModal-root')).toBe(parentRoot);
    expect(screen.getByRole('button', { name: 'Открыть фото photo_1.jpg' })).toBeTruthy();
  });
});
