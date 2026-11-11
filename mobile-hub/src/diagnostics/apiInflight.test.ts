import {
  getApiInflightSummary,
  noteApiRequestEnd,
  noteApiRequestStart,
  noteChatSendHttpStartInflight,
  resetApiInflight,
} from './apiInflight';

beforeEach(() => resetApiInflight());

it('tracks concurrent requests and the observed maximum', () => {
  noteApiRequestStart();
  noteApiRequestStart();
  noteApiRequestStart();
  noteApiRequestEnd();

  const summary = getApiInflightSummary();
  expect(summary.current).toBe(2);
  expect(summary.maxObserved).toBe(3);
  expect(summary.started).toBe(3);
  expect(summary.completed).toBe(1);
});

it('never lets the gauge go below zero', () => {
  noteApiRequestEnd();
  expect(getApiInflightSummary().current).toBe(0);
});

it('samples the in-flight count at each chat send http start', () => {
  noteApiRequestStart();
  noteApiRequestStart();
  noteChatSendHttpStartInflight();
  noteApiRequestEnd();
  noteChatSendHttpStartInflight();

  expect(getApiInflightSummary().atChatSendHttpStart).toEqual({ count: 2, p50: 1, p95: 2 });
});

it('bounds the chat-send inflight samples', () => {
  for (let index = 0; index < 200; index += 1) noteChatSendHttpStartInflight();
  expect(getApiInflightSummary().atChatSendHttpStart.count).toBe(120);
});

it('contains no urls, params or request content in the exported summary', () => {
  noteApiRequestStart();
  noteChatSendHttpStartInflight();
  const encoded = JSON.stringify(getApiInflightSummary());
  expect(encoded).not.toContain('http');
  expect(encoded).not.toContain('url');
  expect(encoded).not.toContain('token');
});
