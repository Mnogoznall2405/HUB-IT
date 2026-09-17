import DocumentPreviewDialog from '../../components/documentPreview/DocumentPreviewDialog';
import MailAttachmentPreviewDialog from '../../components/mail/MailAttachmentPreviewDialog';
import { MAX_PREVIEW_FILE_BYTES } from '../../components/mail/mailMessageFileActions';
import HubNomenclatureMatchDialog from './HubNomenclatureMatchDialog';
import InventoryTaskDialog from './InventoryTaskDialog';
import EquipmentHistoryDialog from './EquipmentHistoryDialog';
import { MovementDetailDialog } from './warehouse1cMovementDetail';

// Secondary dialogs rendered next to the employee equipment dialog: act file
// preview, Hub↔1C nomenclature match, movement detail + attachment preview,
// equipment transfer history and the inventory task form.
export default function EmployeeEquipmentSubDialogs({
  isMobile,
  stackAboveParent,
  ownerNo,
  employeeName,
  currentActPreview,
  closeCurrentActPreview,
  hubMatchOpen,
  hubMatchRow,
  hubMatchWarehouse,
  onCloseHubMatch,
  onOpenInvNo,
  onOpenInWarehouse1C,
  movementDetail,
  historyState,
  onCloseHistory,
  inventoryTaskOpen,
  discrepanciesText,
  onCloseInventoryTask,
  onOpenTasks,
}) {
  return (
    <>
      <DocumentPreviewDialog
        open={Boolean(currentActPreview?.open)}
        title={currentActPreview?.title || 'Акт'}
        subtitle={currentActPreview?.subtitle || ''}
        kind={currentActPreview?.kind || 'pdf'}
        objectUrl={currentActPreview?.objectUrl || ''}
        loading={Boolean(currentActPreview?.loading)}
        error={currentActPreview?.error || ''}
        onClose={closeCurrentActPreview}
        onDownloadOriginal={currentActPreview?.previewBlob && currentActPreview?.objectUrl ? () => {
          const link = document.createElement('a');
          link.href = currentActPreview.objectUrl;
          link.download = currentActPreview.title || 'act.pdf';
          link.click();
        } : undefined}
        canDownloadOriginal={Boolean(currentActPreview?.previewBlob)}
      />

      <HubNomenclatureMatchDialog
        open={hubMatchOpen}
        row={hubMatchRow}
        warehouse={hubMatchWarehouse}
        ownerNo={ownerNo}
        employeeName={employeeName || ''}
        onClose={onCloseHubMatch}
        onOpenInvNo={onOpenInvNo}
        onOpenInWarehouse1C={onOpenInWarehouse1C}
        stackAboveParent={stackAboveParent}
      />

      <MovementDetailDialog
        {...movementDetail.dialogProps}
        fullScreen={isMobile}
      />

      <MailAttachmentPreviewDialog
        {...movementDetail.previewDialogProps}
        maxPreviewFileBytes={MAX_PREVIEW_FILE_BYTES}
      />

      <EquipmentHistoryDialog
        open={historyState.open}
        invNo={historyState.invNo}
        rows={historyState.rows}
        loading={historyState.loading}
        error={historyState.error}
        onClose={onCloseHistory}
        fullScreen={isMobile}
      />

      <InventoryTaskDialog
        open={inventoryTaskOpen}
        employeeName={employeeName}
        description={discrepanciesText}
        onClose={onCloseInventoryTask}
        onOpenTasks={onOpenTasks}
      />
    </>
  );
}
