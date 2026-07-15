import { describe, expect, it } from 'vitest';
import { resolveErrorMessage } from './Warehouse1C';

describe('Warehouse1C error messages', () => {
  it('shows the structured catalog-unavailable reason returned by the backend', () => {
    const error = {
      response: {
        data: {
          detail: {
            code: 'catalog_unavailable',
            message: 'Каталог 1С ещё не загружен. Запустите обновление каталога.',
          },
        },
      },
    };

    expect(resolveErrorMessage(error, 'Общая ошибка')).toBe(
      'Каталог 1С ещё не загружен. Запустите обновление каталога.',
    );
  });
});
