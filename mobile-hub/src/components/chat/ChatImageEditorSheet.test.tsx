import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Image, PanResponder } from 'react-native';
import * as manipulator from 'expo-image-manipulator';
import * as imageEdits from '../../chat/chatImageEditor';
import type { NativePickedFile } from '../../files/nativeFilePicker';
import { ChatImageEditorSheet } from './ChatImageEditorSheet';
import * as canvas from '../../chat/chatImageEditorCanvas';
let mockExporterProps: any;
jest.mock('./ChatImageRecipeExporter', () => ({
  ChatImageRecipeExporter: (props: any) => { mockExporterProps = props; return null; },
}));

const photo: NativePickedFile = { uri: 'file:///photo.png', name: 'photo.png', mimeType: 'image/png', size: 123, source: 'gallery' };
beforeEach(() => {
  mockExporterProps = null;
  jest.spyOn(Image, 'getSize').mockImplementation(((_uri: string, success: (width: number, height: number) => void) => {
    success(1200, 800);
    return Promise.resolve({ width: 1200, height: 800 });
  }) as typeof Image.getSize);
});
afterEach(() => jest.restoreAllMocks());

it('preserves an unchanged PNG without claiming its bytes are JPEG', async () => {
  const confirm = jest.fn();
  const view = await render(<ChatImageEditorSheet file={photo} onCancel={jest.fn()} onConfirm={confirm} />);
  await fireEvent.press(view.getByLabelText('Отправить фото'));
  expect(confirm).toHaveBeenCalledWith(photo);
});

it('ignores rotation completion after a different photo replaces the source', async () => {
  let finish!: (value: any) => void;
  jest.spyOn(manipulator, 'manipulateAsync').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const confirm = jest.fn();
  const props = { onCancel: jest.fn(), onConfirm: confirm };
  const view = await render(<ChatImageEditorSheet {...props} file={photo} />);
  await fireEvent.press(view.getByLabelText('Повернуть на 90 градусов'));
  await waitFor(() => expect(finish).toBeDefined());
  const next = { ...photo, uri: 'file:///next.png', name: 'next.png' };
  await view.rerender(<ChatImageEditorSheet {...props} file={next} />);
  await act(async () => { finish({ uri: 'file:///old-rotation.jpg', width: 800, height: 1200 }); });
  await fireEvent.press(view.getByLabelText('Отправить фото'));
  expect(confirm).toHaveBeenCalledWith(next);
});

it('uses the current photo for crop gestures when the editor was initially closed', async () => {
  const responder = jest.spyOn(PanResponder, 'create');
  const manipulate = jest.spyOn(manipulator, 'manipulateAsync');
  const props = { onCancel: jest.fn(), onConfirm: jest.fn() };
  const view = await render(<ChatImageEditorSheet {...props} file={null} />);
  await view.rerender(<ChatImageEditorSheet {...props} file={photo} />);
  const stage = view.getByTestId('chat-image-editor-stage');
  await fireEvent(stage, 'layout', { nativeEvent: { layout: { width: 300, height: 200 } } });
  const handlers = responder.mock.calls[0][0];
  await act(async () => { handlers.onPanResponderGrant?.({ nativeEvent: { locationX: 30, locationY: 20 } } as any, {} as any); });
  await act(async () => { handlers.onPanResponderMove?.({ nativeEvent: { locationX: 200, locationY: 140 } } as any, {} as any); });
  await act(async () => { handlers.onPanResponderRelease?.({} as any, {} as any); });
  expect(manipulate).toHaveBeenCalledWith(photo.uri, [expect.objectContaining({ crop: expect.anything() })], expect.anything());
});

it('does not recompute committed overlays during 40 text keystrokes', async () => {
  const normalize = jest.spyOn(imageEdits, 'overlayChatImageEditRecipe');
  const view = await render(<ChatImageEditorSheet file={photo} onCancel={jest.fn()} onConfirm={jest.fn()} />);
  await fireEvent.press(view.getByLabelText('Добавить текст'));
  normalize.mockClear();
  for (let i = 1; i <= 40; i++) await fireEvent.changeText(view.getByLabelText('Текст на фото'), 'а'.repeat(i));
  expect(normalize).toHaveBeenCalledTimes(0);
});

it('undoes and redoes a native rotation', async () => {
  jest.spyOn(manipulator, 'manipulateAsync').mockResolvedValueOnce({ uri: 'file:///rotated.jpg', width: 800, height: 1200 });
  const confirm = jest.fn();
  const view = await render(<ChatImageEditorSheet file={photo} onCancel={jest.fn()} onConfirm={confirm} />);
  await fireEvent.press(view.getByLabelText('Повернуть на 90 градусов'));
  await waitFor(() => expect(view.getByLabelText('Отменить').props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(view.getByLabelText('Отменить'));
  expect(view.getByLabelText('Повторить').props.accessibilityState.disabled).toBe(false);
  await fireEvent.press(view.getByLabelText('Отправить фото'));
  expect(confirm).toHaveBeenLastCalledWith(photo);
  await fireEvent.press(view.getByLabelText('Повторить'));
  expect(view.getByLabelText('Отменить').props.accessibilityState.disabled).toBe(false);
  await fireEvent.press(view.getByLabelText('Отправить фото'));
  expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ uri: 'file:///rotated.jpg', mimeType: 'image/jpeg' }));
});

