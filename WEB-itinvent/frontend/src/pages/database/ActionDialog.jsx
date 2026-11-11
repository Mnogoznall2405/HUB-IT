import { memo } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

import {
  TRANSFER_OPERATION_ACT_ONLY,
  TRANSFER_OPERATION_LOCATION_ONLY,
} from './equipmentModel';
import MaintenanceActionContent from './MaintenanceActionContent';
import TransferActionContent from './TransferActionContent';

export const getActionDialogTitle = ({
  type,
  componentKind,
  transferOperationMode,
} = {}) => {
  if (type === 'transfer') {
    if (transferOperationMode === TRANSFER_OPERATION_ACT_ONLY) return 'Акт без перемещения';
    if (transferOperationMode === TRANSFER_OPERATION_LOCATION_ONLY) return 'Перемещение';
    return 'Перемещение с актом';
  }
  if (type === 'cartridge') return 'Замена картриджа';
  if (type === 'battery') return 'Замена батареи';
  if (type === 'component') return componentKind === 'pc' ? 'Замена компонента ПК' : 'Замена компонента';
  if (type === 'cleaning') return 'Чистка ПК';
  return '';
};

export const getActionSelectedSummary = (selectedCount = 0) => {
  if (selectedCount > 1) return `Выбрано ${selectedCount} ед. оборудования`;
  if (selectedCount === 1) return 'Выбрано 1 ед. оборудования';
  return 'Подтвердите действие.';
};

export const getActionConfirmLabel = ({
  loading = false,
  type,
  transferOperationMode,
} = {}) => {
  if (loading) return 'Выполнение...';
  if (type !== 'transfer') return 'Подтвердить';
  if (transferOperationMode === TRANSFER_OPERATION_ACT_ONLY) return 'Создать акт';
  if (transferOperationMode === TRANSFER_OPERATION_LOCATION_ONLY) return 'Выполнить перемещение';
  return 'Выполнить перемещение с актом';
};

export const shouldShowActionConfirm = ({
  canDatabaseWrite = false,
  type,
  transferResult,
} = {}) => canDatabaseWrite && !(type === 'transfer' && transferResult);

const MAINTENANCE_ACTION_TYPES = new Set(['cartridge', 'battery', 'component', 'cleaning']);

const ActionDialog = memo(function ActionDialog({
  open = false,
  actionModal = {},
  selectedCount = 0,
  isMobile = false,
  canDatabaseWrite = false,
  actionLoading = false,
  actionError = '',
  onClose,
  onConfirm,
  transferOperationMode,
  transferResult,
  transferContentProps = {},
  maintenanceContentProps = {},
}) {
  const type = actionModal?.type;
  const componentKind = actionModal?.componentKind;
  const title = getActionDialogTitle({ type, componentKind, transferOperationMode });
  const showConfirm = shouldShowActionConfirm({ canDatabaseWrite, type, transferResult });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {getActionSelectedSummary(selectedCount)}
        </Typography>

        {type === 'transfer' && (
          <TransferActionContent {...transferContentProps} />
        )}

        {MAINTENANCE_ACTION_TYPES.has(type) && (
          <MaintenanceActionContent
            actionType={type}
            componentKind={componentKind}
            isMobile={isMobile}
            actionLoading={actionLoading}
            {...maintenanceContentProps}
          />
        )}

        {actionError && (
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            {actionError}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, justifyContent: 'flex-end', gap: 1 }}>
        <Button variant="outlined" onClick={onClose}>
          Закрыть
        </Button>
        {showConfirm && (
          <Button
            onClick={onConfirm}
            variant="contained"
            disabled={actionLoading}
          >
            {getActionConfirmLabel({
              loading: actionLoading,
              type,
              transferOperationMode,
            })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
});

export default ActionDialog;
