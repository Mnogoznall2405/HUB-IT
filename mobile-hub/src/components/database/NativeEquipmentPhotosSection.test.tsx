import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AxiosError } from 'axios';
import { Alert } from 'react-native';
import {
  deleteEquipmentPhoto,
  listEquipmentPhotos,
  rejectEquipmentPhoto,
  rotateEquipmentPhoto,
  unverifyEquipmentPhoto,
  updateEquipmentPhotoRejectReason,
  uploadEquipmentPhoto,
  verifyEquipmentPhoto,
  type EquipmentPhoto,
} from '../../api/databaseApi';
import { downloadEquipmentPhoto, invalidateEquipmentPhotoCache } from '../../database/nativeDatabaseFiles';
import { rotateLocalPhoto } from '../../database/photoRotate';
import { pickNativeAttachments } from '../../files/nativeFilePicker';
import { NativeEquipmentPhotosSection } from './NativeEquipmentPhotosSection';

jest.mock('../../api/databaseApi', () => ({
  deleteEquipmentPhoto: jest.fn(),
  listEquipmentPhotos: jest.fn(),
  uploadEquipmentPhoto: jest.fn(),
  verifyEquipmentPhoto: jest.fn(),
  rejectEquipmentPhoto: jest.fn(),
  rotateEquipmentPhoto: jest.fn(),
  updateEquipmentPhotoRejectReason: jest.fn(),
  unverifyEquipmentPhoto: jest.fn(),
}));

jest.mock('../../database/nativeDatabaseFiles', () => ({
  downloadEquipmentPhoto: jest.fn(),
  invalidateEquipmentPhotoCache: jest.fn(),
}));

jest.mock('../../database/photoRotate', () => ({
  rotateLocalPhoto: jest.fn(),
  asJpegName: (name: string) => `${name.replace(/\.[^.]+$/, '')}.jpg`,
}));

jest.mock('../../files/nativeFilePicker', () => {
  const actual = jest.requireActual('../../files/nativeFilePicker');
  return {
    ...actual,
    pickNativeAttachments: jest.fn(),
    openAppPermissionSettings: jest.fn(),
  };
});

const mockedList = listEquipmentPhotos as jest.MockedFunction<typeof listEquipmentPhotos>;
const mockedUpload = uploadEquipmentPhoto as jest.MockedFunction<typeof uploadEquipmentPhoto>;
const mockedDelete = deleteEquipmentPhoto as jest.MockedFunction<typeof deleteEquipmentPhoto>;
const mockedVerify = verifyEquipmentPhoto as jest.MockedFunction<typeof verifyEquipmentPhoto>;
const mockedReject = rejectEquipmentPhoto as jest.MockedFunction<typeof rejectEquipmentPhoto>;
const mockedUpdateReason = updateEquipmentPhotoRejectReason as jest.MockedFunction<typeof updateEquipmentPhotoRejectReason>;
const mockedRotate = rotateEquipmentPhoto as jest.MockedFunction<typeof rotateEquipmentPhoto>;
const mockedRotateLocal = rotateLocalPhoto as jest.MockedFunction<typeof rotateLocalPhoto>;
const mockedInvalidate = invalidateEquipmentPhotoCache as jest.MockedFunction<typeof invalidateEquipmentPhotoCache>;
const mockedUnverify = unverifyEquipmentPhoto as jest.MockedFunction<typeof unverifyEquipmentPhoto>;
const mockedDownload = downloadEquipmentPhoto as jest.MockedFunction<typeof downloadEquipmentPhoto>;
const mockedPick = pickNativeAttachments as jest.MockedFunction<typeof pickNativeAttachments>;

const tokens = {
  primary: '#0a6',
  error: '#d00',
  textSecondary: '#666',
  textTertiary: '#999',
  panelSolid: '#fff',
  panelInset: '#eee',
  borderSoft: '#ddd',
  iconMuted: '#aaa',
} as never;

