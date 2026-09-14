import { act, fireEvent, render } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { getFluentTokens } from '../../theme/fluentTokens';
import { NativeSegmentedControl } from './NativeFilterControls';

const tokens = getFluentTokens('light');
const originalWindow = Dimensions.get('window');
beforeEach(() => { Dimensions.set({ window: { ...originalWindow, width: 320, height: 640, fontScale: 1 } }); });
afterEach(() => { Dimensions.set({ window: originalWindow }); });

it('keeps task scopes readable and selectable after the container becomes narrower', async () => {
  const select = jest.fn();
  const view = await render(<NativeSegmentedControl options={[
    { value: 'assignee', label: 'Исполняю' }, { value: 'creator', label: 'Созданные' },
  ]} selected="assignee" onSelect={select} tokens={tokens} testIDPrefix="scope" />);
  await fireEvent(view.getByTestId('scope-group'), 'layout', { nativeEvent: { layout: { width: 296 } } });
  expect(StyleSheet.flatten(view.getByTestId('scope-group').props.style).width).toBe('100%');
  expect(StyleSheet.flatten(view.getByTestId('scope-creator').props.style).flexBasis).toBeCloseTo(142.5);
  await fireEvent(view.getByTestId('scope-group'), 'layout', { nativeEvent: { layout: { width: 200 } } });
  expect(StyleSheet.flatten(view.getByTestId('scope-creator').props.style).flexBasis).toBe(192);
  expect(view.getByText('Созданные').props.numberOfLines).toBeUndefined();
  expect(view.getByText('Созданные').props.adjustsFontSizeToFit).toBeUndefined();
  await fireEvent.press(view.getByTestId('scope-creator'));
  expect(select).toHaveBeenCalledWith('creator');
  expect(view.getByTestId('scope-assignee').props.accessibilityState.selected).toBe(true);
});

it('uses a balanced grid for long statistics choices and respects a 200 percent font', async () => {
  const options = ['Чистка ПК', 'МФУ', 'Батареи', 'Комплектующие'].map((label) => ({ value: label, label }));
  const view = await render(<NativeSegmentedControl options={options} selected="МФУ" onSelect={() => {}} tokens={tokens} testIDPrefix="stats" />);
  await fireEvent(view.getByTestId('stats-group'), 'layout', { nativeEvent: { layout: { width: 388 } } });
  expect(StyleSheet.flatten(view.getByTestId('stats-МФУ').props.style).flexBasis).toBeCloseTo(188.5);
  await act(async () => { Dimensions.set({ window: { ...originalWindow, width: 412, fontScale: 2 } }); });
  expect(StyleSheet.flatten(view.getByTestId('stats-МФУ').props.style).flexBasis).toBe(380);
});
