export const buildTaskActionMenuItems = ({
  canUploadAct = false,
  canStart = false,
  canSubmit = false,
  canReview = false,
  canClose = false,
  canReopen = false,
  canEdit = false,
  canDelete = false,
} = {}) => (
  [
    canUploadAct ? { key: 'upload_act', label: 'Загрузить акт' } : null,
    canStart ? { key: 'start', label: 'В работу' } : null,
    canSubmit ? { key: 'submit', label: 'Отправить на проверку' } : null,
    canReview ? { key: 'review', label: 'Принять' } : null,
    canClose ? { key: 'close', label: 'Закрыть' } : null,
    canReopen ? { key: 'reopen', label: 'Вернуть в работу' } : null,
    canEdit ? { key: 'edit', label: 'Редактировать' } : null,
    { key: 'copy', label: 'Копировать ссылку' },
    canDelete ? { key: 'delete', label: 'Удалить', tone: 'danger' } : null,
  ].filter(Boolean)
);

export const buildMobileTaskCardMenuItems = ({
  canEdit = false,
  canDelete = false,
  canUploadAct = false,
  canStart = false,
  canSubmit = false,
  canReview = false,
  canClose = false,
  canReopen = false,
} = {}) => buildTaskActionMenuItems({
  canUploadAct,
  canStart,
  canSubmit,
  canReview,
  canClose,
  canReopen,
  canEdit,
  canDelete,
});
