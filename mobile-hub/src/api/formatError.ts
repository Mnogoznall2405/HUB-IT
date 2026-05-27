import axios from 'axios';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function formatApiError(error: unknown, fallback = 'Произошла ошибка'): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      const code = String(error.code || '');
      if (code === 'ERR_NETWORK' || error.message === 'Network Error') {
        if (isBrowser()) {
          return (
            'Нет связи с API. В браузере это часто CORS: перезапустите «npx expo start» ' +
            '(нужен metro.config.js с прокси) и обновите страницу. ' +
            'Для hubit.zsgp.ru надёжнее Expo Go на Android — там CORS нет.'
          );
        }
        return 'Нет связи с сервером. Проверьте интернет и что hubit.zsgp.ru доступен с устройства.';
      }
      if (code === 'ECONNABORTED') {
        return 'Превышено время ожидания ответа сервера.';
      }
    }
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && 'msg' in item) {
            return String((item as { msg?: string }).msg || '');
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    if (error.message) return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
