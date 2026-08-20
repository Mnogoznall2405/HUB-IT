import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import useMailFolderLabel from './useMailFolderLabel';

describe('useMailFolderLabel', () => {
  it('reads the current folder label map from the ref', () => {
    const folderLabelMapRef = {
      current: new Map([['custom', 'Проекты']]),
    };
    const { result } = renderHook(() => useMailFolderLabel(folderLabelMapRef));

    expect(result.current('custom')).toBe('Проекты');
    expect(result.current('inbox')).toBe('Входящие');
    expect(result.current('missing')).toBe('Письма');
  });
});
