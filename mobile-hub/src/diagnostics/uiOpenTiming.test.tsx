import { act, render } from '@testing-library/react-native';
import { getUiTimingSummary, resetUiTiming } from './uiTiming';
import { noteUiOpen, useUiKeyTiming, useUiOpenTiming } from './uiOpenTiming';

function Panel({ open }: { open: boolean }) {
  useUiOpenTiming('test-panel', open);
  return null;
}
function Screen({ name }: { name: string }) {
  useUiKeyTiming(name);
  return null;
}

beforeEach(() => {
  jest.useFakeTimers();
  resetUiTiming();
});
afterEach(() => jest.useRealTimers());

it('records time-to-visible once per closed -> open flip, not on every re-render', async () => {
  const view = await render(<Panel open={false} />);
  await view.rerender(<Panel open />);
  await act(async () => { jest.advanceTimersByTime(100); });
  await view.rerender(<Panel open />);
  await act(async () => { jest.advanceTimersByTime(100); });
  expect(getUiTimingSummary().opens['test-panel'].count).toBe(1);

  await view.rerender(<Panel open={false} />);
  await view.rerender(<Panel open />);
  await act(async () => { jest.advanceTimersByTime(100); });
  expect(getUiTimingSummary().opens['test-panel'].count).toBe(2);
});

it('records route changes but not the initial app-start value', async () => {
  const view = await render(<Screen name="screen:chat" />);
  await act(async () => { jest.advanceTimersByTime(100); });
  expect(getUiTimingSummary().opens['screen:chat']).toBeUndefined();

  await view.rerender(<Screen name="screen:database" />);
  await act(async () => { jest.advanceTimersByTime(100); });
  expect(getUiTimingSummary().opens['screen:database'].count).toBe(1);
});

it('summarizes percentiles and slow opens, and ignores unsafe names', () => {
  [100, 200, 400, 900].forEach((ms) => noteUiOpen('sheet-a', ms));
  noteUiOpen('Bad Name With 123/ids', 50);
  const { opens } = getUiTimingSummary();
  expect(opens['sheet-a']).toEqual({ count: 4, p50: 200, p95: 900, maxMs: 900, slow300: 2 });
  expect(Object.keys(opens)).toEqual(['sheet-a']);
});
