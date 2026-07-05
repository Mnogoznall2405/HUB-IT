export const buildMobileTaskCardMenuItems = ({ canEdit = false, canDelete = false } = {}) => (
  [
    canEdit ? { key: 'edit', label: 'Редактировать' } : null,
    { key: 'copy', label: 'Копировать ссылку' },
    canDelete ? { key: 'delete', label: 'Удалить', tone: 'danger' } : null,
  ].filter(Boolean)
);
