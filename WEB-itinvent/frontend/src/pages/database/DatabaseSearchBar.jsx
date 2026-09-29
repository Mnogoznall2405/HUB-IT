import { memo } from 'react';
import {
  Autocomplete,
  Box,
  CircularProgress,
  IconButton,
  InputAdornment,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  alpha,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import CloudOffIcon from '@mui/icons-material/CloudOff';

export const SEARCH_SCOPE_EQUIPMENT = 'equipment';
export const SEARCH_SCOPE_ACTS = 'acts';

// Single-field scopes for the universal search bar — values map to the
// backend field allowlist on /equipment/search/universal.
// Memoized so every keystroke in the search input does not re-render the
// (relatively heavy) field select and type Autocomplete.
const SearchFilterControls = memo(function SearchFilterControls({
  showFieldSelect,
  showTypeSelect,
  searchField,
  onSearchFieldChange,
  typeOptions,
  searchTypeNo,
  onSearchTypeChange,
  compact,
  scopeHeight,
  panelBg,
  borderSoft,
  textPrimary,
  textSecondary,
}) {
  return (
    <>
      {showFieldSelect ? (
        <TextField
          select
          size="small"
          value={searchField || ''}
          onChange={(e) => onSearchFieldChange(e.target.value)}
          SelectProps={{
            displayEmpty: true,
            renderValue: (selected) => (
              SEARCH_FIELD_OPTIONS.find((f) => f.value === selected)?.label || 'Везде'
            ),
            MenuProps: { sx: { maxHeight: 320 } },
          }}
          inputProps={{ 'aria-label': 'Поле поиска' }}
          sx={{
            flexShrink: 0,
            width: compact ? 108 : 150,
            '& .MuiOutlinedInput-root': {
              borderRadius: '4px',
              bgcolor: panelBg,
              color: textPrimary,
              height: scopeHeight,
              fontSize: compact ? '0.78rem' : '0.875rem',
            },
            '& fieldset': { borderColor: borderSoft },
            '& .MuiSelect-select': {
              py: 0,
              display: 'flex',
              alignItems: 'center',
              color: textPrimary,
            },
            '& .MuiSvgIcon-root': { color: textSecondary },
          }}
        >
          {SEARCH_FIELD_OPTIONS.map((field) => (
            <MenuItem key={field.value || 'all'} value={field.value} dense>
              {field.label}
            </MenuItem>
          ))}
        </TextField>
      ) : null}

      {showTypeSelect ? (
        <Autocomplete
          size="small"
          options={typeOptions}
          value={
            typeOptions.find(
              (type) => Number(type?.type_no) === Number(searchTypeNo)
            ) || null
          }
          onChange={(_, option) => onSearchTypeChange(option?.type_no ?? null)}
          getOptionLabel={(type) => String(type?.type_name || '')}
          isOptionEqualToValue={(option, value) =>
            Number(option?.type_no) === Number(value?.type_no)
          }
          noOptionsText="Тип не найден"
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Тип"
              inputProps={{
                ...params.inputProps,
                'aria-label': 'Фильтр по типу оборудования',
              }}
            />
          )}
          sx={{
            flexShrink: 0,
            width: compact ? 132 : 210,
            '& .MuiAutocomplete-inputRoot': {
              borderRadius: '4px',
              bgcolor: panelBg,
              color: textPrimary,
              height: scopeHeight,
              fontSize: compact ? '0.78rem' : '0.875rem',
              py: '0 !important',
              pr: '56px !important',
            },
            '& fieldset': { borderColor: borderSoft },
            '& .MuiAutocomplete-input': {
              py: '0 !important',
              height: '100%',
              boxSizing: 'border-box',
            },
            '& .MuiAutocomplete-input::placeholder': {
              color: textSecondary,
              opacity: 1,
            },
            '& .MuiAutocomplete-endAdornment': { top: '50%', transform: 'translateY(-50%)' },
            '& .MuiSvgIcon-root': { color: textSecondary },
          }}
        />
      ) : null}
    </>
  );
});

export const SEARCH_FIELD_OPTIONS = [
  { value: '', label: 'Везде' },
  { value: 'model', label: 'Модель' },
  { value: 'serial', label: 'Серийный №' },
  { value: 'inv_no', label: 'Инв. №' },
  { value: 'part_no', label: 'Парт. №' },
  { value: 'employee', label: 'Сотрудник' },
  { value: 'branch', label: 'Филиал' },
  { value: 'location', label: 'Локация' },
  { value: 'status', label: 'Статус' },
  { value: 'vendor', label: 'Производитель' },
  { value: 'type', label: 'Тип (текст)' },
  { value: 'ip', label: 'IP' },
  { value: 'mac', label: 'MAC' },
  { value: 'netbios', label: 'Сетевое имя' },
];