function photo(fileNo: number, name = `p${fileNo}.jpg`): EquipmentPhoto {
  return {
    file_no: fileNo,
    file_name: name,
    description: '',
    size_mb: 0.5,
    has_thumb: true,
    created_at: '2026-01-01 10:00:00',
    created_by: 'tester',
  };
}

describe('NativeEquipmentPhotosSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDownload.mockResolvedValue({ uri: 'file:///cache/photo.jpg' } as never);
    mockedList.mockResolvedValue([photo(11), photo(12)]);
  });

  it('loads and renders photo thumbnails', async () => {
    const view = await render(<NativeEquipmentPhotosSection itemId={3682} tokens={tokens} />);

    await waitFor(() => expect(view.getByText('Фотографий: 2')).toBeTruthy(), { timeout: 15000 });
    await waitFor(() => expect(mockedDownload).toHaveBeenCalledWith(
      3682, 11, expect.objectContaining({ thumb: true }),
    ));
    expect(view.getByLabelText('Открыть фото p11.jpg')).toBeTruthy();
    expect(mockedList).toHaveBeenCalledWith(3682, undefined);
  });

  it('shows an error and keeps the retry surface when listing fails', async () => {
    mockedList.mockRejectedValueOnce(new Error('offline'));
    const view = await render(<NativeEquipmentPhotosSection itemId={1} tokens={tokens} />);

    await waitFor(() => expect(view.getByText('offline')).toBeTruthy());
  });

  it('picks an image from the gallery and uploads it', async () => {
    mockedPick.mockResolvedValue([{
      uri: 'file:///picked/one.jpg',
      name: 'one.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
      source: 'gallery',
    }]);
    mockedUpload.mockResolvedValue(99);
    const view = await render(<NativeEquipmentPhotosSection itemId={7} databaseId="main" canWrite tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Фотографий: 2')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photos-add')); });
    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photo-source-gallery')); });
    await waitFor(() => expect(mockedUpload).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ uri: 'file:///picked/one.jpg' }),
      'main',
    ));
    expect(mockedPick).toHaveBeenCalledWith('gallery');
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it('keeps the shots that did not go through on a dropped link and resumes them on retry', async () => {
    mockedPick.mockResolvedValue([
      { uri: 'file:///picked/one.jpg', name: 'one.jpg', mimeType: 'image/jpeg', size: 1024, source: 'gallery' },
      { uri: 'file:///picked/two.jpg', name: 'two.jpg', mimeType: 'image/jpeg', size: 1024, source: 'gallery' },
    ]);
    mockedUpload
      .mockResolvedValueOnce(98)
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce(99);
    const view = await render(<NativeEquipmentPhotosSection itemId={7} databaseId="main" canWrite tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Фотографий: 2')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photos-add')); });
    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photo-source-gallery')); });

    // The first shot is saved; only the second one is offered again.
    await waitFor(() => expect(view.getByLabelText('Повторить загрузку фото')).toBeTruthy());
    expect(view.getByText(/Повторить загрузку \(1\)/)).toBeTruthy();

    await act(async () => { fireEvent.press(view.getByLabelText('Повторить загрузку фото')); });
    await waitFor(() => expect(mockedUpload).toHaveBeenCalledTimes(3));
    expect(mockedUpload).toHaveBeenLastCalledWith(7, expect.objectContaining({ uri: 'file:///picked/two.jpg' }), 'main');
    await waitFor(() => expect(view.queryByLabelText('Повторить загрузку фото')).toBeNull());
  });

  it('rejects an oversized picked file before upload', async () => {
    mockedPick.mockResolvedValue([{
      uri: 'file:///picked/huge.jpg',
      name: 'huge.jpg',
      mimeType: 'image/jpeg',
      size: 16 * 1024 * 1024,
      source: 'camera',
    }]);
    const view = await render(<NativeEquipmentPhotosSection itemId={7} canWrite tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Фотографий: 2')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photos-add')); });
    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photo-source-camera')); });
    await waitFor(() => expect(view.getByText(/больше 15 МБ/)).toBeTruthy());
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it('lets another user verify a photo, hides the button for the uploader and shows the plate', async () => {
    mockedList.mockResolvedValue([
      {
        ...photo(11), can_verify: false, can_reject: false, is_own: true, verification_available: true, verify_permitted: true,
      },
      { ...photo(12), can_verify: true, verification_available: true, verify_permitted: true },
    ]);
    mockedVerify.mockResolvedValue({ verified: true, verified_by: 'Иван Петров', verified_at: '2026-10-12T10:00:00+00:00' });
    const view = await render(<NativeEquipmentPhotosSection itemId={5} databaseId="db2" canWrite tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Фотографий: 2')).toBeTruthy());

    expect(view.queryByTestId('native-equipment-photo-verify-11')).toBeNull();
    expect(view.getByText('Загрузили вы — проверит другой')).toBeTruthy();

    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photo-verify-12')); });
    await waitFor(() => expect(mockedVerify).toHaveBeenCalledWith(5, 12, 'db2'));
    await waitFor(() => expect(view.getByText('Проверено: Иван Петров')).toBeTruthy());
    expect(view.queryByTestId('native-equipment-photo-verify-12')).toBeNull();
  });

  it('shows the server refusal and offers no verify controls until the check is enabled', async () => {
    mockedList.mockResolvedValue([{ ...photo(11), can_verify: true, verification_available: true, verify_permitted: true }]);
    mockedVerify.mockRejectedValue(new AxiosError(
      'Request failed with status code 403',
      'ERR_BAD_REQUEST',
      undefined,
      undefined,
      {
        status: 403,
        statusText: 'Forbidden',
        data: { detail: 'Нельзя подтвердить фото, которое загрузили вы' },
        headers: {},
        config: { headers: {} } as never,
      },
    ));
    const view = await render(<NativeEquipmentPhotosSection itemId={5} canWrite tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Фотографий: 1')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photo-verify-11')); });
    await waitFor(() => expect(mockedVerify).toHaveBeenCalledWith(5, 11, undefined));
    await waitFor(() => expect(view.getByText('Нельзя подтвердить фото, которое загрузили вы')).toBeTruthy());
    expect(view.queryByText(/Проверено/)).toBeNull();
    expect(mockedUnverify).not.toHaveBeenCalled();
  });

  it('shows no verify button to a user without the check right but keeps the plate', async () => {
    mockedList.mockResolvedValue([
      { ...photo(11), can_verify: false, verification_available: true, verify_permitted: false },
      {
        ...photo(12), verified: true, verified_by: 'Иван Петров', can_unverify: false,
        verification_available: true, verify_permitted: false,
      },
    ]);
    const view = await render(<NativeEquipmentPhotosSection itemId={5} canWrite tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Фотографий: 2')).toBeTruthy());

    expect(view.getByText('Проверено: Иван Петров')).toBeTruthy();
    expect(view.queryByTestId('native-equipment-photo-verify-11')).toBeNull();
    expect(view.queryByTestId('native-equipment-photo-unverify-12')).toBeNull();
    expect(view.queryByText('Загрузили вы — проверит другой')).toBeNull();
  });

  it('lets a checker without database.write verify a photo', async () => {
    mockedList.mockResolvedValue([
      { ...photo(11), can_verify: true, verification_available: true, verify_permitted: true },
    ]);
    mockedVerify.mockResolvedValue({ verified: true, verified_by: 'Дмитрий', verified_at: null });
    const view = await render(<NativeEquipmentPhotosSection itemId={5} canWrite={false} tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Фотографий: 1')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photo-verify-11')); });
    await waitFor(() => expect(mockedVerify).toHaveBeenCalledWith(5, 11, undefined));
    await waitFor(() => expect(view.getByText('Проверено: Дмитрий')).toBeTruthy());
  });

  it('rejects a photo with a written reason and shows the red plate', async () => {
    mockedList.mockResolvedValue([
      {
        ...photo(11), can_verify: true, can_reject: true, verification_available: true, verify_permitted: true,
      },
    ]);
    mockedReject.mockResolvedValue({
      rejected: true, rejected_by: 'Иван Петров', rejected_at: null, reject_reason: 'Размыто, не видно номер',
    });
    const view = await render(<NativeEquipmentPhotosSection itemId={5} databaseId="db2" canWrite tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Фотографий: 1')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photo-reject-11')); });
    // Пустую причину отправить нельзя.
    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photo-reject-confirm')); });
    expect(mockedReject).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.changeText(view.getByTestId('native-equipment-photo-reject-reason'), '  Размыто, не видно номер ');
    });
    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photo-reject-confirm')); });

    await waitFor(() => expect(mockedReject).toHaveBeenCalledWith(5, 11, 'Размыто, не видно номер', 'db2'));
    await waitFor(() => expect(view.getByText('Отклонено: Размыто, не видно номер')).toBeTruthy());
    expect(view.queryByTestId('native-equipment-photo-reject-11')).toBeNull();
    expect(view.getByTestId('native-equipment-photo-unverify-11')).toBeTruthy();
  });

  it('shows the rejection reason to a user without the check right and offers no actions', async () => {
    mockedList.mockResolvedValue([
      {
        ...photo(11), rejected: true, rejected_by: 'Иван Петров', reject_reason: 'Не та техника',
        can_reject: false, can_unverify: false, verification_available: true, verify_permitted: false,
      },
    ]);
    const view = await render(<NativeEquipmentPhotosSection itemId={5} canWrite tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Отклонено: Не та техника')).toBeTruthy());

    expect(view.queryByTestId('native-equipment-photo-reject-11')).toBeNull();
    expect(view.queryByTestId('native-equipment-photo-unverify-11')).toBeNull();
  });

  it('lets the rejecter edit the reason without touching the mark', async () => {
    mockedList.mockResolvedValue([
      {
        ...photo(11), rejected: true, rejected_by: 'Иван Петров', reject_reason: 'Размыто',
        can_reject: false, can_unverify: true, verification_available: true, verify_permitted: true,
      },
    ]);
    mockedUpdateReason.mockResolvedValue({
      rejected: true, rejected_by: 'Иван Петров', rejected_at: null, reject_reason: 'Не видно номер',
    });
    const view = await render(<NativeEquipmentPhotosSection itemId={5} databaseId="db2" canWrite tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Отклонено: Размыто')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photo-edit-reason-11')); });
    const input = view.getByTestId('native-equipment-photo-reject-reason');
    expect(input.props.value).toBe('Размыто');
    await act(async () => { fireEvent.changeText(input, ' Не видно номер '); });
    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photo-reject-confirm')); });

    await waitFor(() => expect(mockedUpdateReason).toHaveBeenCalledWith(5, 11, 'Не видно номер', 'db2'));
    await waitFor(() => expect(view.getByText('Отклонено: Не видно номер')).toBeTruthy());
    expect(mockedReject).not.toHaveBeenCalled();
    expect(mockedUnverify).not.toHaveBeenCalled();
  });

  it('shows a camera shot before upload and sends the turned file', async () => {
    mockedPick.mockResolvedValue([{
      uri: 'file:///cam/shot.jpg', name: 'shot.jpg', mimeType: 'image/jpeg', size: 2048, source: 'camera',
    }]);
    mockedRotateLocal.mockResolvedValue({ uri: 'file:///cam/shot-turned.jpg' });
    mockedUpload.mockResolvedValue(99);
    const view = await render(<NativeEquipmentPhotosSection itemId={7} databaseId="main" canWrite tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Фотографий: 2')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photos-add')); });
    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photo-source-camera')); });
    // Снимок сначала на экране, на сервер ещё ничего не ушло.
    await waitFor(() => expect(view.getByTestId('native-photo-rotate-confirm')).toBeTruthy());
    expect(mockedUpload).not.toHaveBeenCalled();

    await act(async () => { fireEvent.press(view.getByTestId('native-photo-rotate-right')); });
    await waitFor(() => expect(mockedRotateLocal).toHaveBeenCalledWith('file:///cam/shot.jpg', 90));
    await act(async () => { fireEvent.press(view.getByTestId('native-photo-rotate-confirm')); });

    await waitFor(() => expect(mockedUpload).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ uri: 'file:///cam/shot-turned.jpg', mimeType: 'image/jpeg' }),
      'main',
    ));
  });

  it('rotates a stored photo on the server and drops its cached files', async () => {
    mockedRotate.mockResolvedValue(undefined);
    const view = await render(<NativeEquipmentPhotosSection itemId={7} databaseId="main" canWrite tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Фотографий: 2')).toBeTruthy());
    mockedDownload.mockClear();

    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photo-rotate-11')); });

    await waitFor(() => expect(mockedRotate).toHaveBeenCalledWith(7, 11, 90, 'main'));
    expect(mockedInvalidate).toHaveBeenCalledWith(7, 11);
    // Миниатюра скачивается заново — уже повёрнутая.
    await waitFor(() => expect(mockedDownload).toHaveBeenCalledWith(7, 11, expect.objectContaining({ thumb: true })));
  });

  it('offers rotation to a checker without upload rights', async () => {
    mockedList.mockResolvedValue([{ ...photo(11), verification_available: true, verify_permitted: true }]);
    const checker = await render(<NativeEquipmentPhotosSection itemId={7} canWrite={false} tokens={tokens} />);
    await waitFor(() => expect(checker.getByText('Фотографий: 1')).toBeTruthy());
    expect(checker.getByTestId('native-equipment-photo-rotate-11')).toBeTruthy();
  });

  it('offers no rotation to a plain reader', async () => {
    mockedList.mockResolvedValue([{ ...photo(11), verification_available: true, verify_permitted: false }]);
    const reader = await render(<NativeEquipmentPhotosSection itemId={7} canWrite={false} tokens={tokens} />);
    await waitFor(() => expect(reader.getByText('Фотографий: 1')).toBeTruthy());
    expect(reader.queryByTestId('native-equipment-photo-rotate-11')).toBeNull();
  });

  it('shows no verification controls when the check table is not enabled', async () => {
    mockedList.mockResolvedValue([{ ...photo(11), can_verify: false, verification_available: false }]);
    const view = await render(<NativeEquipmentPhotosSection itemId={5} canWrite tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Фотографий: 1')).toBeTruthy());

    expect(view.queryByTestId('native-equipment-photo-verify-11')).toBeNull();
    expect(view.queryByText('Загрузили вы — проверит другой')).toBeNull();
  });

  it('deletes a photo after confirmation', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      (buttons || []).find((button) => button?.style === 'destructive')?.onPress?.();
      return 0 as never;
    });
    mockedDelete.mockResolvedValue(undefined);
    const view = await render(<NativeEquipmentPhotosSection itemId={5} databaseId="db2" canWrite tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Фотографий: 2')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByTestId('native-equipment-photo-delete-11')); });
    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith(5, 11, 'db2'));
    await waitFor(() => expect(view.getByText('Фотографий: 1')).toBeTruthy());
    expect(view.queryByLabelText('Открыть фото p11.jpg')).toBeNull();
  });

  it('opens the preview modal and downloads full content', async () => {
    const view = await render(<NativeEquipmentPhotosSection itemId={9} tokens={tokens} />);
    await waitFor(() => expect(view.getByText('Фотографий: 2')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByLabelText('Открыть фото p12.jpg')); });
    await waitFor(() => expect(mockedDownload).toHaveBeenCalledWith(
      9, 12, expect.objectContaining({ thumb: false }),
    ));
  });

  it('hides write actions without permission and in offline mode', async () => {
    const view = await render(<NativeEquipmentPhotosSection itemId={3} offline tokens={tokens} />);
    await waitFor(() => expect(view.getByText(/доступны только при подключении/)).toBeTruthy());
    expect(view.queryByTestId('native-equipment-photos-add')).toBeNull();
    expect(mockedList).not.toHaveBeenCalled();
  });
});
