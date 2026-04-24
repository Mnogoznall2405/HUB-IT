import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  Drawer,
  IconButton,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import FormatBoldRoundedIcon from '@mui/icons-material/FormatBoldRounded';
import FormatItalicRoundedIcon from '@mui/icons-material/FormatItalicRounded';
import FormatUnderlinedRoundedIcon from '@mui/icons-material/FormatUnderlinedRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded';
import { AnimatePresence, motion } from 'framer-motion';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { buildMailUiTokens } from './mailUiTokens';
import { buildComposeMailPreviewHtml } from './mailOutgoingPreview';
import { hasQuotedHistoryMarkup } from './mailQuotedHistory';

const renderRecipientOptionLabel = (option) => {
  if (typeof option === 'string') return option;
  return `${option.name} <${option.email}>`;
};

const renderRecipientTagLabel = (option) => {
  if (typeof option === 'string') return option;
  return option.name || option.email;
};

const getDraftStatusLabel = (state) => {
  if (state === 'synced') return 'Сохранено';
  if (state === 'saving') return 'Сохранение...';
  if (state === 'local_only') return 'Локально';
  return 'Новый черновик';
};

function ToolbarIcon({ label, icon, onClick, active = false }) {
  return (
    <IconButton
      aria-label={label}
      size="small"
      onClick={onClick}
      sx={{
        width: 36,
        height: 36,
        borderRadius: '999px',
        color: active ? 'primary.main' : 'inherit',
        bgcolor: active ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
      }}
    >
      {icon}
    </IconButton>
  );
}

function applyQuillFormat(quillRef, format) {
  const editor = quillRef.current?.getEditor?.();
  if (!editor) return;
  editor.focus();
  const range = editor.getSelection?.(true) || { index: editor.getLength?.() || 0, length: 0 };
  const currentFormats = editor.getFormat?.(range) || {};
  editor.format(format, !currentFormats?.[format]);
}