it('includes entered text in export and ignores duplicate export confirmations', async () => {
  jest.spyOn(canvas, 'readLocalImageDataUrl').mockResolvedValue('data:image/png;base64,eA==');
  const edited = { uri: 'file:///annotated.jpg', name: 'annotated.jpg', mimeType: 'image/jpeg', size: 20 };
  jest.spyOn(canvas, 'writeEditedImageFromDataUrl').mockReturnValue(edited);
  const confirm = jest.fn();
  const view = await render(<ChatImageEditorSheet file={photo} onCancel={jest.fn()} onConfirm={confirm} />);
  await fireEvent.press(view.getByLabelText('Добавить текст'));
  await fireEvent.changeText(view.getByLabelText('Текст на фото'), 'Инвентарный номер');
  await fireEvent.press(view.getByLabelText('Отправить фото'));
  await waitFor(() => expect(mockExporterProps).not.toBeNull());
  const props = mockExporterProps;
  expect(JSON.parse(props.recipeJson).operations).toEqual([expect.objectContaining({ type: 'text', text: 'Инвентарный номер' })]);
  await act(async () => { props.onExported(props.requestId, 'data'); props.onExported(props.requestId, 'data'); });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining(edited));
});

it('bakes annotations before rotating and restores editable text on undo', async () => {
  jest.spyOn(canvas, 'readLocalImageDataUrl').mockResolvedValue('data:image/png;base64,eA==');
  jest.spyOn(canvas, 'writeEditedImageFromDataUrl').mockReturnValue({ uri: 'file:///baked.jpg', name: 'baked.jpg', mimeType: 'image/jpeg', size: 20 });
  const manipulate = jest.spyOn(manipulator, 'manipulateAsync').mockResolvedValueOnce({ uri: 'file:///rotated.jpg', width: 800, height: 1200 });
  const view = await render(<ChatImageEditorSheet file={photo} onCancel={jest.fn()} onConfirm={jest.fn()} />);
  await fireEvent.press(view.getByLabelText('Добавить текст'));
  await fireEvent.changeText(view.getByLabelText('Текст на фото'), 'Метка');
  await fireEvent.press(view.getByLabelText('Добавить текст по центру'));
  await fireEvent.press(view.getByLabelText('Повернуть на 90 градусов'));
  await waitFor(() => expect(mockExporterProps).not.toBeNull());
  expect(manipulate).not.toHaveBeenCalled();
  await act(async () => { mockExporterProps.onExported(mockExporterProps.requestId, 'data'); });
  expect(manipulate).toHaveBeenCalledWith('file:///baked.jpg', [{ rotate: 90 }], expect.anything());
  await fireEvent.press(view.getByLabelText('Отменить'));
  await fireEvent.press(view.getByLabelText('Отправить фото'));
  await waitFor(() => expect(JSON.parse(mockExporterProps.recipeJson).operations[0].text).toBe('Метка'));
  await act(async () => { mockExporterProps.onError(mockExporterProps.requestId); });
});

it('never exports or sends a photo after cancellation during file reading', async () => {
  let finish!: (value: string) => void;
  jest.spyOn(canvas, 'readLocalImageDataUrl').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const confirm = jest.fn();
  const view = await render(<ChatImageEditorSheet file={photo} onCancel={jest.fn()} onConfirm={confirm} />);
  await fireEvent.press(view.getByLabelText('Добавить текст'));
  await fireEvent.changeText(view.getByLabelText('Текст на фото'), 'Метка');
  await fireEvent.press(view.getByLabelText('Отправить фото'));
  await fireEvent.press(view.getByLabelText('Отменить фото'));
  await act(async () => { finish('data:image/png;base64,eA=='); });
  expect(mockExporterProps).toBeNull();
  expect(confirm).not.toHaveBeenCalled();
});

it('scales crop coordinates when annotations were exported at a smaller resolution', async () => {
  jest.spyOn(canvas, 'readLocalImageDataUrl').mockResolvedValue('data:image/png;base64,eA==');
  jest.spyOn(canvas, 'writeEditedImageFromDataUrl').mockReturnValue({ uri: 'file:///smaller.jpg', name: 'smaller.jpg', mimeType: 'image/jpeg', size: 20 });
  jest.spyOn(Image, 'getSize').mockImplementation(((_uri: string, success: (width: number, height: number) => void) => {
    const width = _uri.includes('smaller') ? 600 : 1200;
    const height = width * 2 / 3;
    success(width, height); return Promise.resolve({ width, height });
  }) as typeof Image.getSize);
  const manipulate = jest.spyOn(manipulator, 'manipulateAsync');
  const view = await render(<ChatImageEditorSheet file={photo} onCancel={jest.fn()} onConfirm={jest.fn()} />);
  await fireEvent.press(view.getByLabelText('Добавить текст'));
  await fireEvent.changeText(view.getByLabelText('Текст на фото'), 'Метка');
  await fireEvent.press(view.getByLabelText('Добавить текст по центру'));
  await fireEvent.press(view.getByLabelText('Кадрировать'));
  await fireEvent.press(view.getByLabelText('Квадратный кадр'));
  await waitFor(() => expect(mockExporterProps).not.toBeNull());
  await act(async () => { mockExporterProps.onExported(mockExporterProps.requestId, 'data'); });
  expect(manipulate).toHaveBeenCalledWith('file:///smaller.jpg', [{ crop: { originX: 100, originY: 0, width: 400, height: 400 } }], expect.anything());
});
