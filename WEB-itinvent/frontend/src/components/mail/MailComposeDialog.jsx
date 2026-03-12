import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SendIcon from '@mui/icons-material/Send';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { buildMailUiTokens } from './mailUiTokens';

const renderRecipientOptionLabel = (option) => {
  if (typeof option === 'string') return option;
  return `${option.name} <${option.email}>`;
};

const renderRecipientTagLabel = (option) => {
  if (typeof option === 'string') return option;
  return option.name || option.email;
};

const getDraftStatusLabel = (state) => {
  if (state === 'synced') return 'Синхронизировано';
  if (state === 'saving') return 'Сохраняется';
  if (state === 'local_only') return 'Только локально';
  return 'Новый черновик';
};

const getDraftStatusColor = (state) => {
  if (state === 'synced') return 'success';
  if (state === 'saving') return 'warning';
  if (state === 'local_only') return 'default';
  return 'default';
};

const QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['blockquote', 'link'],
    [{ align: [] }],
    ['clean'],
  ],
};

const QUILL_FORMATS = [
  'header',
  'bold',
  'italic',
  'underline',
  'strike',
  'list',
  'bullet',
  'blockquote',
  'link',
  'align',
];

function ComposeSheetContent({
  open,
  dialogTitle,
  composeMode,
  draftSyncState,
  draftSavedAt,
  composeError,
  onClearComposeError,
  formatFullDate,
  onClose,
  composeDragActive,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileChange,
  composeToOptions,
  composeToLoading,
  composeToValues,
  onComposeToValuesChange,
  onComposeToSearchChange,
  composeFieldErrors,
  composeCcValues,
  onComposeCcValuesChange,
  composeBccValues,
  onComposeBccValuesChange,
  composeSubject,
  onComposeSubjectChange,
  composeBody,
  onComposeBodyChange,
  composeDraftAttachments,
  composeFiles,
  composeWarnings,
  onDismissComposeWarning,
  onComposePasteFiles,
  onSendComposeShortcut,
  formatFileSize,
  sumFilesSize,
  sumAttachmentSize,
  onRemoveDraftAttachment,
  onRemoveComposeFile,
  composeSending,
  composeUploadProgress,
  onCancelComposeUpload,
  onClearComposeDraft,
  onSendCompose,
  mobile,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);

  useEffect(() => {
    if (!open) {
      setShowCc(false);
      setShowBcc(false);
      return;
    }
    if (composeMode === 'new' && composeCcValues.length === 0 && composeBccValues.length === 0) {
      setShowCc(false);
      setShowBcc(false);
    }
  }, [open, composeMode, composeCcValues.length, composeBccValues.length]);

  useEffect(() => {
    if (!composeMode || composeMode === 'new') return;
    if (composeCcValues.length > 0) setShowCc(true);
    if (composeBccValues.length > 0) setShowBcc(true);
  }, [composeMode, composeCcValues.length, composeBccValues.length]);

  useEffect(() => {
    if (composeCcValues.length > 0) setShowCc(true);
  }, [composeCcValues.length]);

  useEffect(() => {
    if (composeBccValues.length > 0) setShowBcc(true);
  }, [composeBccValues.length]);

  const attachmentCount = composeFiles.length + composeDraftAttachments.length;
  const attachmentSize = useMemo(
    () => formatFileSize(sumFilesSize(composeFiles) + sumAttachmentSize(composeDraftAttachments)),
    [composeFiles, composeDraftAttachments, formatFileSize, sumFilesSize, sumAttachmentSize]
  );
  const sheetWidth = mobile ? '100%' : { xs: '100vw', sm: 640, lg: 700, xl: 760 };
  const composePlaceholder = composeMode === 'forward'
    ? 'Добавьте комментарий перед пересылаемым письмом'
    : composeMode === 'reply' || composeMode === 'reply_all'
      ? 'Введите ответ над цитатой исходного письма'
      : 'Напишите письмо';

  return (
    <Box
      sx={{ width: sheetWidth, height: '100%', display: 'flex', flexDirection: 'column', bgcolor: tokens.panelSolid }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          onSendComposeShortcut?.();
        }
      }}
    >
      <Box sx={{ px: { xs: 1.4, md: 2.2 }, py: 1.4, borderBottom: '1px solid', borderColor: tokens.panelBorder, bgcolor: tokens.panelBg, position: 'sticky', top: 0, zIndex: 2 }}>
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {dialogTitle}
            </Typography>
            <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              <Chip size="small" label={getDraftStatusLabel(draftSyncState)} color={getDraftStatusColor(draftSyncState)} />
              {draftSavedAt ? (
                <Typography variant="caption" color="text.secondary">
                  {`Обновлено: ${formatFullDate(draftSavedAt)}`}
                </Typography>
              ) : null}
            </Stack>
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>

      <Box
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: { xs: 1.2, md: 2 }, py: 1.6, bgcolor: tokens.panelBg }}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <Stack spacing={1.4}>
          {composeError ? (
            <Alert severity="error" onClose={onClearComposeError} sx={{ borderRadius: '12px' }}>
              {composeError}
            </Alert>
          ) : null}

          {(Array.isArray(composeWarnings) ? composeWarnings : []).map((warning) => (
            <Alert
              key={warning.id || warning.message}
              severity={warning.severity || 'warning'}
              onClose={warning.dismissible === false ? undefined : () => onDismissComposeWarning?.(warning.id)}
              sx={{ borderRadius: '12px' }}
            >
              {warning.message}
            </Alert>
          ))}

          {composeMode !== 'new' ? (
            <Alert severity="info" sx={{ borderRadius: '12px' }}>
              {composeMode === 'reply'
                ? 'Ответ будет отправлен отправителю исходного письма.'
                : composeMode === 'reply_all'
                  ? 'Ответ будет отправлен всем участникам переписки.'
                  : composeMode === 'forward'
                    ? 'Исходное письмо будет вставлено в тело как цитата.'
                    : 'Черновик можно доработать и отправить как обычное письмо.'}
            </Alert>
          ) : null}

          <Paper variant="outlined" sx={{ p: 1.2, borderRadius: '12px', bgcolor: tokens.surfaceBg, borderColor: tokens.surfaceBorder, boxShadow: 'none' }}>
            <Stack spacing={1.1}>
              <Stack direction="row" spacing={0.7} justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                  Получатели
                </Typography>
                <Stack direction="row" spacing={0.5}>
                  <Button size="small" onClick={() => setShowCc((prev) => !prev)} sx={{ textTransform: 'none', minWidth: 0, px: 0.8 }}>
                    {showCc ? 'Скрыть копию' : 'Копия'}
                  </Button>
                  <Button size="small" onClick={() => setShowBcc((prev) => !prev)} sx={{ textTransform: 'none', minWidth: 0, px: 0.8 }}>
                    {showBcc ? 'Скрыть скрытую копию' : 'Скрытая копия'}
                  </Button>
                </Stack>
              </Stack>

              <Autocomplete
                multiple
                freeSolo
                size="small"
                options={composeToOptions}
                loading={composeToLoading}
                filterOptions={(x) => x}
                getOptionLabel={renderRecipientOptionLabel}
                value={composeToValues}
                onChange={(event, newValue) => onComposeToValuesChange(newValue)}
                onInputChange={(event, newInputValue) => onComposeToSearchChange(newInputValue)}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip variant="outlined" size="small" label={renderRecipientTagLabel(option)} {...getTagProps({ index })} />
                  ))
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Кому"
                    placeholder="Введите email или выберите контакт"
                    error={Boolean(composeFieldErrors?.to)}
                    helperText={composeFieldErrors?.to || ''}
                    InputProps={{ ...params.InputProps, sx: { borderRadius: '10px' } }}
                  />
                )}
              />

              {showCc ? (
                <Autocomplete
                  multiple
                  freeSolo
                  size="small"
                  options={composeToOptions}
                  loading={composeToLoading}
                  filterOptions={(x) => x}
                  getOptionLabel={renderRecipientOptionLabel}
                  value={composeCcValues}
                  onChange={(event, newValue) => onComposeCcValuesChange(newValue)}
                  onInputChange={(event, newInputValue) => onComposeToSearchChange(newInputValue)}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip variant="outlined" size="small" label={renderRecipientTagLabel(option)} {...getTagProps({ index })} />
                    ))
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Копия"
                      placeholder="Получатели копии"
                      error={Boolean(composeFieldErrors?.cc)}
                      helperText={composeFieldErrors?.cc || ''}
                      InputProps={{ ...params.InputProps, sx: { borderRadius: '10px' } }}
                    />
                  )}
                />
              ) : null}

              {showBcc ? (
                <Autocomplete
                  multiple
                  freeSolo
                  size="small"
                  options={composeToOptions}
                  loading={composeToLoading}
                  filterOptions={(x) => x}
                  getOptionLabel={renderRecipientOptionLabel}
                  value={composeBccValues}
                  onChange={(event, newValue) => onComposeBccValuesChange(newValue)}
                  onInputChange={(event, newInputValue) => onComposeToSearchChange(newInputValue)}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip variant="outlined" size="small" label={renderRecipientTagLabel(option)} {...getTagProps({ index })} />
                    ))
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Скрытая копия"
                      placeholder="Получатели скрытой копии"
                      error={Boolean(composeFieldErrors?.bcc)}
                      helperText={composeFieldErrors?.bcc || ''}
                      InputProps={{ ...params.InputProps, sx: { borderRadius: '10px' } }}
                    />
                  )}
                />
              ) : null}
            </Stack>
          </Paper>

          <TextField
            size="small"
            label="Тема"
            value={composeSubject}
            onChange={(event) => onComposeSubjectChange(event.target.value)}
            error={Boolean(composeFieldErrors?.subject)}
            helperText={composeFieldErrors?.subject || ''}
            InputProps={{ sx: { borderRadius: '10px' } }}
          />

          <Box
            sx={{
              minHeight: mobile ? 320 : 440,
              display: 'flex',
              flexDirection: 'column',
              borderRadius: '12px',
              overflow: 'hidden',
              bgcolor: tokens.panelBg,
              border: '1px solid',
              borderColor: tokens.panelBorder,
              boxShadow: 'none',
              '& .ql-toolbar': {
                borderColor: tokens.panelBorder,
                bgcolor: tokens.surfaceBg,
                borderTopLeftRadius: '10px',
                borderTopRightRadius: '10px',
                '& .ql-stroke': { stroke: 'text.primary' },
                '& .ql-fill': { fill: 'text.primary' },
                '& .ql-picker': { color: 'text.primary' },
              },
              '& .ql-container': {
                borderColor: tokens.panelBorder,
                borderBottomLeftRadius: '10px',
                borderBottomRightRadius: '10px',
                color: 'text.primary',
                bgcolor: tokens.panelBg,
                fontFamily: 'inherit',
                fontSize: '0.95rem',
                flex: 1,
              },
              '& .ql-editor': {
                minHeight: mobile ? '260px' : '380px',
                padding: '16px 18px',
                lineHeight: 1.55,
              },
              '& .ql-editor p': {
                margin: 0,
              },
              '& .ql-editor blockquote': {
                margin: '18px 0 0 0',
                padding: '14px 16px',
                borderLeft: '3px solid',
                borderColor: 'primary.main',
                borderRadius: '0 10px 10px 0',
                backgroundColor: 'action.hover',
                color: 'text.secondary',
              },
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData?.files || []);
              if (files.length > 0) onComposePasteFiles?.(files);
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, px: 0.3, fontWeight: 700 }}>
              Текст письма
            </Typography>
            {composeMode === 'reply' || composeMode === 'reply_all' || composeMode === 'forward' ? (
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.8, px: 0.3 }}>
                Ваш текст будет вставлен над цитатой исходного письма.
              </Typography>
            ) : null}
            <ReactQuill
              theme="snow"
              value={composeBody}
              onChange={onComposeBodyChange}
              modules={QUILL_MODULES}
              formats={QUILL_FORMATS}
              placeholder={composePlaceholder}
              style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
            />
          </Box>

          <Paper
            variant="outlined"
            sx={{
              p: 1.15,
              borderRadius: '12px',
              borderStyle: 'solid',
              borderColor: composeDragActive ? theme.palette.primary.main : tokens.surfaceBorder,
              bgcolor: composeDragActive ? tokens.selectedBg : tokens.surfaceBg,
              transition: 'all 0.15s ease',
            }}
          >
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {composeDragActive ? 'Отпустите файлы, чтобы прикрепить' : 'Вложения'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Перетащите файлы сюда, вставьте из буфера или выберите их кнопкой.
                </Typography>
              </Box>
              <Button component="label" size="small" startIcon={<AttachFileIcon />} sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>
                Выбрать файлы
                <input type="file" multiple hidden onChange={onFileChange} />
              </Button>
            </Stack>
          </Paper>

          {attachmentCount > 0 ? (
            <Stack spacing={0.8}>
              {composeFiles.length > 0 ? (
                <Alert severity="info" sx={{ borderRadius: '10px' }}>
                  Локальные файлы будут загружены при отправке письма или при закрытии черновика.
                </Alert>
              ) : null}
              <Paper variant="outlined" sx={{ p: 1, borderRadius: '10px', bgcolor: tokens.surfaceBg, borderColor: tokens.surfaceBorder, boxShadow: 'none' }}>
                <Stack direction="row" spacing={0.6} alignItems="center">
                  <AttachFileIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="body2" sx={{ fontSize: '0.8rem', fontWeight: 700 }}>
                    {`Прикреплено: ${attachmentCount} файлов • ${attachmentSize}`}
                  </Typography>
                </Stack>
              </Paper>
              <Stack spacing={0.7}>
                {composeDraftAttachments.map((attachment, index) => (
                  <Chip
                    key={`draft_att_${attachment.id || attachment.name || index}`}
                    icon={<AttachFileIcon sx={{ fontSize: '15px !important' }} />}
                    label={`${attachment.name || 'вложение'} • сервер`}
                    onDelete={() => onRemoveDraftAttachment(attachment.id)}
                    sx={{
                      justifyContent: 'space-between',
                      maxWidth: '100%',
                      '& .MuiChip-label': {
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    }}
                  />
                ))}
                {composeFiles.map((file, index) => (
                  <Chip
                    key={`${file.name}_${index}`}
                    icon={<AttachFileIcon sx={{ fontSize: '15px !important' }} />}
                    label={`${file.name} • ${formatFileSize(file.size)}`}
                    onDelete={() => onRemoveComposeFile(index)}
                    sx={{
                      justifyContent: 'space-between',
                      maxWidth: '100%',
                      '& .MuiChip-label': {
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    }}
                  />
                ))}
              </Stack>
            </Stack>
          ) : null}
        </Stack>
      </Box>

      <Divider />
      <Box sx={{ px: { xs: 1.2, md: 2 }, py: 1.2, bgcolor: tokens.panelBg, borderTop: '1px solid', borderColor: tokens.panelBorder }}>
        <Stack spacing={0.8}>
          {composeSending && composeFiles.length > 0 ? (
            <Paper variant="outlined" sx={{ p: 1, borderRadius: '10px', bgcolor: tokens.surfaceBg, borderColor: tokens.surfaceBorder, boxShadow: 'none' }}>
              <Stack spacing={0.6}>
                <Typography variant="caption" color="text.secondary">
                  {composeUploadProgress > 0 ? `Загрузка вложений: ${composeUploadProgress}%` : 'Загрузка вложений...'}
                </Typography>
                {composeUploadProgress > 0 ? (
                  <LinearProgress variant="determinate" value={composeUploadProgress} />
                ) : (
                  <LinearProgress />
                )}
              </Stack>
            </Paper>
          ) : null}

          <Stack direction="row" spacing={0.8} justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
            <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
              <Button size="small" onClick={onClearComposeDraft} sx={{ textTransform: 'none' }}>
                Очистить
              </Button>
            </Stack>
            <Stack direction="row" spacing={0.8}>
              {composeSending && composeFiles.length > 0 ? (
                <Button onClick={onCancelComposeUpload} color="warning" sx={{ textTransform: 'none' }}>
                  Отменить загрузку
                </Button>
              ) : null}
              <Button onClick={onClose} sx={{ textTransform: 'none' }}>
                Закрыть
              </Button>
              <Button
                variant="contained"
                startIcon={<SendIcon />}
                onClick={onSendCompose}
                disabled={composeSending}
                sx={{ textTransform: 'none', borderRadius: '10px', fontWeight: 700 }}
              >
                {composeSending ? 'Отправка...' : 'Отправить'}
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}

export default function MailComposeDialog(props) {
  const mobile = props.layoutMode === 'mobile';
  const content = <ComposeSheetContent {...props} mobile={mobile} />;

  if (mobile) {
    return (
      <Dialog open={props.open} onClose={props.onClose} fullScreen>
        {content}
      </Dialog>
    );
  }

  return (
    <Drawer
      anchor="right"
      open={props.open}
      onClose={props.onClose}
      PaperProps={{ sx: { width: { xs: '100vw', sm: 640, lg: 700, xl: 760 }, maxWidth: '100vw' } }}
      ModalProps={{ keepMounted: true }}
    >
      {content}
    </Drawer>
  );
}
