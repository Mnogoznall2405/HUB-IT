import { sanitizeMailSignatureHtml } from './nativeMailSignature';

it('keeps formatting-only signature HTML and removes every attribute', () => {
  expect(sanitizeMailSignatureHtml('<p class="name"><strong onclick="bad()">Иван</strong><br style="x">Инженер</p>'))
    .toBe('<p><strong>Иван</strong><br>Инженер</p>');
});

it('removes executable, remote and navigation markup from outgoing signatures', () => {
  const result = sanitizeMailSignatureHtml('<script>alert(1)</script><img src="https://tracker/pixel"><a href="https://evil">Сайт</a><div style="background:url(https://tracker)">Текст</div>');

  expect(result).toBe('Сайт<div>Текст</div>');
  expect(result).not.toMatch(/script|img|href|https:|style/i);
});
