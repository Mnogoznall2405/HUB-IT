import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

const IMPORTANCE_OPTIONS = [
  { value: '', label: 'Любая важность' },
  { value: 'high', label: 'Высокая' },
  { value: 'normal', label: 'Обычная' },
  { value: 'low', label: 'Низкая' },
];

const FOLDER_SCOPE_OPTIONS = [
  { value: 'current', label: 'Текущая папка' },
  { value: 'all', label: 'Все папки' },
];

export default function MailAdvancedSearchDialog({
  open,
  filters,
  recentSearches,
  onClose,
  onChange,
  onApply,
  onReset,
  onApplyRecent,
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Расширенный поиск</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Grid container spacing={1.2}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                size="small"
                label="Отправитель"
                value={filters?.from_filter || ''}
                onChange={(event) => onChange('from_filter', event.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                size="small"
                label="Получатель"
                value={filters?.to_filter || ''}
                onChange={(event) => onChange('to_filter', event.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                size="small"
                label="Тема"
                value={filters?.subject_filter || ''}
                onChange={(event) => onChange('subject_filter', event.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                size="small"
                label="Содержимое"
                value={filters?.body_filter || ''}
                onChange={(event) => onChange('body_filter', event.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                select
                fullWidth
                size="small"
                label="Важность"
                value={filters?.importance || ''}
                onChange={(event) => onChange('importance', event.target.value)}
              >
                {IMPORTANCE_OPTIONS.map((option) => (
                  <MenuItem key={option.value || 'all'} value={option.value}>{option.label}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                select
                fullWidth
                size="small"
                label="Область поиска"
                value={filters?.folder_scope || 'current'}
                onChange={(event) => onChange('folder_scope', event.target.value)}
              >
                {FOLDER_SCOPE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                size="small"
                label="Общий запрос"
                value={filters?.q || ''}
                onChange={(event) => onChange('q', event.target.value)}
              />
            </Grid>
          </Grid>

          {Array.isArray(recentSearches) && recentSearches.length > 0 ? (
            <Stack spacing={0.7}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                Недавние поиски
              </Typography>
              <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
                {recentSearches.map((item, index) => (
                  <Button
                    key={`${item?.label || item?.q || 'recent'}_${index}`}
                    size="small"
                    variant="outlined"
                    onClick={() => onApplyRecent(item)}
                    sx={{ textTransform: 'none', borderRadius: '999px' }}
                  >
                    {item?.label || item?.q || 'Поиск'}
                  </Button>
                ))}
              </Stack>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onReset}>Сбросить</Button>
        <Button onClick={onClose}>Закрыть</Button>
        <Button variant="contained" onClick={onApply}>Применить</Button>
      </DialogActions>
    </Dialog>
  );
}
