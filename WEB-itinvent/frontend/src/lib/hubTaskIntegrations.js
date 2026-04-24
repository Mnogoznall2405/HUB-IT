export const isTransferActUploadTask = (task) =>
  String(task?.integration_kind || '').trim().toLowerCase() === 'transfer_act_upload';

export const getTransferActUploadUrl = (task) =>
  String(task?.integration_payload?.upload_url || '').trim();

export const getTransferActPendingGroupsCount = (task) => {
  const rawValue = Number(task?.integration_payload?.pending_groups_total || 0);
  return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 0;
};

export const isTransferActUploadCompleted = (task) => {
  if (!isTransferActUploadTask(task)) return false;
  const status = String(task?.status || '').trim().toLowerCase();
  return status === 'done' || getTransferActPendingGroupsCount(task) === 0;
};

export const canOpenTransferActUpload = (task) =>
  isTransferActUploadTask(task)
  && !isTransferActUploadCompleted(task)
  && getTransferActUploadUrl(task).length > 0;

export const getTransferActReminderLabel = (task) => {
  const pendingGroupsCount = getTransferActPendingGroupsCount(task);
  if (pendingGroupsCount > 0) return `Осталось актов: ${pendingGroupsCount}`;
  return 'Акты загружены';
};
