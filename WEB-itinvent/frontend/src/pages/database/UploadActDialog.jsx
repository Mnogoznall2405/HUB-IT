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
  reminderBinding = null,
  reminderLoading = false,
  reminderError = '',
  onOpenReminderTask,
  onRefreshReminder,
  file = null,
  previewUrl = '',
  previewError = '',
  onOpenPreview,
  parsing = false,
  committing = false,
  onFileSelect,
  onParse,
  error = '',
  onErrorClear,
  draft = null,
  form,
  autoEmail = true,
  invVerification,
  invVerified = false,
  onFieldChange,
  onInvNosChange,
  onAutoEmailChange,
  onInvVerifiedChange,
  commitResult = null,
  commitDisabled = true,
  onCommit,
  emailSubject = '',
  emailBody = '',
  emailRecipientOptions = [],
  emailRecipients = [],
  emailRecipientsInput = '',
  emailRecipientsLoading = false,
  emailLoading = false,
  emailStatus = '',
  emailError = '',
  emailLastRecipients = [],
  emailSummary,
  onEmailSubjectChange,
  onEmailBodyChange,
  onEmailRecipientsInputChange,
  onEmailRecipientsChange,
  onEmailErrorClear,
  onEmailSend,
  getEmailStatusItemSx,
}) {
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
                  file={file}
                  previewUrl={previewUrl}
                  previewError={previewError}
                  onOpenPreview={onOpenPreview}
                />

                <Box sx={{ display: 'grid', gap: 2 }}>
                  <UploadActPdfParsePanel
                    file={file}
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

                <UploadActEmailStatusList
                  recipients={emailLastRecipients}
                  getItemSx={getEmailStatusItemSx}
                />
              </Box>
            </Fade>
          </Collapse>
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button
          onClick={onClose}
          variant="outlined"
          disabled={parsing || committing || emailLoading}
        >
          {hasCommitResult ? 'Готово' : 'Закрыть'}
        </Button>
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
