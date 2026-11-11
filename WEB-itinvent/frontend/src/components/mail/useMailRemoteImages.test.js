import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useMailRemoteImages from './useMailRemoteImages';

describe('useMailRemoteImages', () => {
  it('starts with no revealed remote images', () => {
    const { result } = renderHook(() => useMailRemoteImages());

    expect(result.current.revealedRemoteImagesByMessageId).toEqual({});
  });

  it('reveals a trimmed message id', () => {
    const { result } = renderHook(() => useMailRemoteImages());

    act(() => {
      result.current.revealRemoteImagesForMessage(' msg-1 ');
    });

    expect(result.current.revealedRemoteImagesByMessageId).toEqual({ 'msg-1': true });
  });

  it('ignores empty message ids and keeps existing reveals', () => {
    const { result } = renderHook(() => useMailRemoteImages());

    act(() => {
      result.current.revealRemoteImagesForMessage('msg-1');
      result.current.revealRemoteImagesForMessage('');
      result.current.revealRemoteImagesForMessage('   ');
    });

    expect(result.current.revealedRemoteImagesByMessageId).toEqual({ 'msg-1': true });
  });
});
