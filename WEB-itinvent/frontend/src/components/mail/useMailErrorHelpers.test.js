import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  getMailErrorCode,
  getMailErrorDetail,
  isMissingMailDetailError,
} from './mailErrorModel';
import useMailErrorHelpers from './useMailErrorHelpers';

describe('useMailErrorHelpers', () => {
  it('exposes the shared mail error helpers', () => {
    const { result } = renderHook(() => useMailErrorHelpers());
    const error = { response: { data: { detail: 'Нет доступа' } } };

    expect(result.current.getMailErrorDetail(error, 'fallback')).toBe('Нет доступа');
    expect(result.current.getMailErrorDetail).toBe(getMailErrorDetail);
    expect(result.current.getMailErrorCode).toBe(getMailErrorCode);
    expect(result.current.isMissingMailDetailError).toBe(isMissingMailDetailError);
  });
});
