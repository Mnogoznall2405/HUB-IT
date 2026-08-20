import { useCallback } from 'react';

export default function useMailComposeCloseThen({
  composeCloseRequestRef,
  closeComposeSession,
} = {}) {
  return useCallback((afterClose) => {
    const closer = composeCloseRequestRef.current;
    if (typeof closer !== 'function') {
      closeComposeSession();
      afterClose?.();
      return;
    }
    closer({ afterClose });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeComposeSession]);
}
