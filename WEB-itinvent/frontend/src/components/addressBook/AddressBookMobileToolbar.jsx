import {
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { formatDateTime } from './addressBookUtils';

export default function AddressBookMobileToolbar({
  total = 0,
  searchLimit = 50,
  query = '',
  searchInputRef,
  onQueryChange,
  onClearQuery,
  isAdmin = false,
  syncing = false,
  statusUpdatedAt = '',
  onSync,
}) {
  const countLabel = total > searchLimit ? `Найдено ${total}, показано ${searchLimit}` : `Найдено ${total}`;

  return (
    <Stack spacing={0.75} sx={{ flexShrink: 0 }} data-testid="address-book-mobile-toolbar">
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ minHeight: 36 }}>
        <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.2 }}>
          Адресная книга
        </Typography>
        <Stack direction="row" spacing={0.25} alignItems="center">
          {isAdmin ? (
            <Tooltip title="Обновить из 1С">
              <IconButton
                size="small"
                onClick={onSync}
                disabled={syncing}
                aria-label="Обновить из 1С"
                data-testid="address-book-sync-button"
              >
                {syncing ? <CircularProgress size={18} color="inherit" /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>
      </Stack>

      <Typography variant="caption" color="text.secondary">
        {countLabel}
        {statusUpdatedAt ? ` · Обновлено: ${formatDateTime(statusUpdatedAt)}` : ''}
      </Typography>

      <TextField
        fullWidth
        size="small"
        placeholder="ФИО, должность, подразделение, город, телефон или e-mail"
        value={query}
        onChange={onQueryChange}
        inputRef={searchInputRef}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 18 }} />
            </InputAdornment>
          ),
          endAdornment: query ? (
            <InputAdornment position="end">
              <Tooltip title="Очистить поиск">
                <IconButton
                  aria-label="Очистить поиск"
                  edge="end"
                  size="small"
                  onClick={onClearQuery}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ) : null,
          sx: { height: 36, fontSize: '0.875rem' },
        }}
        inputProps={{ 'data-testid': 'address-book-search-input' }}
        sx={{
          '& .MuiOutlinedInput-notchedOutline': { borderRadius: 0.5 },
        }}
      />
    </Stack>
  );
}
