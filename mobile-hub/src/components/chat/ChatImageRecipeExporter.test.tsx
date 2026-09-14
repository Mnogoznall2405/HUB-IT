import { act, fireEvent, render } from '@testing-library/react-native';
import { ChatImageRecipeExporter } from './ChatImageRecipeExporter';

const mockInject = jest.fn();
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { WebView: React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject }));
    return React.createElement(View, { ...props, testID: 'export-webview' });
  }) };
});
beforeEach(() => { jest.useFakeTimers(); mockInject.mockClear(); });
afterEach(() => jest.useRealTimers());
const options = () => ({ requestId: 'one', imageDataUrl: 'data:image/png;base64,eA==', recipeJson: '{"operations":[]}',
  onReady: jest.fn(), onExported: jest.fn(), onError: jest.fn() });

it('reports a stalled native exporter once and rejects late success', async () => {
  const props = options();
  const view = await render(<ChatImageRecipeExporter {...props} />);
  await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
  expect(props.onError).toHaveBeenCalledWith('one', 'timeout');
  await fireEvent(view.getByTestId('export-webview'), 'message', { nativeEvent: { data: JSON.stringify({ type: 'exported', requestId: 'one', dataUrl: 'late' }) } });
  expect(props.onExported).not.toHaveBeenCalled();
  expect(props.onError).toHaveBeenCalledTimes(1);
});

it('exports each request once and reuses a ready WebView for the next request', async () => {
  const props = options();
  const view = await render(<ChatImageRecipeExporter {...props} />);
  const message = async (payload: unknown) => fireEvent(view.getByTestId('export-webview'), 'message', { nativeEvent: { data: JSON.stringify(payload) } });
  await message({ type: 'ready' });
  await message({ type: 'ready' });
  expect(mockInject).toHaveBeenCalledTimes(1);
  await message({ type: 'exported', requestId: 'one', dataUrl: 'image-one' });
  await view.rerender(<ChatImageRecipeExporter {...props} requestId="two" />);
  expect(mockInject).toHaveBeenCalledTimes(2);
  await message({ type: 'exported', requestId: 'one', dataUrl: 'old' });
  await message({ type: 'exported', requestId: 'two', dataUrl: 'image-two' });
  await message({ type: 'exported', requestId: 'two', dataUrl: 'duplicate' });
  expect(props.onExported.mock.calls).toEqual([['one', 'image-one'], ['two', 'image-two']]);
  await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
  expect(props.onError).not.toHaveBeenCalled();
});

it('reports native process failure and clears the watchdog on unmount', async () => {
  const props = options();
  const view = await render(<ChatImageRecipeExporter {...props} />);
  await fireEvent(view.getByTestId('export-webview'), 'renderProcessGone', {});
  expect(props.onError).toHaveBeenCalledTimes(1);
  await view.unmount();
  await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
  expect(props.onError).toHaveBeenCalledTimes(1);
});
