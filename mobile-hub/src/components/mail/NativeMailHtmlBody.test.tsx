import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { getFluentTokens } from '../../theme/fluentTokens';
import { NativeMailHtmlBody } from './NativeMailHtmlBody';

let mockDimensions = { width: 360, height: 800, scale: 1, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => mockDimensions,
}));
const props = { bodyHtml: '<p>Кириллица <b>письма</b></p>', plainText: 'Кириллица письма', tokens: getFluentTokens('light') };
beforeEach(() => { mockDimensions = { width: 360, height: 800, scale: 1, fontScale: 1 }; });

it('updates Android text zoom when the system font scale changes', async () => {
  const view = await render(<NativeMailHtmlBody {...props} />);
  expect(view.getByTestId('native-mail-html-body').props.textZoom).toBe(100);
  mockDimensions = { ...mockDimensions, fontScale: 2 };
  await view.rerender(<NativeMailHtmlBody {...props} />);
  expect(view.getByTestId('native-mail-html-body').props.textZoom).toBe(200);
});

it('resizes a long document on rotation without waiting for another height event', async () => {
  const view = await render(<NativeMailHtmlBody {...props} />);
  await fireEvent(view.getByTestId('native-mail-html-body'), 'message', { nativeEvent: { data: JSON.stringify({ type: 'mail-height', height: 30_000 }) } });
  mockDimensions = { ...mockDimensions, width: 800, height: 360 };
  await view.rerender(<NativeMailHtmlBody {...props} />);
  expect(StyleSheet.flatten(view.getByTestId('native-mail-html-body').props.style).height).toBe(259);
});

it.each(['error', 'renderProcessGone'])('offers readable text and an explicit renderer retry after %s', async (event) => {
  const view = await render(<NativeMailHtmlBody {...props} />);
  await fireEvent(view.getByTestId('native-mail-html-body'), event, { nativeEvent: {} });
  expect(view.queryByTestId('native-mail-html-body')).toBeNull();
  expect(view.getByText('Кириллица письма')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Показать оформление письма'));
  expect(view.getByTestId('native-mail-html-body')).toBeTruthy();
});

it('lets the reader choose text without executing or showing markup', async () => {
  const view = await render(<NativeMailHtmlBody {...props} plainText={null} bodyHtml="<script>secretCode()</script><p>Текст<br>письма</p>" />);
  await fireEvent.press(view.getByLabelText('Читать письмо как текст'));
  expect(view.queryByTestId('native-mail-html-body')).toBeNull();
  expect(view.getByTestId('native-mail-html-web-fallback').props.children).toBe('Текст\nписьма');
});
