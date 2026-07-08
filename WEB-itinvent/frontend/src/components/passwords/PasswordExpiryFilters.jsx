import {
  Box,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';

export default function PasswordExpiryFilters({
  mode,
  onModeChange,
  daysThreshold,
  onDaysThresholdChange,
  query,
  onQueryChange,
  loading,
  onRefresh,
  policyDays,
  isMobile = false,
  compact = false,
}) {
  return (
    <Stack spacing={compact ? 1 : 1.5}>
      <Stack
        direction={isMobile ? 'column' : 'row'}
        spacing={compact ? 1 : 1.5}
        alignItems={isMobile ? 'stretch' : 'center'}
        justifyContent="space-between"
      >
        <ToggleButtonGroup
          exclusive
          size={isMobile ? 'medium' : 'small'}
          value={mode}
          onChange={(_event, next) => {
            if (next) onModeChange(next);
          }}
          data-testid="password-expiry-mode-tabs"
          sx={{ width: isMobile ? '100%' : 'auto' }}
        >
          <ToggleButton value="all" sx={{ flex: isMobile ? 1 : 'initial', py: compact ? 0.35 : undefined }}>
            {isMobile ? 'Все' : 'Все пользователи'}
          </ToggleButton>
          <ToggleButton value="expiring" sx={{ flex: isMobile ? 1 : 'initial', py: compact ? 0.35 : undefined }}>
            {isMobile ? 'Истекающие' : 'Только истекающие'}
          </ToggleButton>
        </ToggleButtonGroup>
        {!isMobile ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" color="text.secondary">
              Политика: {policyDays || 40} дн.
            </Typography>
            <Tooltip title="Принудительно запросить свежие данные из AD">
              <span>
                <IconButton
                  onClick={onRefresh}
                  disabled={loading}
                  aria-label="Обновить отчёт"
                  data-testid="password-expiry-refresh"
                  size="small"
                >
                  <RefreshOutlinedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        ) : null}
      </Stack>

      <Stack direction={isMobile ? 'column' : 'row'} spacing={compact ? 1 : 1.5} alignItems={isMobile ? 'stretch' : 'center'}>
        <TextField
          fullWidth
          size="small"
          label={compact ? undefined : 'Поиск по ФИО, логину или отделу'}
          placeholder="Поиск по ФИО, логину или отделу"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchOutlinedIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          inputProps={{ 'data-testid': 'password-expiry-search-input' }}
        />
        {mode === 'expiring' ? (
          <TextField
            select
            size="small"
            label="Дней до истечения"
            value={daysThreshold}
            onChange={(event) => onDaysThresholdChange(Number(event.target.value))}
            sx={{ minWidth: isMobile ? 'auto' : 148, flexShrink: 0 }}
            data-testid="password-expiry-threshold-select"
          >
            {[3, 7, 14, 21, 30, 40].map((days) => (
              <MenuItem key={days} value={days}>{days} дн.</MenuItem>
            ))}
          </TextField>
        ) : null}
      </Stack>
    </Stack>
  );
}