function ComposerContent({
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
  composeFromOptions,
  composeFromMailboxId,
  onComposeFromMailboxIdChange,
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
  quotedOriginalHtml,
  composeSignatureHtml,
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
  onOpenSignatureEditor,
  onSendCompose,
  mobile,
  desktopInline,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const quillRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const photoInputRef = useRef(null);
  const initialEditorFocusHandledRef = useRef(false);
  const [showMeta, setShowMeta] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const [quoteExpanded, setQuoteExpanded] = useState(false);

  const quotePresent = Boolean(quotedOriginalHtml || hasQuotedHistoryMarkup(composeBody));
  const quoteUsesFallback = !quotedOriginalHtml && quotePresent;
  const finalPreviewHtml = useMemo(
    () => buildComposeMailPreviewHtml({
      composeBody,
      quotedOriginalHtml,
      signatureHtml: composeSignatureHtml,
    }),
    [composeBody, composeSignatureHtml, quotedOriginalHtml],
  );
  const attachmentCount = composeFiles.length + composeDraftAttachments.length;
  const attachmentSize = useMemo(
    () => formatFileSize(sumFilesSize(composeFiles) + sumAttachmentSize(composeDraftAttachments)),
    [composeDraftAttachments, composeFiles, formatFileSize, sumAttachmentSize, sumFilesSize],
  );
  const canSelectMailbox = Array.isArray(composeFromOptions) && composeFromOptions.length > 0;
  const recipientSummary = composeToValues.length > 0
    ? renderRecipientTagLabel(composeToValues[0])
    : 'Кому';
  const metaSummaryParts = [];
  if (composeSubject) metaSummaryParts.push(composeSubject);
  if (composeCcValues.length > 0) metaSummaryParts.push(`Копия ${composeCcValues.length}`);
  if (composeBccValues.length > 0) metaSummaryParts.push(`Скрытая копия ${composeBccValues.length}`);
  if (composeMode !== 'new') metaSummaryParts.push(dialogTitle);
  const metaSummary = metaSummaryParts.join(' • ') || 'Тема и детали';
  const subjectHelperText = composeFieldErrors?.subject || '';
  const draftStatusLabel = getDraftStatusLabel(draftSyncState);
  const showMetaPanel = desktopInline || showMeta;
  const customToolbarVisible = desktopInline || editorFocused || showFormatting;
  const showFinalPreview = !desktopInline && Boolean(finalPreviewHtml);
  const attachmentChips = [
    ...composeDraftAttachments.map((attachment, index) => ({
      key: `draft_${attachment.id || attachment.name || index}`,
      label: `${attachment.name || 'Вложение'} • сервер`,
      onDelete: () => onRemoveDraftAttachment?.(attachment.id),
    })),
    ...composeFiles.map((file, index) => ({
      key: `${file.name}_${index}`,
      label: `${file.name} • ${formatFileSize(file.size)}`,
      onDelete: () => onRemoveComposeFile?.(index),
    })),
  ];

  useEffect(() => {
    if (!open) {
      initialEditorFocusHandledRef.current = false;
      setShowFormatting(false);
      setEditorFocused(false);
      setQuoteExpanded(false);
      setShowMeta(false);
      return;
    }
    setShowMeta(Boolean(composeSubject || composeCcValues.length || composeBccValues.length || composeMode !== 'new'));
    if (desktopInline) {
      setShowFormatting(true);
    }
  }, [open, composeSubject, composeCcValues.length, composeBccValues.length, composeMode, desktopInline]);

  useEffect(() => {
    if (!open || initialEditorFocusHandledRef.current) return undefined;
    const timeoutId = window.setTimeout(() => {
      quillRef.current?.focus?.();
      quillRef.current?.getEditor?.()?.focus?.();
      initialEditorFocusHandledRef.current = true;
    }, 80);
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  const fieldSx = {
    '& .MuiOutlinedInput-root': {
      borderRadius: '10px',
      bgcolor: tokens.surfaceBg,
      '& fieldset': {
        borderColor: tokens.surfaceBorder,
      },
      '&:hover fieldset': {
        borderColor: tokens.panelBorder,
      },
      '&.Mui-focused fieldset': {
        borderColor: theme.palette.primary.main,
      },
    },
  };

  const inlineLabelSx = {
    width: { xs: 56, md: 72 },
    color: tokens.textSecondary,
    fontSize: '0.82rem',
    fontWeight: 700,
    flexShrink: 0,
  };

  const recipientFieldSx = {
    ...fieldSx,
    '& .MuiAutocomplete-inputRoot': {
      alignItems: 'center',
      px: '0 !important',
      py: '0 !important',
      border: 'none',
      backgroundColor: 'transparent',
    },
    '& .MuiOutlinedInput-notchedOutline': {
      border: 'none',
    },
    '& .MuiChip-root': {
      maxWidth: '100%',
      borderRadius: '999px',
    },
    '& .MuiChip-label': {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  };

  const renderRecipientAutocomplete = ({
    value,
    onChange,
    errorKey,
    placeholder,
  }) => (
    <Autocomplete
      multiple
      freeSolo
      size="small"
      sx={recipientFieldSx}
      options={composeToOptions}
      loading={composeToLoading}
      filterOptions={(options) => options}
      getOptionLabel={renderRecipientOptionLabel}
      value={value}
      onChange={(event, newValue) => onChange?.(newValue)}
      onInputChange={(event, newInputValue) => onComposeToSearchChange?.(newInputValue)}
      renderTags={(items, getTagProps) => (
        items.map((option, index) => (
          <Chip
            variant="outlined"
            size="small"
            label={renderRecipientTagLabel(option)}
            {...getTagProps({ index })}
          />
        ))
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={placeholder}
          error={Boolean(composeFieldErrors?.[errorKey])}
          helperText={composeFieldErrors?.[errorKey] || ''}
          InputProps={{
            ...params.InputProps,
            sx: {
              minHeight: 48,
              px: 0.3,
            },
          }}
        />
      )}
    />
  );

  const renderInlineFieldRow = ({ label, children, noBorder = false, align = 'center' }) => (
    <Stack
      direction="row"
      spacing={1.2}
      alignItems={align}
      sx={{
        py: 1,
        borderBottom: noBorder ? 'none' : '1px solid',
        borderColor: tokens.panelBorder,
      }}
    >
      <Typography sx={inlineLabelSx}>{label}</Typography>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        {children}
      </Box>
    </Stack>
  );

  const content = (
    <Box
      className={`mail-edge-shell ${quoteUsesFallback && !quoteExpanded ? 'mail-composer-quote-collapsed' : ''}`}
      style={tokens.typographyVars}
      sx={{
        ...tokens.typographyVars,
        '--mail-panel-bg': tokens.panelBg,
        '--mail-panel-solid': tokens.panelSolid,
        '--mail-shell-bg': tokens.panelBg,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--mail-ui-font)',
        bgcolor: tokens.panelBg,
        color: tokens.textPrimary,
        '& .MuiTypography-root, & .MuiButton-root, & .MuiInputBase-root, & .MuiChip-root, & .MuiMenuItem-root, & .MuiFormLabel-root': {
          fontFamily: 'var(--mail-ui-font)',
        },
      }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          onSendComposeShortcut?.();
        }
      }}
    >
      <Box
        className="mail-safe-top mail-glass-header"
        sx={{
          px: { xs: 1.1, md: 1.6 },
          py: desktopInline ? 1 : 0.9,
          borderBottom: '1px solid',
          borderColor: tokens.panelBorder,
          position: 'sticky',
          top: 0,
          zIndex: 3,
        }}
      >
        {desktopInline ? (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button
              data-testid="mail-compose-send-action"
              variant="contained"
              startIcon={<SendRoundedIcon fontSize="small" />}
              onClick={onSendCompose}
              disabled={composeSending}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Отправить
            </Button>
            <Button
              data-testid="mail-compose-attach-action"
              variant="text"
              startIcon={<AttachFileRoundedIcon fontSize="small" />}
              onClick={() => attachmentInputRef.current?.click()}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Вложить
            </Button>
            <Button
              data-testid="mail-compose-close-action"
              onClick={onClose}
              sx={{
                minWidth: 0,
                px: 0.6,
                textTransform: 'none',
                fontWeight: 700,
              }}
            >
              Отменить
            </Button>
            <Box sx={{ minWidth: 0, flex: 1 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 800, fontSize: '0.96rem', textAlign: 'right' }}>
                {composeSubject || dialogTitle}
              </Typography>
              <Typography noWrap sx={{ color: tokens.textSecondary, fontSize: '0.76rem', mt: 0.1, textAlign: 'right' }}>
                {draftStatusLabel}
                {draftSavedAt ? ` • ${formatFullDate(draftSavedAt)}` : ''}
              </Typography>
            </Box>
          </Stack>
        ) : (
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            data-testid="mail-compose-close-action"
            onClick={onClose}
            sx={{
              minWidth: 0,
              px: 0.4,
              textTransform: 'none',
              fontWeight: 700,
            }}
          >
            Отмена
          </Button>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography noWrap sx={{ fontWeight: 800, fontSize: '0.96rem' }}>
              {composeSubject || dialogTitle}
            </Typography>
            <Typography noWrap sx={{ color: tokens.textSecondary, fontSize: '0.76rem', mt: 0.1 }}>
              {draftStatusLabel}
              {draftSavedAt ? ` • ${formatFullDate(draftSavedAt)}` : ''}
            </Typography>
          </Box>
          <IconButton
            data-testid="mail-compose-send-action"
            aria-label="Отправить"
            onClick={onSendCompose}
            disabled={composeSending}
            sx={{
              width: 40,
              height: 40,
              borderRadius: '999px',
              color: 'primary.contrastText',
              bgcolor: theme.palette.primary.main,
              '&:hover': {
                bgcolor: theme.palette.primary.dark,
              },
            }}
          >
            <SendRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>
        )}
        {composeSending && composeFiles.length > 0 ? (
          <Box sx={{ mt: 0.9 }}>
            {composeUploadProgress > 0 ? (
              <LinearProgress variant="determinate" value={composeUploadProgress} />
            ) : (
              <LinearProgress />
            )}
          </Box>
        ) : null}
      </Box>

      <Box
        className="mail-scroll-hidden"
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          px: { xs: 1.1, md: 1.6 },
          pb: 1.2,
        }}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <Stack spacing={1.05} sx={{ pt: 1.1 }}>
          {composeError ? (
            <Alert severity="error" onClose={onClearComposeError} sx={{ borderRadius: '10px' }}>
              {composeError}
            </Alert>
          ) : null}

          {(Array.isArray(composeWarnings) ? composeWarnings : []).map((warning) => (
            <Alert
              key={warning.id || warning.message}
              severity={warning.severity || 'warning'}
              onClose={warning.dismissible === false ? undefined : () => onDismissComposeWarning?.(warning.id)}
              sx={{ borderRadius: '10px' }}
            >
              {warning.message}
            </Alert>
          ))}

          {desktopInline ? (
            <Box
              data-testid="mail-compose-inline-fields"
              sx={{
                borderRadius: '10px',
                border: '1px solid',
                borderColor: tokens.panelBorder,
                bgcolor: tokens.panelBg,
                px: 1.2,
              }}
            >
              {renderInlineFieldRow({
                label: 'Кому',
                children: renderRecipientAutocomplete({
                  value: composeToValues,
                  onChange: onComposeToValuesChange,
                  errorKey: 'to',
                  placeholder: recipientSummary,
                }),
              })}
              {renderInlineFieldRow({
                label: 'Копия',
                children: renderRecipientAutocomplete({
                  value: composeCcValues,
                  onChange: onComposeCcValuesChange,
                  errorKey: 'cc',
                  placeholder: 'Копия',
                }),
              })}
              {composeBccValues.length > 0 ? renderInlineFieldRow({
                label: 'СК',
                children: renderRecipientAutocomplete({
                  value: composeBccValues,
                  onChange: onComposeBccValuesChange,
                  errorKey: 'bcc',
                  placeholder: 'Скрытая копия',
                }),
              }) : null}
              {renderInlineFieldRow({
                label: 'Тема',
                align: 'flex-start',
                children: (
                  <TextField
                    data-testid="mail-compose-subject-field"
                    fullWidth
                    size="small"
                    value={composeSubject}
                    onChange={(event) => onComposeSubjectChange?.(event.target.value)}
                    placeholder="Добавьте тему"
                    error={Boolean(composeFieldErrors?.subject)}
                    helperText={subjectHelperText}
                    sx={fieldSx}
                  />
                ),
              })}
              {(canSelectMailbox || onOpenSignatureEditor || composeMode !== 'new') ? (
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="space-between"
                  flexWrap="wrap"
                  useFlexGap
                  sx={{ py: 0.9 }}
                >
                  {canSelectMailbox ? (
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                      <Typography sx={{ ...inlineLabelSx, width: 'auto' }}>От</Typography>
                      <Box sx={{ minWidth: 180, maxWidth: 320, flex: '1 1 220px' }}>
                        <Select
                          size="small"
                          fullWidth
                          value={composeFromMailboxId || ''}
                          onChange={(event) => onComposeFromMailboxIdChange?.(String(event.target.value || ''))}
                          sx={{
                            borderRadius: '12px',
                            bgcolor: tokens.surfaceBg,
                            '& .MuiOutlinedInput-notchedOutline': {
                              borderColor: tokens.surfaceBorder,
                            },
                          }}
                        >
                          {composeFromOptions.map((mailbox) => (
                            <MenuItem key={String(mailbox?.id || mailbox?.mailbox_email || '')} value={String(mailbox?.id || '')}>
                              {mailbox?.label || mailbox?.mailbox_email || mailbox?.effective_mailbox_login || 'Без названия'}
                            </MenuItem>
                          ))}
                        </Select>
                      </Box>
                    </Stack>
                  ) : <Box />}
                  <Stack direction="row" spacing={1} alignItems="center">
                    {composeMode !== 'new' ? (
                      <Typography sx={{ color: tokens.textSecondary, fontSize: '0.76rem' }}>
                        {dialogTitle}
                      </Typography>
                    ) : null}
                    {onOpenSignatureEditor ? (
                      <Button
                        data-testid="mail-compose-open-signature"
                        onClick={onOpenSignatureEditor}
                        sx={{
                          minWidth: 0,
                          px: 0.4,
                          textTransform: 'none',
                          fontWeight: 700,
                        }}
                      >
                        Подпись
                      </Button>
                    ) : null}
                  </Stack>
                </Stack>
              ) : null}
            </Box>
          ) : (
          <>
          <Box sx={{ borderBottom: '1px solid', borderColor: tokens.panelBorder, pb: 0.8 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography sx={{ width: 36, color: tokens.textSecondary, fontSize: '0.82rem', fontWeight: 700 }}>
                Кому
              </Typography>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                {renderRecipientAutocomplete({
                  value: composeToValues,
                  onChange: onComposeToValuesChange,
                  errorKey: 'to',
                  placeholder: recipientSummary,
                })}
              </Box>
            </Stack>
          </Box>

          <Button
            data-testid="mail-compose-meta-toggle"
            onClick={() => setShowMeta((prev) => !prev)}
            sx={{
              minHeight: 42,
              px: 0.4,
              justifyContent: 'space-between',
              textTransform: 'none',
              color: tokens.textPrimary,
            }}
          >
            <Stack spacing={0.1} alignItems="flex-start" sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.86rem' }}>
                Тема и детали
              </Typography>
              <Typography className="mail-line-clamp-2" sx={{ color: tokens.textSecondary, fontSize: '0.76rem', textAlign: 'left' }}>
                {metaSummary}
              </Typography>
            </Stack>
            <ExpandMoreRoundedIcon
              sx={{
                transform: showMeta ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.18s ease',
              }}
            />
          </Button>

          <AnimatePresence initial={false}>
            {showMetaPanel ? (
              <Box
                component={motion.div}
                initial={{ opacity: 0, height: 0, y: -8 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                sx={{
                  overflow: 'hidden',
                  borderRadius: '12px',
                  bgcolor: tokens.surfaceBg,
                  border: '1px solid',
                  borderColor: tokens.surfaceBorder,
                  p: 1,
                }}
              >
                <Stack spacing={1}>
                  {canSelectMailbox ? (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography sx={{ width: 44, color: tokens.textSecondary, fontSize: '0.8rem', fontWeight: 700 }}>
                        От
                      </Typography>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Select
                          size="small"
                          fullWidth
                          value={composeFromMailboxId || ''}
                          onChange={(event) => onComposeFromMailboxIdChange?.(String(event.target.value || ''))}
                          sx={{
                            borderRadius: '10px',
                            bgcolor: tokens.panelBg,
                            '& .MuiOutlinedInput-notchedOutline': {
                              borderColor: tokens.surfaceBorder,
                            },
                          }}
                        >
                          {composeFromOptions.map((mailbox) => (
                            <MenuItem key={String(mailbox?.id || mailbox?.mailbox_email || '')} value={String(mailbox?.id || '')}>
                              {mailbox?.label || mailbox?.mailbox_email || mailbox?.effective_mailbox_login || 'Без названия'}
                            </MenuItem>
                          ))}
                        </Select>
                      </Box>
                    </Stack>
                  ) : null}

                  <TextField
                    data-testid="mail-compose-subject-field"
                    fullWidth
                    size="small"
                    value={composeSubject}
                    onChange={(event) => onComposeSubjectChange?.(event.target.value)}
                    placeholder="Тема письма"
                    error={Boolean(composeFieldErrors?.subject)}
                    helperText={subjectHelperText}
                    sx={fieldSx}
                  />

                  {renderRecipientAutocomplete({
                    value: composeCcValues,
                    onChange: onComposeCcValuesChange,
                    errorKey: 'cc',
                    placeholder: 'Копия',
                  })}

                  {renderRecipientAutocomplete({
                    value: composeBccValues,
                    onChange: onComposeBccValuesChange,
                    errorKey: 'bcc',
                    placeholder: 'Скрытая копия',
                  })}

                  {composeMode !== 'new' ? (
                    <Typography sx={{ color: tokens.textSecondary, fontSize: '0.76rem' }}>
                      {dialogTitle}
                    </Typography>
                  ) : null}

                  {onOpenSignatureEditor ? (
                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                      <Typography sx={{ color: tokens.textSecondary, fontSize: '0.8rem', fontWeight: 700 }}>
                        Подпись
                      </Typography>
                      <Button
                        data-testid="mail-compose-open-signature"
                        onClick={onOpenSignatureEditor}
                        sx={{
                          minWidth: 0,
                          px: 0.4,
                          textTransform: 'none',
                          fontWeight: 700,
                        }}
                      >
                        Открыть
                      </Button>
                    </Stack>
                  ) : null}
                </Stack>
              </Box>
            ) : null}
          </AnimatePresence>
          </>
          )}

          {attachmentChips.length > 0 ? (
            <Box className="mail-scroll-hidden" sx={{ overflowX: 'auto', pb: 0.2 }}>
              <Stack direction="row" spacing={0.75} sx={{ width: 'max-content', minWidth: '100%' }}>
                {attachmentChips.map((item) => (
                  <Chip
                    key={item.key}
                    icon={<AttachFileRoundedIcon sx={{ fontSize: '15px !important' }} />}
                    label={item.label}
                    onDelete={item.onDelete}
                    sx={{
                      maxWidth: 260,
                      height: 34,
                      bgcolor: tokens.surfaceBg,
                      border: '1px solid',
                      borderColor: tokens.surfaceBorder,
                      '& .MuiChip-label': {
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    }}
                  />
                ))}
              </Stack>
            </Box>
          ) : null}

          {attachmentCount > 0 ? (
            <Typography sx={{ color: tokens.textSecondary, fontSize: '0.76rem' }}>
              {`${attachmentCount} вложений • ${attachmentSize}`}
            </Typography>
          ) : null}

          <Box
            data-testid="mail-compose-editor-shell"
            data-mail-message-font={tokens.messageFontFamily}
            sx={{
              minHeight: mobile ? 320 : (desktopInline ? 360 : 420),
              borderRadius: desktopInline ? '12px' : '14px',
              border: '1px solid',
              borderColor: composeDragActive || editorFocused ? theme.palette.primary.main : tokens.surfaceBorder,
              bgcolor: tokens.panelBg,
              fontFamily: 'var(--mail-message-font)',
              overflow: 'hidden',
              transition: 'border-color 0.18s ease, box-shadow 0.18s ease',
              boxShadow: composeDragActive || editorFocused ? `0 0 0 3px ${alpha(theme.palette.primary.main, tokens.isDark ? 0.22 : 0.13)}` : 'none',
              '& .ql-toolbar': {
                display: 'none',
              },
              '& .ql-container': {
                border: 'none',
                fontFamily: 'var(--mail-message-font)',
                fontSize: '16px',
                color: tokens.textPrimary,
              },
              '& .ql-editor': {
                minHeight: mobile ? '44dvh' : (desktopInline ? '38dvh' : '50dvh'),
                padding: mobile ? '18px 16px 20px' : (desktopInline ? '18px 18px 22px' : '20px 22px 24px'),
                fontFamily: 'var(--mail-message-font)',
                fontSize: '16px',
                lineHeight: 1.65,
                color: tokens.textPrimary,
              },
              '& .ql-editor.ql-blank::before': {
                color: tokens.textSecondary,
                fontStyle: 'normal',
                left: mobile ? 16 : (desktopInline ? 18 : 22),
              },
              '& .ql-editor p': {
                margin: 0,
              },
              '& .ql-editor p + p': {
                marginTop: '0.68em',
              },
              '& .ql-editor blockquote': {
                margin: '1.1em 0 0',
                padding: '0 0 0 14px',
                borderLeft: '3px solid',
                borderColor: tokens.surfaceBorder,
                color: tokens.textSecondary,
                fontFamily: 'var(--mail-message-font)',
                fontSize: '14px',
                lineHeight: 1.55,
              },
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData?.files || []);
              if (files.length > 0) onComposePasteFiles?.(files);
            }}
          >
            <ReactQuill
              ref={quillRef}
              theme="snow"
              value={composeBody}
              onChange={onComposeBodyChange}
              onFocus={() => setEditorFocused(true)}
              onBlur={() => {
                window.setTimeout(() => {
                  setEditorFocused(false);
                }, 80);
              }}
              modules={{ toolbar: false }}
              placeholder={composeMode === 'forward'
                ? 'Добавьте комментарий перед пересылаемым письмом'
                : composeMode === 'reply' || composeMode === 'reply_all'
                  ? 'Введите ответ над цитатой исходного письма'
                  : 'Напишите письмо'}
            />
          </Box>

          {quotePresent ? (
            <Button
              data-testid="mail-compose-quote-toggle"
              onClick={() => setQuoteExpanded((prev) => !prev)}
              sx={{
                alignSelf: 'flex-start',
                px: 0.2,
                minWidth: 0,
                textTransform: 'none',
                color: tokens.textSecondary,
                fontWeight: 700,
              }}
            >
              {quoteExpanded ? 'Свернуть цитату' : 'Развернуть цитату'}
            </Button>
          ) : null}

          {quotedOriginalHtml && quoteExpanded ? (
            <Box
              data-testid="mail-compose-quoted-original"
              sx={{
                mt: -0.1,
                borderLeft: '3px solid',
                borderColor: tokens.surfaceBorder,
                pl: 1.6,
                color: tokens.textSecondary,
                fontFamily: 'var(--mail-message-font)',
                fontSize: '0.88rem',
                lineHeight: 1.6,
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                '& p': { m: 0 },
                '& p + p': { mt: '0.7em' },
                '& img, & video, & iframe': { maxWidth: '100%', height: 'auto' },
                '& blockquote': {
                  m: '0.8em 0 0',
                  pl: 1.3,
                  borderLeft: '3px solid',
                  borderColor: tokens.surfaceBorder,
                  color: tokens.textSecondary,
                },
              }}
              dangerouslySetInnerHTML={{ __html: quotedOriginalHtml }}
            />
          ) : null}

          {showFinalPreview ? (
            <Box
              data-testid="mail-compose-final-preview"
              sx={{
                borderRadius: '12px',
                border: '1px solid',
                borderColor: tokens.surfaceBorder,
                bgcolor: tokens.surfaceBg,
                overflow: 'hidden',
              }}
            >
              <Stack spacing={0.8} sx={{ p: 1.1 }}>
                <Typography sx={{ color: tokens.textSecondary, fontSize: '0.76rem', fontWeight: 700 }}>
                  Итоговый вид
                </Typography>
                <Box
                  data-testid="mail-compose-final-preview-body"
                  data-mail-message-font={tokens.messageFontFamily}
                  sx={{
                    maxHeight: mobile ? 220 : 260,
                    overflowY: 'auto',
                    borderRadius: '8px',
                    border: '1px solid',
                    borderColor: tokens.surfaceBorder,
                    bgcolor: 'transparent',
                    px: 1.6,
                    py: 1.35,
                    color: tokens.textPrimary,
                    fontFamily: 'var(--mail-message-font)',
                    fontSize: '0.95rem',
                    lineHeight: 1.5,
                    '& p, & div': { margin: 0 },
                    '& p + p, & p + div, & div + p, & div + div': { marginTop: '0.55em' },
                    '& img, & video, & iframe': { maxWidth: '100%', height: 'auto' },
                    '& blockquote': {
                      margin: '0.8em 0 0',
                      padding: '0 0 0 12px',
                      borderLeft: '3px solid',
                      borderColor: tokens.surfaceBorder,
                      color: tokens.textSecondary,
                    },
                  }}
                  dangerouslySetInnerHTML={{ __html: finalPreviewHtml }}
                />
              </Stack>
            </Box>
          ) : null}
        </Stack>
      </Box>

      <AnimatePresence initial={false}>
        {customToolbarVisible ? (
          <Box
            component={motion.div}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.18 }}
            sx={{
              borderTop: '1px solid',
              borderColor: tokens.panelBorder,
              bgcolor: tokens.panelSolid,
              px: 1,
              pt: 0.8,
              pb: 'calc(8px + env(safe-area-inset-bottom, 0px))',
            }}
          >
            <AnimatePresence initial={false}>
              {showFormatting ? (
                <Box
                  component={motion.div}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  sx={{ overflow: 'hidden' }}
                >
                  <Stack direction="row" spacing={0.6} sx={{ px: 0.25, pb: 0.7 }}>
                    <ToolbarIcon
                      label="Жирный"
                      icon={<FormatBoldRoundedIcon fontSize="small" />}
                      onClick={() => applyQuillFormat(quillRef, 'bold')}
                    />
                    <ToolbarIcon
                      label="Курсив"
                      icon={<FormatItalicRoundedIcon fontSize="small" />}
                      onClick={() => applyQuillFormat(quillRef, 'italic')}
                    />
                    <ToolbarIcon
                      label="Подчеркивание"
                      icon={<FormatUnderlinedRoundedIcon fontSize="small" />}
                      onClick={() => applyQuillFormat(quillRef, 'underline')}
                    />
                  </Stack>
                </Box>
              ) : null}
            </AnimatePresence>

            <Stack direction="row" spacing={0.4} alignItems="center" justifyContent="space-between">
              <Stack direction="row" spacing={0.35} alignItems="center">
                <ToolbarIcon
                  label="Форматирование"
                  icon={<TextFieldsRoundedIcon fontSize="small" />}
                  onClick={() => setShowFormatting((prev) => !prev)}
                  active={showFormatting}
                />
                <ToolbarIcon
                  label="Прикрепить файл"
                  icon={<AttachFileRoundedIcon fontSize="small" />}
                  onClick={() => attachmentInputRef.current?.click()}
                />
                <ToolbarIcon
                  label="Добавить фото"
                  icon={<ImageRoundedIcon fontSize="small" />}
                  onClick={() => photoInputRef.current?.click()}
                />
              </Stack>

              {composeSending && composeFiles.length > 0 ? (
                <Button
                  onClick={onCancelComposeUpload}
                  sx={{ minWidth: 0, textTransform: 'none', fontWeight: 700 }}
                >
                  Отмена загрузки
                </Button>
              ) : desktopInline ? null : (
                <IconButton aria-label="Закрыть форматирование" onClick={() => setShowFormatting(false)}>
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>
          </Box>
        ) : null}
      </AnimatePresence>

      <input ref={attachmentInputRef} type="file" multiple hidden onChange={onFileChange} />
      <input ref={photoInputRef} type="file" accept="image/*" multiple hidden onChange={onFileChange} />
    </Box>
  );

  return content;
}

export default function MailComposeDialog(props) {
  const mobile = props.layoutMode === 'mobile';
  const desktopInline = props.layoutMode === 'desktop-inline';
  const content = <ComposerContent {...props} mobile={mobile} desktopInline={desktopInline} />;

  if (mobile) {
    return (
      <Dialog
        open={props.open}
        onClose={props.onClose}
        fullScreen
        PaperProps={{ 'data-testid': 'mail-compose-mobile-paper' }}
      >
        {content}
      </Dialog>
    );
  }

  if (desktopInline) {
    return (
      <Box
        data-testid="mail-compose-inline-pane"
        sx={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {content}
      </Box>
    );
  }

  return (
    <Drawer
      anchor="right"
      open={props.open}
      onClose={props.onClose}
      PaperProps={{
        'data-testid': 'mail-compose-desktop-paper',
        sx: {
          width: { xs: '100vw', sm: 640, lg: 720, xl: 780 },
          maxWidth: '100vw',
        },
      }}
      ModalProps={{ keepMounted: true }}
    >
      {content}
    </Drawer>
  );
}
