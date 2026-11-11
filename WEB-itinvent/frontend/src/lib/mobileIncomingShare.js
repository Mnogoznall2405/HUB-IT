export const MOBILE_INCOMING_SHARE_EVENT = 'hubit:mobile-incoming-share';
export const MOBILE_INCOMING_SHARE_GLOBAL = '__HUBIT_MOBILE_INCOMING_SHARE__';

export const normalizeMobileIncomingShare = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const schemaVersion = Number(value.schemaVersion || 0);
  const id = String(value.id || '').trim().slice(0, 100);
  const target = String(value.target || '').trim();
  const text = String(value.text || '').slice(0, 20_000);
  const subject = String(value.subject || '').trim().slice(0, 500);
  const receivedAt = Number(value.receivedAt || 0);
  if (schemaVersion !== 1 || !id || !['mail', 'task'].includes(target) || !text.trim() || !receivedAt) return null;
  return { schemaVersion, id, target, text, subject, receivedAt };
};

export const buildTaskDraftFromMobileIncomingShare = (value) => {
  const share = normalizeMobileIncomingShare(value);
  if (!share || share.target !== 'task') return null;
  const firstLine = share.text.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || '';
  let title = share.subject || firstLine;
  if (/^https?:\/\/\S+$/i.test(title)) title = 'Задача по ссылке';
  title = title.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (title.length < 3) title = 'Новая задача';
  return {
    title,
    description: share.text,
  };
};

export const consumeMobileIncomingShare = (
  target,
  runtimeWindow = typeof window === 'undefined' ? undefined : window,
) => {
  if (!runtimeWindow?.__HUBIT_MOBILE_APP__) return null;
  const normalizedTarget = String(target || '').trim();
  const share = normalizeMobileIncomingShare(runtimeWindow[MOBILE_INCOMING_SHARE_GLOBAL]);
  if (!share || share.target !== normalizedTarget) return null;
  try {
    delete runtimeWindow[MOBILE_INCOMING_SHARE_GLOBAL];
  } catch {
    runtimeWindow[MOBILE_INCOMING_SHARE_GLOBAL] = null;
  }
  return share;
};
