import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailAiErrorHandler from './useMailAiErrorHandler';

describe('useMailAiErrorHandler', () => {
  it('maps the request into the mail AI fallback error', () => {
    const requestError = new Error('llm down');
    const getMailErrorDetail = vi.fn((_error, fallback) => fallback);
    const setError = vi.fn();
    const { result } = renderHook(() => useMailAiErrorHandler({
      getMailErrorDetail,
      setError,
    }));

    result.current(requestError);

    expect(getMailErrorDetail).toHaveBeenCalledWith(
      requestError,
      'Не удалось выполнить AI-действие для письма.',
    );
    expect(setError).toHaveBeenCalledWith('Не удалось выполнить AI-действие для письма.');
  });
});
