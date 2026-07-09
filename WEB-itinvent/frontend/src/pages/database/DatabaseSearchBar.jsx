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
  const actionHover = ui?.actionHover || alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.06);
  const textSecondary = ui?.textSecondary || theme.palette.text.secondary;
  const textPrimary = ui?.textPrimary || theme.palette.text.primary;
  const selectedBg = ui?.selectedBg || alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.12);
  const selectedBorder = ui?.selectedBorder || alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.45 : 0.28);

  return (
    <Box sx={{ mb: compact ? 0.75 : 2 }}>
      {showScopeToggle ? (
        <Box sx={{ mb: compact ? 0.75 : 1 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={searchScope}
            onChange={(_, nextScope) => {
              if (!nextScope) return;
              onSearchScopeChange(nextScope);
            }}
            sx={{
              bgcolor: panelBg,
              border: '1px solid',
              borderColor: borderSoft,
              borderRadius: compact ? '10px' : '12px',
              p: 0.25,
              '& .MuiToggleButtonGroup-grouped': {
                border: 0,
                borderRadius: compact ? '8px !important' : '10px !important',
                mx: 0.25,
                px: compact ? 1.1 : 1.5,
                py: compact ? 0.35 : 0.5,
                textTransform: 'none',
                fontSize: compact ? '0.78rem' : '0.85rem',
                color: textSecondary,
                '&.Mui-selected': {
                  bgcolor: panelSolid,
                  color: textPrimary,
                  fontWeight: 600,
                  boxShadow: theme.palette.mode === 'dark'
                    ? '0 1px 4px rgba(0,0,0,0.45)'
                    : '0 1px 3px rgba(15,23,42,0.10)',
                  border: '1px solid',
                  borderColor: selectedBorder,
                  '&:hover': {
                    bgcolor: panelSolid,
                  },
                },
                '&:hover': {
                  bgcolor: actionHover,
                },
              },
            }}
          >
            <ToggleButton value={SEARCH_SCOPE_EQUIPMENT}>Оборудование</ToggleButton>
            <ToggleButton value={SEARCH_SCOPE_ACTS}>Акты</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      ) : null}

      <TextField
        placeholder={
          isConsumablesMode
            ? 'Поиск по ID, типу, модели...'
            : isActsScope
              ? 'Поиск по № акта, сотруднику, инв. №...'
              : 'Поиск по инв. №, модели, сотруднику...'
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
          '& .MuiOutlinedInput-root': {
            borderRadius: compact ? 2 : 3,
            bgcolor: panelBg,
            color: textPrimary,
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
            py: compact ? 0.75 : 1.1,
            fontSize: compact ? '0.85rem' : undefined,
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
