import { describe, expect, it } from 'vitest';

import {
  getMailErrorCode,
  getMailErrorDetail,
  getMailErrorDetailAsync,
  isMissingMailDetailError,
  isTransientMailRequestError,
} from './mailErrorModel';

describe('mailErrorModel', () => {
  it('extracts detail from response payloads before falling back to axios messages', () => {
    expect(getMailErrorDetail({ response: { data: { detail: 'Mailbox failed' } } }, 'Fallback'))
      .toBe('Mailbox failed');
    expect(getMailErrorDetail({ response: { data: { detail: { message: 'Nested detail' } } } }, 'Fallback'))
      .toBe('Nested detail');
    expect(getMailErrorDetail({ message: 'Network Error' }, 'Fallback')).toBe('Network Error');
    expect(getMailErrorDetail({}, 'Fallback')).toBe('Fallback');
  });

  it('extracts JSON and text details from blob-like response payloads', async () => {
    await expect(getMailErrorDetailAsync({
      response: {
        data: { text: async () => JSON.stringify({ detail: { message: 'JSON detail' } }) },
        headers: { 'content-type': 'application/json' },
      },
    }, 'Fallback')).resolves.toBe('JSON detail');

    await expect(getMailErrorDetailAsync({
      response: {
        data: { text: async () => 'Plain mail error' },
        headers: { 'content-type': 'text/plain' },
      },
    }, 'Fallback')).resolves.toBe('Plain mail error');

    const encodedJson = new TextEncoder().encode(JSON.stringify({ message: 'ArrayBuffer detail' }));
    await expect(getMailErrorDetailAsync({
      response: {
        data: { arrayBuffer: async () => encodedJson.buffer },
        headers: { 'content-type': 'application/json' },
      },
    }, 'Fallback')).resolves.toBe('ArrayBuffer detail');
  });

  it('ignores HTML blob bodies and returns the normal fallback detail', async () => {
    await expect(getMailErrorDetailAsync({
      response: {
        data: { text: async () => '<html><body>proxy error</body></html>' },
        headers: { 'content-type': 'text/html' },
      },
    }, 'Fallback')).resolves.toBe('Fallback');
  });

  it('classifies missing message and transient mail request errors', () => {
    expect(isMissingMailDetailError({ response: { status: 404 } })).toBe(true);
    expect(isMissingMailDetailError({ response: { status: 400 } }, 'Invalid message id')).toBe(true);
    expect(isMissingMailDetailError({ response: { status: 401 } }, 'Invalid message id')).toBe(false);

    expect(isTransientMailRequestError({ response: { status: 503 } })).toBe(true);
    expect(isTransientMailRequestError({ response: { status: 429 } })).toBe(true);
    expect(isTransientMailRequestError({ code: 'ECONNABORTED' })).toBe(true);
    expect(isTransientMailRequestError({ code: 'EAI_AGAIN' })).toBe(true);
    expect(isTransientMailRequestError({ message: 'Network Error' })).toBe(true);
    expect(isTransientMailRequestError({ message: 'Failed to fetch' })).toBe(true);
    expect(isTransientMailRequestError({ response: { status: 401 } })).toBe(false);
  });

  it('reads mail error code header case-insensitively for current axios shapes', () => {
    expect(getMailErrorCode({ response: { headers: { 'x-mail-error-code': 'TLS_FAILED' } } }))
      .toBe('TLS_FAILED');
    expect(getMailErrorCode({ response: { headers: { 'X-Mail-Error-Code': 'AUTH_FAILED' } } }))
      .toBe('AUTH_FAILED');
  });
});
