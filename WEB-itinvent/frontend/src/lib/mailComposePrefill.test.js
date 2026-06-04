import { afterEach, describe, expect, it } from 'vitest';
import {
  MAIL_COMPOSE_PREFILL_STORAGE_KEY,
  plainTextToComposeHtml,
  readMailComposePrefill,
  stashMailComposePrefill,
} from './mailComposePrefill';

describe('mailComposePrefill', () => {
  afterEach(() => {
    window.sessionStorage.removeItem(MAIL_COMPOSE_PREFILL_STORAGE_KEY);
  });

  it('converts plain text to compose html paragraphs', () => {
    expect(plainTextToComposeHtml('Строка 1\nСтрока 2')).toBe('<p>Строка 1</p><p>Строка 2</p>');
  });

  it('stores and reads compose prefill payload', () => {
    stashMailComposePrefill({
      to: ['user@example.com'],
      subject: 'Файл',
      bodyPlain: 'Текст\nСсылка',
    });
    expect(readMailComposePrefill()).toMatchObject({
      to: ['user@example.com'],
      subject: 'Файл',
      bodyPlain: 'Текст\nСсылка',
    });
  });
});
