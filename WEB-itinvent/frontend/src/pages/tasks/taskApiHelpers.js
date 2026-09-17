export const getFileIdentity = (file) => (
  `${String(file?.name || '')}:${Number(file?.size || 0)}:${Number(file?.lastModified || 0)}`
);

export const getCreatedTaskItems = (response) => {
  if (Array.isArray(response?.items)) return response.items;
  if (response?.id) return [response];
  return [];
};

// Detail-only keys (mirrors backend _TASK_LIST_FORBIDDEN_KEYS) that must never
// leak into lean list items when patching the list with a full task payload.
const TASK_DETAIL_ONLY_KEYS = [
  'description',
  'checklist_items',
  'attachments',
  'latest_report',
  'review_comment',
  'reviewer_user_id',
  'reviewer_username',
  'reviewer_full_name',
  'observers',
  'status_history',
];

export const stripTaskDetailOnlyKeys = (task) => {
  if (!task || typeof task !== 'object') return {};
  const patch = {};
  Object.entries(task).forEach(([key, value]) => {
    if (!TASK_DETAIL_ONLY_KEYS.includes(key)) {
      patch[key] = value;
    }
  });
  return patch;
};
