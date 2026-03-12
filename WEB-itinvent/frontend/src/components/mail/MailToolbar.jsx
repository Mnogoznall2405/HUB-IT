import { useMemo } from 'react';
import {
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import FilterListIcon from '@mui/icons-material/FilterList';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { buildMailUiTokens } from './mailUiTokens';

const iconButtonSx = (tokens) => ({
  width: 36,
  height: 36,
  borderRadius: '10px',
  border: '1px solid',
  borderColor: tokens.actionBorder,
  bgcolor: tokens.actionBg,
  color: tokens.iconColor,
  '&:hover': {
    borderColor: tokens.surfaceBorder,
    bgcolor: tokens.actionHover,
  },
});

export default function MailToolbar({
  mailboxEmail,
  search,
  onSearchChange,
  onRefresh,
  onCompose,
  onOpenAdvancedSearch,
  onOpenToolsMenu,
  loading = false,
  searchPlaceholder = 'Поиск по теме, отправителю...',
  searchInputRef,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);

  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 1.2, md: 1.4 },
        borderRadius: '14px',
        border: '1px solid',
        borderColor: tokens.panelBorder,
        bgcolor: tokens.panelBg,
        boxShadow: tokens.shadow,
      }}
    >
      <Stack spacing={1.2}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={0.8} alignItems="center" sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1.05rem', color: tokens.textPrimary }}>
              Почта
            </Typography>
            {mailboxEmail ? (
              <Chip
                size="small"
                label={mailboxEmail}
                sx={{
                  maxWidth: { xs: 170, sm: 260 },
                  bgcolor: tokens.surfaceBg,
                  border: '1px solid',
                  borderColor: tokens.surfaceBorder,
                  color: tokens.textPrimary,
                  '& .MuiChip-label': {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontWeight: 600,
                  },
                }}
              />
            ) : null}
          </Stack>

          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Обновить">
              <span>
                <IconButton size="small" onClick={onRefresh} disabled={loading} sx={iconButtonSx(tokens)}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Расширенный поиск">
              <IconButton size="small" onClick={onOpenAdvancedSearch} sx={iconButtonSx(tokens)}>
                <FilterListIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={onCompose}
              sx={{
                minHeight: 36,
                px: 1.3,
                textTransform: 'none',
                borderRadius: '10px',
                fontWeight: 700,
                boxShadow: 'none',
              }}
            >
              Написать
            </Button>
            <Tooltip title="Еще">
              <IconButton size="small" onClick={onOpenToolsMenu} sx={iconButtonSx(tokens)}>
                <MoreHorizIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        <TextField
          inputRef={searchInputRef}
          size="small"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" sx={{ color: tokens.iconColor }} />
              </InputAdornment>
            ),
            sx: {
              borderRadius: '10px',
              bgcolor: tokens.actionBg,
              color: tokens.textPrimary,
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: tokens.actionBorder,
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: tokens.surfaceBorder,
              },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: theme.palette.primary.main,
              },
            },
          }}
          fullWidth
        />
      </Stack>
    </Paper>
  );
}
