import {
  Button,
  CircularProgress,
  Chip,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FilterListIcon from '@mui/icons-material/FilterList';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { formatDateTime } from './addressBookUtils';

export default function AddressBookMobileToolbar({
  total = 0,
  shownCount = 0,
  query = '',
  searchInputRef,
  onQueryChange,
  onQueryKeyDown,
  onClearQuery,
  filterCount = 0,
  onOpenFilters,
  isAdmin = false,
  syncing = false,
  statusUpdatedAt = '',
  statusLoading = false,
  syncInProgress = false,
  syncFailed = false,
  syncError = '',
  onSync,
}) {
  const countLabel = total > shownCount
    ? `Найдено ${total}, показано ${shownCount}`
    : `Найдено ${total}`;

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
                disabled={syncing || syncInProgress}
                aria-label="Обновить из 1С"
                data-testid="address-book-sync-button"
              >
                {syncing || syncInProgress ? <CircularProgress size={18} color="inherit" /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>
      </Stack>

      <Typography variant="caption" color="text.secondary">
        {countLabel}
        {statusUpdatedAt ? ` · Обновлено: ${formatDateTime(statusUpdatedAt)}` : ''}
      </Typography>
      {statusLoading || syncInProgress || syncFailed ? (
        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" alignItems="center">
          {statusLoading ? <Chip label="Проверяем статус…" size="small" variant="outlined" /> : null}
          {syncInProgress ? <Chip label="Идёт обновление" size="small" color="info" variant="outlined" /> : null}
          {syncFailed ? (
            <Tooltip title={isAdmin ? syncError || 'Последняя синхронизация завершилась ошибкой' : ''}>
              <Chip
                label={isAdmin ? 'Ошибка синхронизации' : 'Данные могут быть неактуальны'}
                aria-label={isAdmin && syncError ? `Ошибка синхронизации: ${syncError}` : undefined}
                size="small"
                color="warning"
                variant="outlined"
                data-testid="address-book-sync-status"
              />
            </Tooltip>
          ) : null}
        </Stack>
      ) : null}

      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          fullWidth
          size="small"
          placeholder="ФИО, телефон, отдел"
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
          inputProps={{
            'data-testid': 'address-book-search-input',
            'aria-label': 'Поиск по адресной книге',
            'aria-keyshortcuts': '/',
            // inputProps lands on the real <input> — needed for blur().
            onKeyDown: onQueryKeyDown,
          }}
          sx={{
            '& .MuiOutlinedInput-notchedOutline': { borderRadius: 0.5 },
          }}
        />
        {onOpenFilters ? (
          <Button
            size="small"
            variant={filterCount > 0 ? 'contained' : 'outlined'}
            startIcon={<FilterListIcon sx={{ fontSize: 18 }} />}
            onClick={onOpenFilters}
            aria-label={filterCount > 0 ? `Фильтры, выбрано ${filterCount}` : 'Фильтры'}
            data-testid="address-book-filters-button"
            sx={{ height: 44, minWidth: 0, flexShrink: 0, textTransform: 'none', whiteSpace: 'nowrap' }}
          >
            {filterCount > 0 ? `Фильтры (${filterCount})` : 'Фильтры'}
          </Button>
        ) : null}
      </Stack>
    </Stack>
  );
}
