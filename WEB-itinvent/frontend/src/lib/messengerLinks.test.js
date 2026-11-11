import { describe, expect, it } from 'vitest';
import { buildTelegramDeepLinks } from './messengerLinks';

describe('messengerLinks', () => {
  it('builds telegram deep links with prefilled text', () => {
    const links = buildTelegramDeepLinks('89001234567', 'Ссылка для скачивания:\nhttps://hub.example/x');
    expect(links?.appLink).toContain('phone=79001234567');
    expect(links?.appLink).toContain('text=');
    expect(links?.webLink).toContain('t.me/+79001234567');
    expect(links?.webLink).toContain('text=');
  });
});
