import { useCallback } from 'react';

import { copyMailSummaryText } from './copyMailSummaryText';

export default function useMailCopySummary({
  clipboard,
  notifyMailSuccess,
  setError,
} = {}) {
  return useCallback(
    (text) => copyMailSummaryText(text, {
      clipboard,
      onSuccess: notifyMailSuccess,
      onError: setError,
    }),
    [clipboard, notifyMailSuccess, setError],
  );
}
