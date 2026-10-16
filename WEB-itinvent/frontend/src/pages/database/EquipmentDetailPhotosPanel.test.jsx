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

    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledWith(10, file, { params: {} }));
    expect(await screen.findByText('Фотографий: 1')).toBeTruthy();
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

    const retry = await screen.findByRole('button', { name: 'Повторить загрузку (1)' });
    fireEvent.click(retry);

    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(2));
    expect(uploadPhoto).toHaveBeenLastCalledWith(10, file, { params: {} });
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
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledWith(10, shot, { params: {} }));
    expect(rotateFile).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Проверьте снимок' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Следующий QR' }));
    expect(onScanNext).toHaveBeenCalledTimes(1);
  });

  it('uploads several selected files in order and reports the ones that failed', async () => {
    listPhotos
      .mockResolvedValueOnce({ item_id: 10, photos: [] })
      .mockResolvedValueOnce({ item_id: 10, photos: [PHOTO] });
    uploadPhoto
      .mockResolvedValueOnce({ file_no: 1 })
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce({ file_no: 3 });
    const { container } = render(<EquipmentDetailPhotosPanel itemId={10} active canWrite />);
    await screen.findByText(/Фотографий пока нет/);

    const input = container.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('multiple');
    const files = ['a.jpg', 'b.jpg', 'c.jpg'].map((name) => new File(['x'], name, { type: 'image/jpeg' }));
    fireEvent.change(input, { target: { files } });

    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(3));
    expect(uploadPhoto.mock.calls.map((call) => call[1].name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(await screen.findByText(/Не загружено 1 из 3/)).toBeTruthy();
    // Список перечитывается один раз по окончании пачки.
    expect(listPhotos).toHaveBeenCalledTimes(2);
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
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledWith(10, turned, { params: {} }));
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
