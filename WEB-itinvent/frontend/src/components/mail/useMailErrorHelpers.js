import { useCallback } from 'react';

import {
  getMailErrorCode as resolveMailErrorCode,
  getMailErrorDetail as resolveMailErrorDetail,
  getMailErrorDetailAsync as resolveMailErrorDetailAsync,
  isMissingMailDetailError as resolveIsMissingMailDetailError,
  isTransientMailRequestError as resolveIsTransientMailRequestError,
} from './mailErrorModel';

export default function useMailErrorHelpers() {
  const getMailErrorDetail = useCallback(resolveMailErrorDetail, []);
  const getMailErrorDetailAsync = useCallback(resolveMailErrorDetailAsync, []);
  const isMissingMailDetailError = useCallback(resolveIsMissingMailDetailError, []);
  const getMailErrorCode = useCallback(resolveMailErrorCode, []);
  const isTransientMailRequestError = useCallback(resolveIsTransientMailRequestError, []);
  return {
    getMailErrorDetail,
    getMailErrorDetailAsync,
    isMissingMailDetailError,
    getMailErrorCode,
    isTransientMailRequestError,
  };
}
