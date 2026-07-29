import { memo } from 'react';
import {
  Box,
  IconButton,
  InputAdornment,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  alpha,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';

export const SEARCH_SCOPE_EQUIPMENT = 'equipment';
export const SEARCH_SCOPE_ACTS = 'acts';

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
}) {
  const showScopeToggle = !isConsumablesMode && typeof onSearchScopeChange === 'function';
  const isActsScope = searchScope === SEARCH_SCOPE_ACTS;
  const panelBg = ui?.panelBg || alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.04);
  const panelSolid = ui?.panelSolid || theme.palette.background.paper;
  const borderSoft = ui?.borderSoft || theme.palette.divider;
  const borderStrong = ui?.borderStrong || theme.palette.divider;
  const actionHover = ui?.actionHover || alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.06);
  const textSecondary = ui?.textSecondary || theme.palette.text.secondary;
  const textPrimary = ui?.textPrimary || theme.palette.text.primary;
  const scopeHeight = compact ? 30 : 40;

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
            p: compact ? 0.1 : 0.15,
            height: scopeHeight,
            '& .MuiToggleButtonGroup-grouped': {
              border: 0,
              borderRadius: '3px !important',
              mx: 0.05,
              px: compact ? 0.55 : 1.25,
              py: 0,
              minWidth: compact ? 48 : 88,
              minHeight: compact ? 26 : 36,
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

      <TextField
        placeholder={
          isConsumablesMode
            ? 'Поиск по ID, типу, модели...'
            : isActsScope
              ? 'Поиск по № акта или фамилии...'
              : 'Поиск по инв. №, парт. №, модели, сотруднику...'
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
          endAdornment: value ? (
            <InputAdornment position="end">
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
            </InputAdornment>
          ) : null,
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
