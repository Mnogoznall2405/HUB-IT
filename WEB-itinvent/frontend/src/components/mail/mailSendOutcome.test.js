import { describe, expect, it } from 'vitest';
import {
  MAIL_SEND_MAYBE_SENT_MESSAGE,
  MAIL_SEND_NOT_SENT_MESSAGE,
  MAIL_SEND_OUTCOME,
  MAIL_SEND_TIMEOUT_MS,
  classifyMailSendError,
  getMailSendErrorMessage,
} from './mailSendOutcome';

describe('mailSendOutcome', () => {
  it('keeps the mail send axios timeout below the IIS ARR budget', () => {
    expect(MAIL_SEND_TIMEOUT_MS).toBe(115000);
    expect(MAIL_SEND_TIMEOUT_MS).toBeLessThan(120000);
  });

  it('maps frontend timeout during processing to maybe sent', () => {
    expect(classifyMailSendError({
      code: 'ECONNABORTED',
      message: 'timeout of 115000ms exceeded',
    })).toBe(MAIL_SEND_OUTCOME.MAYBE_SENT);
    expect(classifyMailSendError({
      response: {
        status: 504,
        headers: { 'x-mail-error-code': 'MAIL_SEND_TIMEOUT' },
        data: { detail: 'Отправка заняла слишком много времени.' },
      },
    })).toBe(MAIL_SEND_OUTCOME.MAYBE_SENT);
    expect(classifyMailSendError({
      response: {
        status: 409,
        headers: { 'x-mail-error-code': 'MAIL_SEND_UNKNOWN' },
      },
    })).toBe(MAIL_SEND_OUTCOME.MAYBE_SENT);
    expect(getMailSendErrorMessage({ code: 'ECONNABORTED' }, 'fallback'))
      .toBe(MAIL_SEND_MAYBE_SENT_MESSAGE);
  });

  it('maps errors before Exchange to not sent', () => {
    expect(classifyMailSendError({
      response: { status: 400, data: { detail: 'At least one recipient is required' } },
    })).toBe(MAIL_SEND_OUTCOME.NOT_SENT);
    expect(classifyMailSendError({
      response: {
        status: 409,
        headers: { 'x-mail-error-code': 'MAIL_IDEMPOTENCY_CONFLICT' },
        data: { detail: 'Этот ключ отправки уже использован для другого письма.' },
      },
    })).toBe(MAIL_SEND_OUTCOME.NOT_SENT);
    expect(classifyMailSendError({
      response: {
        status: 409,
        headers: { 'x-mail-error-code': 'MAIL_PASSWORD_REQUIRED' },
      },
    })).toBe(MAIL_SEND_OUTCOME.NOT_SENT);
    expect(getMailSendErrorMessage({
      response: { status: 400, data: { detail: 'At least one recipient is required' } },
    }, MAIL_SEND_NOT_SENT_MESSAGE)).toBe('At least one recipient is required');
  });

  it('maps a proven Exchange refusal to not sent so the real detail is shown', () => {
    // MAIL_SEND_FAILED is emitted only when the send provably did not happen
    // (local failure or a definitive Exchange refusal) — the user must see the
    // actual reason and may retry, not the ambiguous «могло быть отправлено».
    const refusal = {
      response: {
        status: 400,
        headers: { 'x-mail-error-code': 'MAIL_SEND_FAILED' },
        data: { detail: 'Получатель отклонён сервером Exchange' },
      },
    };
    expect(classifyMailSendError(refusal)).toBe(MAIL_SEND_OUTCOME.NOT_SENT);
    expect(getMailSendErrorMessage(refusal, 'fallback')).toBe('Получатель отклонён сервером Exchange');
  });

  it('maps a client-side cancel to maybe sent, never to not sent', () => {
    // Aborting the request only stops the client from waiting: Exchange may
    // already have accepted the message, so the UI must not claim "not sent".
    expect(classifyMailSendError({ code: 'ERR_CANCELED' })).toBe(MAIL_SEND_OUTCOME.MAYBE_SENT);
    expect(getMailSendErrorMessage({ code: 'ERR_CANCELED' }))
      .toBe(MAIL_SEND_MAYBE_SENT_MESSAGE);
  });
});
