import { Suspense, lazy } from 'react';
import { alpha } from '@mui/material';

import EquipmentQrPrintPortal from './EquipmentQrPrintPortal';

const UploadActDialog = lazy(() => import('./UploadActDialog'));
const ActionDialog = lazy(() => import('./ActionDialog'));
const DetailQrDialog = lazy(() => import('./DetailQrDialog'));
const EquipmentQrPrintFeedback = lazy(() => import('./EquipmentQrPrintFeedback'));
const DeleteEquipmentDialog = lazy(() => import('./DeleteEquipmentDialog'));
const DeleteConsumableDialog = lazy(() => import('./DeleteConsumableDialog'));
const EditConsumableQtyDialog = lazy(() => import('./EditConsumableQtyDialog'));
const QrScannerDialog = lazy(() => import('./QrScannerDialog'));
const EquipmentActFieldsDialog = lazy(() => import('./EquipmentActFieldsDialog'));
const AddConsumableDialog = lazy(() => import('./AddConsumableDialog'));
const AddEquipmentDialog = lazy(() => import('./AddEquipmentDialog'));
const EquipmentDetailDialog = lazy(() => import('./EquipmentDetailDialog'));
const EmployeeEquipmentDialog = lazy(() => import('./EmployeeEquipmentDialog'));
const DocumentPreviewDialog = lazy(() => import('../../components/documentPreview/DocumentPreviewDialog'));

// All lazy dialogs/overlays of the Database page in one layer. Pure prop-passing
// — the container owns every handler and state piece; nothing new is created here.
export default function DatabaseDialogsLayer({
  isMobile,
  theme,
  ui,
  canDatabaseWrite,
  canViewWarehouse1C,
  isAdmin,
  formatDate,
  formatHistoryValue,
  formatHistoryTransition,
  uploadAct,
  addEquipment,
  addConsumable,
  editConsumableQty,
  detail,
  employeeDialog,
  actFields,
  actFilePreview,
  qrScanner,
  detailQr,
  qrBatchPrint,
  deleteEquipment,
  deleteConsumable,
  actionDialog,
}) {
  return (
    <>
      {uploadAct.modalOpen && (
        <Suspense fallback={null}>
          <UploadActDialog
            open={uploadAct.modalOpen}
            onClose={uploadAct.onClose}
            isMobile={isMobile}
            ui={ui}
            {...uploadAct.props}
          />
        </Suspense>
      )}

      {addEquipment.modalOpen && (
        <Suspense fallback={null}>
          <AddEquipmentDialog
            open={addEquipment.modalOpen}
            onClose={addEquipment.onClose}
            isMobile={isMobile}
            ui={ui}
            {...addEquipment.props}
          />
        </Suspense>
      )}

      {addConsumable.modalOpen && (
        <Suspense fallback={null}>
          <AddConsumableDialog
            open={addConsumable.modalOpen}
            onClose={addConsumable.onClose}
            isMobile={isMobile}
            {...addConsumable.props}
          />
        </Suspense>
      )}

      {editConsumableQty.modal.open && (
        <Suspense fallback={null}>
          <EditConsumableQtyDialog
            open={editConsumableQty.modal.open}
            isMobile={isMobile}
            {...editConsumableQty.props}
          />
        </Suspense>
      )}

      {detail.modal.open && (
        <Suspense fallback={null}>
          <EquipmentDetailDialog
            open={detail.modal.open}
            isMobile={isMobile}
            canWrite={canDatabaseWrite}
            canViewWarehouse1C={canViewWarehouse1C}
            formatDate={formatDate}
            formatHistoryValue={formatHistoryValue}
            formatHistoryTransition={formatHistoryTransition}
            {...detail.props}
          />
        </Suspense>
      )}

      {employeeDialog.state.open && (
        <Suspense fallback={null}>
          <EmployeeEquipmentDialog
            open={employeeDialog.state.open}
            ownerNo={employeeDialog.state.ownerNo}
            employeeName={employeeDialog.state.employeeName}
            warehouseRef={employeeDialog.state.warehouseRef}
            stackAboveParent={employeeDialog.state.stackAboveParent}
            canViewWarehouse1C={canViewWarehouse1C}
            allowCrossDatabase={isAdmin}
            {...employeeDialog.props}
          />
        </Suspense>
      )}

      {actFields.open && (
        <Suspense fallback={null}>
          <EquipmentActFieldsDialog
            open={actFields.open}
            isMobile={isMobile}
            formatDate={formatDate}
            {...actFields.props}
          />
        </Suspense>
      )}

      {Boolean(actFilePreview.state?.open) && (
        <Suspense fallback={null}>
          <DocumentPreviewDialog
            open={Boolean(actFilePreview.state?.open)}
            {...actFilePreview.props}
          />
        </Suspense>
      )}

      {qrScanner.open && (
        <Suspense fallback={null}>
          <QrScannerDialog
            open={qrScanner.open}
            isMobile={isMobile}
            overlayBgcolor={alpha(theme.palette.background.paper, 0.82)}
            {...qrScanner.props}
          />
        </Suspense>
      )}

      {detailQr.open && (
        <Suspense fallback={null}>
          <DetailQrDialog
            open={detailQr.open}
            isMobile={isMobile}
            equipment={detail.modal.data}
            {...detailQr.props}
          />
        </Suspense>
      )}

      <EquipmentQrPrintPortal labels={qrBatchPrint.labels} />
      {qrBatchPrint.feedback && (
        <Suspense fallback={null}>
          <EquipmentQrPrintFeedback
            feedback={qrBatchPrint.feedback}
            repeating={qrBatchPrint.printing}
            onClose={qrBatchPrint.dismissFeedback}
            onRepeat={qrBatchPrint.repeatLastPrint}
          />
        </Suspense>
      )}

      {deleteEquipment.target && (
        <Suspense fallback={null}>
          <DeleteEquipmentDialog
            target={deleteEquipment.target}
            {...deleteEquipment.props}
          />
        </Suspense>
      )}

      {deleteConsumable.target && (
        <Suspense fallback={null}>
          <DeleteConsumableDialog
            target={deleteConsumable.target}
            {...deleteConsumable.props}
          />
        </Suspense>
      )}

      {actionDialog.open && (
        <Suspense fallback={null}>
          <ActionDialog
            open={actionDialog.open}
            isMobile={isMobile}
            canDatabaseWrite={canDatabaseWrite}
            {...actionDialog.props}
          />
        </Suspense>
      )}
    </>
  );
}
