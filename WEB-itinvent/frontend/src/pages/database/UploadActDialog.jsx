import {
  Alert,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fade,
  Paper,
  Typography,
} from '@mui/material';

import { getOfficePanelSx } from '../../theme/officeUiTokens';
import UploadActCommitResultAlerts from './UploadActCommitResultAlerts';
import UploadActDetailsForm from './UploadActDetailsForm';
import UploadActEmailForm from './UploadActEmailForm';
import UploadActEmailStatusList from './UploadActEmailStatusList';
import UploadActEmailSummaryChips from './UploadActEmailSummaryChips';
import UploadActInvVerificationPanel from './UploadActInvVerificationPanel';
import UploadActPdfParsePanel from './UploadActPdfParsePanel';
import UploadActPdfPreviewPanel from './UploadActPdfPreviewPanel';
import UploadActReminderPanel from './UploadActReminderPanel';
import UploadActResolvedItemsTable from './UploadActResolvedItemsTable';
import UploadActStepChips from './UploadActStepChips';

function UploadActDialog({
  open = false,
  onClose,
  isMobile = false,
  ui,
  step = 1,
  reminder = {},
  file = {},
  error = '',
  onErrorClear,
  draft = null,
  details = {},
  commit = {},
  email = {},
  download = {},
}) {
  const {
    binding: reminderBinding = null,
    loading: reminderLoading = false,
    error: reminderError = '',
    onOpenTask: onOpenReminderTask,
    onRefreshReminder,
  } = reminder;
  const {
    file: actFile = null,
    previewUrl = '',
    previewError = '',
    onOpenPreview,
    parsing = false,
    onFileSelect,
    onParse,
  } = file;
  const {
    form,
    autoEmail = true,
    invVerification,
    invVerified = false,
    onFieldChange,
    onInvNosChange,
    onAutoEmailChange,
    onInvVerifiedChange,
  } = details;
  const {
    result: commitResult = null,
    disabled: commitDisabled = true,
    committing = false,
    onCommit,
  } = commit;
  const {
    subject: emailSubject = '',
    body: emailBody = '',
    recipientOptions: emailRecipientOptions = [],
    recipients: emailRecipients = [],
    recipientsInput: emailRecipientsInput = '',
    recipientsLoading: emailRecipientsLoading = false,
    loading: emailLoading = false,
    status: emailStatus = '',
    error: emailError = '',
    lastRecipients: emailLastRecipients = [],
    summary: emailSummary,
    onSubjectChange: onEmailSubjectChange,
    onBodyChange: onEmailBodyChange,
    onRecipientsInputChange: onEmailRecipientsInputChange,
    onRecipientsChange: onEmailRecipientsChange,
    onErrorClear: onEmailErrorClear,
    onSend: onEmailSend,
    getStatusItemSx: getEmailStatusItemSx,
  } = email;
  const {
    downloading = false,
    error: downloadError = '',
    onErrorClear: onDownloadErrorClear,
    onDownload,
  } = download;
  const hasCommitResult = Boolean(commitResult);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      PaperProps={{
        sx: !isMobile
          ? {
            width: 'min(92vw, 1780px)',
            maxWidth: '1780px',
          }
          : undefined,
      }}
    >
      <DialogTitle>Загрузка подписанного акта</DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Box sx={{ display: 'grid', gap: 2 }}>
          <UploadActStepChips
            activeStep={step}
            sx={getOfficePanelSx(ui, {
              p: 1.5,
              borderRadius: 2,
              backgroundColor: ui?.panelBg,
              boxShadow: 'none',
            })}
          />

          <UploadActReminderPanel
            binding={reminderBinding}
            loading={reminderLoading}
            error={reminderError}
            onOpenTask={onOpenReminderTask}
            onRefreshReminder={onRefreshReminder}
          />

          <Collapse in={!hasCommitResult} mountOnEnter unmountOnExit>
            <Box sx={{ display: 'grid', gap: 2 }}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: 'minmax(420px, 0.95fr) minmax(560px, 1.2fr)' },
                  gap: 2,
                  alignItems: 'start',
                }}
              >
                <UploadActPdfPreviewPanel
                  file={actFile}
                  previewUrl={previewUrl}
                  previewError={previewError}
                  onOpenPreview={onOpenPreview}
                />

                <Box sx={{ display: 'grid', gap: 2 }}>
                  <UploadActPdfParsePanel
                    file={actFile}
                    parsing={parsing}
                    committing={committing}
                    onFileSelect={onFileSelect}
                    onParse={onParse}
                  />

                  {error && (
                    <Alert severity="error" onClose={() => onErrorClear?.()}>
                      {error}
                    </Alert>
                  )}

                  <Collapse in={Boolean(draft)} mountOnEnter unmountOnExit>
                    <Fade in={Boolean(draft)} timeout={280}>
                      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                          2. Проверка данных акта
                        </Typography>

                        {Array.isArray(draft?.warnings) && draft.warnings.length > 0 && (
                          <Alert severity="warning" sx={{ mb: 1.5 }}>
                            {draft.warnings.join(' | ')}
                          </Alert>
                        )}

                        <Box sx={{ display: 'grid', gap: 1.5 }}>
                          <UploadActDetailsForm
                            form={form}
                            autoEmail={autoEmail}
                            isMobile={isMobile}
                            onFieldChange={onFieldChange}
                            onInvNosChange={onInvNosChange}
                            onAutoEmailChange={onAutoEmailChange}
                          />

                          <UploadActInvVerificationPanel
                            verification={invVerification}
                            verified={invVerified}
                            onVerifiedChange={onInvVerifiedChange}
                          />

                          <UploadActResolvedItemsTable items={draft?.resolved_items} />
                        </Box>
                      </Paper>
                    </Fade>
                  </Collapse>
                </Box>
              </Box>
            </Box>
          </Collapse>

          <Collapse in={hasCommitResult} mountOnEnter unmountOnExit>
            <Fade in={hasCommitResult} timeout={260}>
              <Box sx={{ display: 'grid', gap: 1.5 }}>
                <UploadActCommitResultAlerts result={commitResult} />

                <UploadActEmailForm
                  subject={emailSubject}
                  body={emailBody}
                  recipientOptions={emailRecipientOptions}
                  recipients={emailRecipients}
                  recipientsInput={emailRecipientsInput}
                  recipientsLoading={emailRecipientsLoading}
                  emailLoading={emailLoading}
                  isMobile={isMobile}
                  onSubjectChange={onEmailSubjectChange}
                  onBodyChange={onEmailBodyChange}
                  onRecipientsInputChange={onEmailRecipientsInputChange}
                  onRecipientsChange={(value) => {
                    onEmailRecipientsChange?.(value);
                    onEmailErrorClear?.();
                  }}
                  onSend={onEmailSend}
                  summarySlot={<UploadActEmailSummaryChips summary={emailSummary} />}
                />

                {emailStatus && (
                  <Alert severity="success">{emailStatus}</Alert>
                )}
                {emailError && (
                  <Alert severity="warning">{emailError}</Alert>
                )}
                {downloadError && (
                  <Alert severity="warning" onClose={() => onDownloadErrorClear?.()}>
                    {downloadError}
                  </Alert>
                )}

                <UploadActEmailStatusList
                  recipients={emailLastRecipients}
                  getItemSx={getEmailStatusItemSx}
                />
              </Box>
            </Fade>
          </Collapse>
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1, flexWrap: 'wrap' }}>
        <Button
          onClick={onClose}
          variant="outlined"
          disabled={parsing || committing || emailLoading || downloading}
        >
          {hasCommitResult ? 'Готово' : 'Закрыть'}
        </Button>
        {hasCommitResult && (
          <Button
            onClick={onDownload}
            variant="contained"
            disabled={downloading || emailLoading || committing || !commitResult?.doc_no}
          >
            {downloading ? 'Скачивание...' : 'Скачать акт'}
          </Button>
        )}
        {!hasCommitResult && (
          <Button
            onClick={onCommit}
            variant="contained"
            disabled={commitDisabled}
          >
            {committing ? 'Запись...' : 'Подтвердить и записать'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default UploadActDialog;
