import { useCallback } from 'react';

export default function useMailAiErrorHandler({
  getMailErrorDetail,
  setError,
} = {}) {
  return useCallback((requestError) => {
    setError(getMailErrorDetail(requestError, 'Не удалось выполнить AI-действие для письма.'));
  }, [getMailErrorDetail, setError]);
}
