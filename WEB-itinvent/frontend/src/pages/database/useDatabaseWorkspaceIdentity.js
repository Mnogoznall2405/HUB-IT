import { useCallback, useState } from 'react';

import { equipmentAPI } from '../../api/client';

const buildWorkspaceSuccessMessage = (response = {}) => (
  `${response.message}. Найдено ${response.total_items_count} ед. оборудования. Связанные отмечены галочками.`
);

export function useDatabaseWorkspaceIdentity({
  setSearchQuery,
  runSearchNow,
  setSelectedItems,
  notifyDatabaseSuccess,
  notifyDatabaseError,
  selectionDelayMs = 300,
} = {}) {
  const [identifyPCLoading, setIdentifyPCLoading] = useState(false);

  const handleIdentifyWorkspace = useCallback(async () => {
    try {
      setIdentifyPCLoading(true);
      const response = await equipmentAPI.identifyWorkspace();

      if (response?.success && response?.owner_info?.owner_name) {
        const ownerName = response.owner_info.owner_name;
        setSearchQuery?.(ownerName);
        runSearchNow?.(ownerName);

        if (Array.isArray(response.linked_inv_nos) && response.linked_inv_nos.length > 0) {
          setTimeout(() => {
            setSelectedItems?.(response.linked_inv_nos.map(String));
          }, selectionDelayMs);
        }

        notifyDatabaseSuccess?.(buildWorkspaceSuccessMessage(response));
        return response;
      }

      notifyDatabaseError?.(response?.message || 'ПК не найден по вашему IP.');
      return response;
    } catch (err) {
      console.error('Error identifying workspace:', err);
      const detail = err?.response?.data?.detail || err?.message || 'неизвестная ошибка';
      notifyDatabaseError?.(`Ошибка при определении рабочего места: ${detail}`);
      return null;
    } finally {
      setIdentifyPCLoading(false);
    }
  }, [
    notifyDatabaseError,
    notifyDatabaseSuccess,
    runSearchNow,
    selectionDelayMs,
    setSearchQuery,
    setSelectedItems,
  ]);

  return {
    identifyPCLoading,
    handleIdentifyWorkspace,
  };
}

export default useDatabaseWorkspaceIdentity;
