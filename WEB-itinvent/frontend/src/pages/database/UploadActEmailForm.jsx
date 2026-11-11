import { memo } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Paper,
  TextField,
  Typography,
} from '@mui/material';

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const normalizeUploadActRecipientOption = (owner) => ({
  owner_no: toNumberOrNull(owner?.OWNER_NO ?? owner?.owner_no),
  owner_display_name: String(owner?.OWNER_DISPLAY_NAME || owner?.owner_display_name || '').trim(),
  owner_dept: String(owner?.OWNER_DEPT || owner?.owner_dept || '').trim(),
});

export const formatUploadActRecipientOptionLabel = (option) => {
  const mapped = normalizeUploadActRecipientOption(option);
  if (!mapped.owner_display_name) return '';
  return mapped.owner_dept
    ? `${mapped.owner_display_name} (${mapped.owner_dept})`
    : mapped.owner_display_name;
};

export const isSameUploadActRecipientOption = (option, value) => (
  toNumberOrNull(option?.OWNER_NO ?? option?.owner_no) === toNumberOrNull(value?.OWNER_NO ?? value?.owner_no)
);

const UploadActEmailForm = memo(function UploadActEmailForm({
  subject,
  body,
  recipientOptions,
  recipients,
  recipientsInput,
  recipientsLoading = false,
  emailLoading = false,
  isMobile = false,
  onSubjectChange,
  onBodyChange,
  onRecipientsInputChange,
  onRecipientsChange,
  onSend,
  summarySlot = null,
}) {
  const fieldSize = isMobile ? 'medium' : 'small';

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        4. Отправка акта по email
      </Typography>

      {summarySlot}

      <Box sx={{ display: 'grid', gap: 1.25 }}>
        <TextField
          label="Тема письма"
          value={subject}
          onChange={(event) => onSubjectChange?.(event.target.value)}
          fullWidth
          size={fieldSize}
        />
        <TextField
          label="Текст письма"
          value={body}
          onChange={(event) => onBodyChange?.(event.target.value)}
          fullWidth
          multiline
          minRows={3}
          size={fieldSize}
        />

        <Autocomplete
          multiple
          options={recipientOptions}
          loading={recipientsLoading}
          value={recipients}
          inputValue={recipientsInput}
          onInputChange={(_, value) => onRecipientsInputChange?.(value)}
          onChange={(_, value) => onRecipientsChange?.(Array.isArray(value) ? value : [])}
          getOptionLabel={formatUploadActRecipientOptionLabel}
          isOptionEqualToValue={isSameUploadActRecipientOption}
          noOptionsText="Сотрудники не найдены"
          renderInput={(params) => (
            <TextField
              {...params}
              label="Отправить еще сотрудникам"
              placeholder="Введите ФИО для поиска"
              size={fieldSize}
            />
          )}
        />

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            onClick={onSend}
            disabled={emailLoading}
            startIcon={emailLoading ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {emailLoading ? 'Отправка...' : 'Отправить выбранным'}
          </Button>
        </Box>
      </Box>
    </Paper>
  );
});

export default UploadActEmailForm;
