import { memo } from 'react';
import { Box, IconButton, InputAdornment, TextField, alpha } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';

const DatabaseSearchBar = memo(function DatabaseSearchBar({
  isConsumablesMode = false,
  value = '',
  onChange,
  onKeyDown,
  onClear,
  theme,
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <TextField
        placeholder={
          isConsumablesMode
            ? 'Поиск по ID, типу, модели...'
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
              <SearchIcon sx={{ color: theme.palette.text.secondary }} />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton
                size="small"
                onClick={onClear}
                aria-label="Очистить поиск"
                sx={{
                  bgcolor: alpha(theme.palette.text.disabled, 0.08),
                  '&:hover': { bgcolor: alpha(theme.palette.text.disabled, 0.15) },
                }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : null,
        }}
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: 3,
            bgcolor: alpha(theme.palette.text.primary, 0.04),
            transition: theme.transitions.create(['background-color', 'box-shadow', 'border-color'], {
              duration: theme.transitions.duration.shorter,
            }),
            '& fieldset': {
              borderColor: 'transparent',
              borderWidth: 1,
            },
            '&:hover fieldset': {
              borderColor: alpha(theme.palette.primary.main, 0.25),
            },
            '&.Mui-focused': {
              bgcolor: alpha(theme.palette.primary.main, 0.06),
              boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.12)}`,
              '& fieldset': {
                borderColor: theme.palette.primary.main,
              },
            },
          },
          '& .MuiOutlinedInput-input': {
            py: 1.1,
          },
        }}
      />
    </Box>
  );
});

export default DatabaseSearchBar;
