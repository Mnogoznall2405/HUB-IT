import { useCallback } from 'react';

export default function useMailMailboxConfigRefresh({
  mailAPI,
  activeMailboxId,
  mergeMailboxEntries,
  getMailboxEntryId,
  getMailErrorDetail,
  setMailConfigLoading,
  setMailboxInfo,
  setMailboxes,
  setSelectedMailboxId,
  setError,
} = {}) {
  return useCallback(async () => {
    setMailConfigLoading(true);
    try {
      const data = await mailAPI.getMyConfig({ mailbox_id: activeMailboxId || undefined });
      setMailboxInfo(data || null);
      setMailboxes((prev) => mergeMailboxEntries(prev, data || null));
      const resolvedMailboxId = getMailboxEntryId(data);
      if (resolvedMailboxId) {
        setSelectedMailboxId(resolvedMailboxId);
      }
      return data || null;
    } catch (requestError) {
      setMailboxInfo(null);
      setError(getMailErrorDetail(requestError, 'Не удалось загрузить почтовую конфигурацию.'));
      return null;
    } finally {
      setMailConfigLoading(false);
    }
  }, [
    activeMailboxId,
    getMailboxEntryId,
    getMailErrorDetail,
    mailAPI,
    mergeMailboxEntries,
    setError,
    setMailConfigLoading,
    setMailboxInfo,
    setMailboxes,
    setSelectedMailboxId,
  ]);
}
