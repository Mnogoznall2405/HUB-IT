import { fireEvent, render } from '@testing-library/react-native';
import { ChatImageEditorSheet } from './ChatImageEditorSheet';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Image } from 'react-native';

afterEach(() => jest.restoreAllMocks());

it('keeps cancel and send outside the scrollable tools without changing the chosen file', async () => {
  const cancel = jest.fn();
  const confirm = jest.fn();
  jest.spyOn(Image, 'getSize').mockImplementation(((_uri: string, success?: (width: number, height: number) => void) => {
    success?.(1200, 800);
    return Promise.resolve({ width: 1200, height: 800 });
  }) as typeof Image.getSize);
  const view = await render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 640 }, insets: { top: 24, left: 0, right: 0, bottom: 34 } }}><ChatImageEditorSheet
    file={{ uri: 'file:///photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', size: 120, source: 'gallery' }}
    onCancel={cancel} onConfirm={confirm} /></SafeAreaProvider>);
  expect(view.getByTestId('chat-image-editor-scroll')).toBeTruthy();
  const send = view.getByLabelText('Отправить фото');
  let parent = send.parent;
  while (parent) {
    expect(parent.props.testID).not.toBe('chat-image-editor-scroll');
    parent = parent.parent;
  }
  await fireEvent.press(view.getByLabelText('Отменить фото'));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
});
