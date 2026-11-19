import { noteApiRequestEnd, noteApiRequestStart, resetApiInflight } from './apiInflight';
import { beginScreenLoadTrace, resetScreenLoadTrace } from './screenSettle';
import { getUiOpenSummary, resetUiOpenTiming } from './uiOpenTiming';

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000);
  resetApiInflight();
  resetUiOpenTiming();
});
afterEach(() => {
  resetScreenLoadTrace();
  jest.useRealTimers();
});

describe('screen load trace (temporary)', () => {
  it('records how long a screen kept loading after navigation, until the API went quiet', () => {
    const first = {};
    const second = {};
    beginScreenLoadTrace('settings');
    jest.advanceTimersByTime(100);
    noteApiRequestStart(first);
    jest.advanceTimersByTime(300);
    noteApiRequestStart(second);
    jest.advanceTimersByTime(200);
    noteApiRequestEnd(first);
    jest.advanceTimersByTime(500);
    noteApiRequestEnd(second); // last request finishes 1100 ms after the navigation
    jest.advanceTimersByTime(1_000);
    expect(getUiOpenSummary()['load:settings']).toMatchObject({ count: 1, p50: 1100 });
  });

  it('records nothing for a screen served from cache without any request', () => {
    beginScreenLoadTrace('menu');
    jest.advanceTimersByTime(5_000);
    expect(getUiOpenSummary()['load:menu']).toBeUndefined();
  });

  it('drops an unfinished trace when the user moves on to another screen', () => {
    const request = {};
    beginScreenLoadTrace('mail');
    noteApiRequestStart(request);
    beginScreenLoadTrace('chat');
    noteApiRequestEnd(request);
    jest.advanceTimersByTime(2_000);
    expect(getUiOpenSummary()['load:mail']).toBeUndefined();
    expect(getUiOpenSummary()['load:chat']).toBeDefined();
  });
});
