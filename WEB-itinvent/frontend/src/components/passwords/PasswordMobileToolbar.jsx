import {
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import FilterListOutlinedIcon from '@mui/icons-material/FilterListOutlined';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';

export default function PasswordMobileToolbar({
  canWrite = false,
  loading = false,
  query = '',
  searchInputRef,
  onQueryChange,
  onUnlockClick,
  onOpenFilters,
  onRefresh,
  onCreate,
}) {
  return (
    <Stack spacing={0.75} sx={{ flexShrink: 0 }} data-testid="password-mobile-toolbar">
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ minHeight: 36 }}>
        <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.2 }}>
          Пароли
        </Typography>
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Tooltip title="2FA">
            <IconButton size="small" onClick={onUnlockClick} aria-label="2FA разблокировка">
              <LockOpenOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Фильтры">
            <IconButton
              size="small"
              onClick={onOpenFilters}
              aria-label="Фильтры"
              data-testid="password-filters-open"
            >
              <FilterListOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {canWrite ? (
            <Tooltip title="Новая запись">
              <IconButton
                size="small"
                onClick={onCreate}
                aria-label="Новая запись"
                data-testid="password-mobile-create"
              >
                <AddOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>
      </Stack>

      <Stack direction="row" spacing={0.5} alignItems="center">
        <TextField
          fullWidth
          size="small"
          placeholder="Поиск…"
          value={query}
          onChange={onQueryChange}
          inputRef={searchInputRef}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchOutlinedIcon sx={{ fontSize: 18 }} />
              </InputAdornment>
            ),
            sx: { height: 36, fontSize: '0.875rem' },
          }}
          inputProps={{ 'data-testid': 'password-search-input' }}
          sx={{
            '& .MuiOutlinedInput-notchedOutline': { borderRadius: 0.5 },
          }}
        />
        <Tooltip title="Обновить">
          <span>
            <IconButton size="small" onClick={onRefresh} disabled={loading} aria-label="Обновить пароли">
              <RefreshOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Stack>
  );
}
