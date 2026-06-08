import React from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { alpha, useTheme } from '@mui/material/styles';
import { formatDateTime } from './passwordVaultUtils';

export default function PasswordEntryDetail({
  entry,
  revealed = '',
  revealBusy = false,
  canWrite = false,
  compact = false,
  onCopyPassword,
  onCopyLogin,
  onShow,
  onHide,
  onEdit,
  onArchive,
}) {
  const theme = useTheme();
  const [menuAnchor, setMenuAnchor] = React.useState(null);

  if (!entry) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: compact ? 120 : 280,
          border: `1px dashed ${theme.palette.divider}`,
          bgcolor: alpha(theme.palette.background.paper, 0.5),
          p: 3,
        }}
        data-testid="password-entry-detail-empty"
      >
        <Typography variant="body2" color="text.secondary" textAlign="center">
          Выберите запись из списка, чтобы скопировать логин или пароль.
        </Typography>
      </Box>
    );
  }

  const passwordVisible = Boolean(revealed);
  const masked = entry.password_configured ? '••••••••••••' : '—';

  return (
    <Box
      data-testid="password-entry-detail"
      sx={{
        border: `1px solid ${theme.palette.divider}`,
        bgcolor: alpha(theme.palette.background.paper, 0.82),
        p: compact ? 2 : 2.5,
        minHeight: compact ? 'auto' : 280,
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="overline" color="text.secondary">
              {entry.group || 'Без группы'}
            </Typography>
            <Typography variant="h6" fontWeight={800} sx={{ wordBreak: 'break-word' }}>
              {entry.login || '—'}
            </Typography>
          </Box>
          {canWrite ? (
            <>
              <IconButton
                size="small"
                aria-label={`Действия ${entry.login}`}
                onClick={(event) => setMenuAnchor(event.currentTarget)}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
              <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
                <MenuItem
                  onClick={() => {
                    setMenuAnchor(null);
                    onEdit?.(entry);
                  }}
                >
                  <EditOutlinedIcon fontSize="small" sx={{ mr: 1 }} />
                  Редактировать
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setMenuAnchor(null);
                    onArchive?.(entry);
                  }}
                  sx={{ color: 'error.main' }}
                >
                  Архивировать
                </MenuItem>
              </Menu>
            </>
          ) : null}
        </Stack>

        {entry.tags?.length ? (
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
            {entry.tags.map((tag) => (
              <Chip key={tag} size="small" label={tag} variant="outlined" />
            ))}
          </Stack>
        ) : null}

        {entry.description ? (
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
            {entry.description}
          </Typography>
        ) : null}

        <Box
          sx={{
            px: 1.5,
            py: 1.25,
            borderRadius: 0.5,
            bgcolor: alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.22 : 0.04),
            fontFamily: 'monospace',
            fontSize: '1rem',
            letterSpacing: 0.4,
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {revealBusy ? (
            <CircularProgress size={20} />
          ) : (
            <Typography component="span" variant="body1" sx={{ fontFamily: 'inherit' }}>
              {passwordVisible ? revealed : masked}
            </Typography>
          )}
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button
            fullWidth
            variant="contained"
            size="large"
            startIcon={<ContentCopyOutlinedIcon />}
            onClick={() => onCopyPassword?.(entry)}
            disabled={revealBusy || !entry.password_configured}
            data-testid={`password-copy-password-${entry.id}`}
            aria-label={`Скопировать пароль ${entry.login}`}
          >
            Скопировать пароль
          </Button>
          <Button
            fullWidth
            variant="outlined"
            size="large"
            startIcon={<ContentCopyOutlinedIcon />}
            onClick={() => onCopyLogin?.(entry)}
            data-testid={`password-copy-login-${entry.id}`}
          >
            Скопировать логин
          </Button>
        </Stack>

        <Stack direction="row" spacing={1}>
          {passwordVisible ? (
            <Button
              size="small"
              variant="text"
              startIcon={<VisibilityOffOutlinedIcon />}
              onClick={() => onHide?.(entry)}
              aria-label={`Скрыть пароль ${entry.login}`}
            >
              Скрыть
            </Button>
          ) : (
            <Button
              size="small"
              variant="text"
              startIcon={<VisibilityOutlinedIcon />}
              onClick={() => onShow?.(entry)}
              disabled={revealBusy || !entry.password_configured}
              aria-label={`Показать пароль ${entry.login}`}
            >
              Показать пароль
            </Button>
          )}
        </Stack>

        <Typography variant="caption" color="text.disabled">
          Обновлено {formatDateTime(entry.updated_at)}
          {entry.updated_by ? ` · ${entry.updated_by}` : ''}
        </Typography>
      </Stack>
    </Box>
  );
}
