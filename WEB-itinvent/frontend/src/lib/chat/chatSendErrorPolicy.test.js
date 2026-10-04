// Матрица классификации: чистая функция, от которой зависит, увидит ли
// пользователь тост. E2E воспроизводит только «нет сети»; 502/504, таймауты
// axios, мёртвый WS и граница 4xx через браузерный стенд не проверить дёшево,
// а ошибка в любую сторону — либо ложный тост, либо проглоченный отказ сервера.
import { describe, expect, it } from 'vitest';

import { isTransientChatSendError } from './chatSendErrorPolicy';

const axiosError = (extra) => Object.assign(new Error('axios'), { isAxiosError: true, ...extra });

describe('isTransientChatSendError', () => {
  it.each([
    ['navigator offline, даже при ответе 422', axiosError({ response: { status: 422 } }), false],
    ['axios без ответа', axiosError({ request: {} }), true],
    ['ERR_NETWORK', axiosError({ code: 'ERR_NETWORK' }), true],
    ['ERR_INTERNET_DISCONNECTED', { code: 'ERR_INTERNET_DISCONNECTED' }, true],
    ['axios timeout ECONNABORTED', axiosError({ code: 'ECONNABORTED', request: {} }), true],
    ['ETIMEDOUT', axiosError({ code: 'ETIMEDOUT' }), true],
    ['408', axiosError({ response: { status: 408 } }), true],
    ['502', axiosError({ response: { status: 502 } }), true],
    ['503', axiosError({ response: { status: 503 } }), true],
    ['504', axiosError({ response: { status: 504 } }), true],
    ['WS heartbeat timeout', new Error('Chat websocket heartbeat timeout'), true],
    ['WS is not connected', new Error('Chat websocket is not connected'), true],
    ['WS command timed out', new Error('Chat websocket command timed out'), true],
  ])('транзитная: %s', (_label, error, online = true) => {
    expect(isTransientChatSendError(error, { online })).toBe(true);
  });

  it.each([
    ['400', axiosError({ response: { status: 400 } })],
    ['403', axiosError({ response: { status: 403 } })],
    ['413', axiosError({ response: { status: 413 } })],
    ['422', axiosError({ response: { status: 422 } })],
    ['429', axiosError({ response: { status: 429 } })],
    ['500', axiosError({ response: { status: 500 } })],
    ['WS validation_error', Object.assign(new Error('bad'), { chatErrorCode: 'validation_error' })],
    ['WS forbidden', Object.assign(new Error('Chat websocket closed'), { chatErrorCode: 'forbidden' })],
    ['WS access denied', new Error('Chat websocket access denied')],
    ['обычная ошибка без запроса', new Error('boom')],
    ['пустая ошибка', null],
  ])('отказ по существу: %s', (_label, error) => {
    expect(isTransientChatSendError(error, { online: true })).toBe(false);
  });
});