const DatabaseSearchBar = memo(function DatabaseSearchBar({
  isConsumablesMode = false,
  searchScope = SEARCH_SCOPE_EQUIPMENT,
  onSearchScopeChange,
  value = '',
  onChange,
  onKeyDown,
  onClear,
  theme,
  ui,
  compact = false,
  loading = false,
  degraded = false,
  typeOptions = [],
  searchTypeNo = null,
  onSearchTypeChange,
  searchField = '',
  onSearchFieldChange,
}) {
  const showScopeToggle = !isConsumablesMode && typeof onSearchScopeChange === 'function';
  const isActsScope = searchScope === SEARCH_SCOPE_ACTS;
  const showTypeSelect =
    !isConsumablesMode && !isActsScope && typeof onSearchTypeChange === 'function';
  const showFieldSelect =
    !isConsumablesMode && !isActsScope && typeof onSearchFieldChange === 'function';
  const panelBg = ui?.panelBg || alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.04);
  const panelSolid = ui?.panelSolid || theme.palette.background.paper;
  const borderSoft = ui?.borderSoft || theme.palette.divider;
  const borderStrong = ui?.borderStrong || theme.palette.divider;
  const actionHover = ui?.actionHover || alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.06);
  const textSecondary = ui?.textSecondary || theme.palette.text.secondary;
  const textPrimary = ui?.textPrimary || theme.palette.text.primary;
  const scopeHeight = compact ? 44 : 40;

  return (
    <Box
      sx={{
        mb: compact ? 0.5 : 1.25,
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 0.5 : 1,
        flexDirection: 'row',
      }}
    >
      {showScopeToggle ? (
        <ToggleButtonGroup
          exclusive
          size="small"
          value={searchScope}
          aria-label="Область поиска"
          onChange={(_, nextScope) => {
            if (!nextScope) return;
            onSearchScopeChange(nextScope);
          }}
          sx={{
            flexShrink: 0,
            bgcolor: panelBg,
            border: '1px solid',
            borderColor: borderSoft,
            borderRadius: '4px',
            p: compact ? 0 : 0.15,
            height: scopeHeight,
            '& .MuiToggleButtonGroup-grouped': {
              border: 0,
              borderRadius: '3px !important',
              mx: 0.05,
              px: compact ? 0.55 : 1.25,
              py: 0,
              minWidth: compact ? 48 : 88,
              minHeight: compact ? 44 : 36,
              textTransform: 'none',
              fontSize: compact ? '0.68rem' : '0.8125rem',
              fontWeight: 500,
              lineHeight: 1.2,
              color: textSecondary,
              '&.Mui-selected, &.Mui-selected:hover': {
                // Neutral surface — no primary/blue wash (office segmented control).
                bgcolor: `${panelSolid} !important`,
                color: `${textPrimary} !important`,
                fontWeight: 600,
                boxShadow: 'none',
                border: '1px solid',
                borderColor: borderStrong,
              },
              '&:hover': {
                bgcolor: actionHover,
              },
            },
          }}
        >
          <ToggleButton value={SEARCH_SCOPE_EQUIPMENT}>Карточки</ToggleButton>
          <ToggleButton value={SEARCH_SCOPE_ACTS}>Акты</ToggleButton>
        </ToggleButtonGroup>
      ) : null}

      {showFieldSelect || showTypeSelect ? (
        <SearchFilterControls
          showFieldSelect={showFieldSelect}
          showTypeSelect={showTypeSelect}
          searchField={searchField}
          onSearchFieldChange={onSearchFieldChange}
          typeOptions={Array.isArray(typeOptions) ? typeOptions : []}
          searchTypeNo={searchTypeNo}
          onSearchTypeChange={onSearchTypeChange}
          compact={compact}
          scopeHeight={scopeHeight}
          panelBg={panelBg}
          borderSoft={borderSoft}
          textPrimary={textPrimary}
          textSecondary={textSecondary}
        />
      ) : null}

      <TextField
        placeholder={
          isConsumablesMode
            ? 'Поиск по ID, типу, модели...'
            : isActsScope
              ? 'Поиск по № акта или фамилии...'
              : (SEARCH_FIELD_OPTIONS.find((f) => f.value === searchField)?.label
                  && searchField
                  ? `Поиск по полю «${SEARCH_FIELD_OPTIONS.find((f) => f.value === searchField).label}»...`
                  : 'Поиск по инв. №, парт. №, модели, сотруднику...')
        }
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        size="small"
        fullWidth
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ color: textSecondary }} />
            </InputAdornment>
          ),
          endAdornment: (
            <InputAdornment position="end">
              {loading ? <CircularProgress size={18} sx={{ color: textSecondary, mr: 0.5 }} /> : null}
              {degraded ? (
                <Tooltip title="Сервер поиска недоступен — показаны совпадения только по загруженным данным">
                  <IconButton
                    size="small"
                    tabIndex={0}
                    aria-label="Сервер поиска недоступен — показаны совпадения только по загруженным данным"
                    disableRipple
                    sx={{ color: theme.palette.warning.main, mr: 0.5, cursor: 'help', p: 0.25 }}
                  >
                    <CloudOffIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
              {value ? (
                <IconButton
                  size="small"
                  onClick={onClear}
                  aria-label="Очистить поиск"
                  sx={{
                    bgcolor: actionHover,
                    color: textSecondary,
                    '&:hover': { bgcolor: alpha(textSecondary, theme.palette.mode === 'dark' ? 0.18 : 0.12) },
                  }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              ) : null}
            </InputAdornment>
          ),
        }}
        sx={{
          flex: 1,
          minWidth: 0,
          '& .MuiOutlinedInput-root': {
            borderRadius: '4px',
            bgcolor: panelBg,
            color: textPrimary,
            height: scopeHeight,
            transition: theme.transitions.create(['background-color', 'box-shadow', 'border-color'], {
              duration: theme.transitions.duration.shorter,
            }),
            '& fieldset': {
              borderColor: borderSoft,
              borderWidth: 1,
            },
            '&:hover fieldset': {
              borderColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.45 : 0.25),
            },
            '&.Mui-focused': {
              bgcolor: theme.palette.mode === 'dark'
                ? alpha(theme.palette.primary.main, 0.10)
                : alpha(theme.palette.primary.main, 0.06),
              boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.12)}`,
              '& fieldset': {
                borderColor: theme.palette.primary.main,
              },
            },
          },
          '& .MuiOutlinedInput-input': {
            py: 0,
            fontSize: compact ? '0.85rem' : '0.875rem',
            '&::placeholder': {
              color: textSecondary,
              opacity: 1,
            },
          },
        }}
      />
    </Box>
  );
});

export default DatabaseSearchBar;
