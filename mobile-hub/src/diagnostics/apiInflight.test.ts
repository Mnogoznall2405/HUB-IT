import {
  getApiInflightSummary,
  noteApiRequestEnd,
  noteApiRequestStart,
  noteChatSendHttpStartInflight,
  resetApiInflight,
} from './apiInflight';

beforeEach(() => resetApiInflight());

it('tracks concurrent requests and the observed maximum', () => {
  const first = {};
  const second = {};
  const third = {};
  noteApiRequestStart(first);
  noteApiRequestStart(second);
  noteApiRequestStart(third);
  noteApiRequestEnd(first);

  const summary = getApiInflightSummary();
  expect(summary.current).toBe(2);
  expect(summary.maxObserved).toBe(3);
  expect(summary.started).toBe(3);
  expect(summary.completed).toBe(1);
});

it('never lets the gauge go below zero', () => {
  noteApiRequestEnd(undefined);
  noteApiRequestEnd({});
  expect(getApiInflightSummary().current).toBe(0);
  expect(getApiInflightSummary().completed).toBe(0);
});

it('counts a completion once even when the response interceptor fires twice', () => {
  const config = {};
  noteApiRequestStart(config);
  noteApiRequestEnd(config);
  noteApiRequestEnd(config);

  const summary = getApiInflightSummary();
  expect(summary.completed).toBe(1);
  expect(summary.current).toBe(0);
});

it('ignores a completion from before a reset and balances the next epoch', () => {
  const stale = {};
  noteApiRequestStart(stale);
  resetApiInflight();
  noteApiRequestEnd(stale);

  let summary = getApiInflightSummary();
  expect(summary).toMatchObject({ started: 0, completed: 0, current: 0 });

  const fresh = {};
  noteApiRequestStart(fresh);
  noteApiRequestEnd(fresh);
  summary = getApiInflightSummary();
  expect(summary).toMatchObject({ started: 1, completed: 1, current: 0 });
});

it('samples the in-flight count at each chat send http start', () => {
  const first = {};
  const second = {};
  noteApiRequestStart(first);
  noteApiRequestStart(second);
  noteChatSendHttpStartInflight();
  noteApiRequestEnd(first);
  noteChatSendHttpStartInflight();

  expect(getApiInflightSummary().atChatSendHttpStart).toEqual({ count: 2, p50: 1, p95: 2 });
});

it('bounds the chat-send inflight samples', () => {
  for (let index = 0; index < 200; index += 1) noteChatSendHttpStartInflight();
  expect(getApiInflightSummary().atChatSendHttpStart.count).toBe(120);
});

it('contains no urls, params or request content in the exported summary', () => {
  noteApiRequestStart({ url: '/chat/conversations/private?token=x' });
  noteChatSendHttpStartInflight();
  const encoded = JSON.stringify(getApiInflightSummary());
  expect(encoded).not.toContain('http');
  expect(encoded).not.toContain('url');
  expect(encoded).not.toContain('token');
});
