import { formatApiError } from './formatError';

it('shows a structured FastAPI detail message', () => {
  expect(formatApiError({
    isAxiosError: true,
    response: { status: 503, data: { detail: { code: 'catalog_unavailable', message: 'Каталог 1С недоступен' } } },
    message: 'Request failed with status code 503',
  })).toBe('Каталог 1С недоступен');
});
