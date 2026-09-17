import { useCallback, useEffect, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import { buildTransferEmailPayload } from './transferModel';

const DEFAULT_TRANSFER_EMAIL_MODE = 'old';
const NOT_ALLOWED_MESSAGE =
  'Недостаточно прав для изменения данных.';
const EMAIL_SEND_ERROR =
  'Ошибка отправки email.';

const readOwners = (response) => (Array.isArray(response?.owners) ? response.owners : []);

// E-mail domain of the transfer dialog: recipient lookup, send action and
// status reporting. transferResult arrives from useTransferActJob.
export function useTransferEmail({
  actionModal,
  canDatabaseWrite = false,
  transferResult = null,
  searchOwnersCached,
} = {}) {
  const [transferEmailMode, setTransferEmailMode] = useState(DEFAULT_TRANSFER_EMAIL_MODE);
  const [transferManualEmail, setTransferManualEmail] = useState('');
  const [transferRecipientInput, setTransferRecipientInput] = useState('');
  const [transferRecipientOptions, setTransferRecipientOptions] = useState([]);
  const [transferRecipient, setTransferRecipient] = useState(null);
  const [transferRecipientLoading, setTransferRecipientLoading] = useState(false);
  const [transferEmailLoading, setTransferEmailLoading] = useState(false);
  const [transferEmailStatus, setTransferEmailStatus] = useState('');
  const [transferEmailError, setTransferEmailError] = useState('');

  useEffect(() => {
    if (!actionModal?.open || actionModal?.type !== 'transfer') return undefined;
    if (transferEmailMode !== 'employee') {
      setTransferRecipientInput('');
      setTransferRecipientOptions([]);
      setTransferRecipient(null);
      setTransferRecipientLoading(false);
      return undefined;
    }

    const query = String(transferRecipientInput || '').trim();
    if (query.length < 2) {
      setTransferRecipientLoading(false);
      return undefined;
    }

    let canceled = false;
    setTransferRecipientLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchOwnersCached?.(query, 20);
        if (!canceled) setTransferRecipientOptions(readOwners(response));
      } catch (error) {
        console.error('Error searching email recipient employees:', error);
      } finally {
        if (!canceled) setTransferRecipientLoading(false);
      }
    }, 280);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [actionModal?.open, actionModal?.type, transferEmailMode, transferRecipientInput, searchOwnersCached]);

  const resetTransferEmail = useCallback(() => {
    setTransferEmailMode(DEFAULT_TRANSFER_EMAIL_MODE);
    setTransferManualEmail('');
    setTransferRecipientInput('');
    setTransferRecipientOptions([]);
    setTransferRecipient(null);
    setTransferRecipientLoading(false);
    setTransferEmailLoading(false);
    setTransferEmailStatus('');
    setTransferEmailError('');
  }, []);

  const handleTransferEmailSend = useCallback(async () => {
    if (!canDatabaseWrite) {
      setTransferEmailError(NOT_ALLOWED_MESSAGE);
      return null;
    }
    if (!transferResult?.acts?.length) return null;

    const { error: payloadError, payload } = buildTransferEmailPayload({
      acts: transferResult.acts,
      mode: transferEmailMode,
      manualEmail: transferManualEmail,
      recipient: transferRecipient,
    });
    if (payloadError) {
      setTransferEmailError(payloadError);
      return null;
    }
    if (!payload) return null;

    setTransferEmailLoading(true);
    setTransferEmailError('');
    setTransferEmailStatus('');
    try {
      const result = await equipmentAPI.sendTransferActsEmail(payload);
      const successCount = Number(result?.success_count || 0);
      const failedCount = Number(result?.failed_count || 0);
      const errors = Array.isArray(result?.errors) ? result.errors : [];
      setTransferEmailStatus(`Отправлено: ${successCount}, ошибок: ${failedCount}`);
      setTransferEmailError(errors.length > 0 ? errors.join('; ') : '');
      return result;
    } catch (error) {
      const apiDetail = error?.response?.data?.detail;
      setTransferEmailError(typeof apiDetail === 'string' ? apiDetail : EMAIL_SEND_ERROR);
      return null;
    } finally {
      setTransferEmailLoading(false);
    }
  }, [
    canDatabaseWrite,
    transferResult,
    transferEmailMode,
    transferManualEmail,
    transferRecipient,
  ]);

  return {
    transferEmailMode,
    setTransferEmailMode,
    transferManualEmail,
    setTransferManualEmail,
    transferRecipientInput,
    setTransferRecipientInput,
    transferRecipientOptions,
    transferRecipient,
    setTransferRecipient,
    transferRecipientLoading,
    transferEmailLoading,
    transferEmailStatus,
    setTransferEmailStatus,
    transferEmailError,
    setTransferEmailError,
    resetTransferEmail,
    handleTransferEmailSend,
  };
}

export default useTransferEmail;
