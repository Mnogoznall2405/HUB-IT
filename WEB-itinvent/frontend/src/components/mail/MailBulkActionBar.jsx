import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Drawer,
  FormControl,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArchiveRoundedIcon from '@mui/icons-material/ArchiveRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DriveFileMoveRoundedIcon from '@mui/icons-material/DriveFileMoveRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import MarkEmailUnreadRoundedIcon from '@mui/icons-material/MarkEmailUnreadRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import { buildMailUiTokens, getMailSoftActionStyles } from './mailUiTokens';

function MobileBulkActionButton({ icon, label, danger = false, disabled = false, onClick, tokens }) {
  return (
    <Button
      type="button"
      disabled={disabled}
      onClick={onClick}
      sx={{
        minWidth: 0,
        width: tokens.bulkActionSize,
        height: 56,
        px: 0.25,
        py: 0.5,
        borderRadius: tokens.radiusMd,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
        color: danger
          ? (tokens.isDark ? '#fecaca' : '#b91c1c')
          : tokens.textPrimary,
        bgcolor: 'transparent',
        textTransform: 'none',
        fontWeight: 800,
        fontSize: '0.68rem',
        lineHeight: 1.1,
        transition: tokens.transition,
        '& .MuiButton-startIcon': {
          m: 0,
          '& svg': { fontSize: 21 },
        },
        '&:hover': {
          bgcolor: danger
            ? 'rgba(239, 68, 68, 0.10)'
            : tokens.actionHover,
        },
        '&:active': {
          transform: 'scale(0.98)',
        },
        '&.Mui-disabled': {
          opacity: 0.45,
        },
      }}
      startIcon={icon}
    >
      {label}
    </Button>
  );
}

export default function MailBulkActionBar({
  count,
  moveTarget,
  moveTargets,
  loading,
  onMoveTargetChange,
  onMarkRead,
  onMarkUnread,
  onArchive,
  onMove,
  onDelete,
  onClear,
  isMobile = false,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [moreOpen, setMoreOpen] = useState(false);
  const neutralActionSx = getMailSoftActionStyles(theme, tokens);
  const dangerActionSx = getMailSoftActionStyles(theme, tokens, 'error');

  if (isMobile) {
    const normalizedMoveTargets = Array.isArray(moveTargets) ? moveTargets : [];
    return (
      <>
        <Box
          data-testid="mail-mobile-bulk-header"
          sx={{
            px: 1.2,
            py: 0.75,
            minHeight: 44,
            borderBottom: '1px solid',
            borderColor: tokens.panelBorder,
            bgcolor: tokens.panelBg,
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Stack direction="row" alignItems="baseline" spacing={0.7} sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 850, fontSize: '0.9rem', color: tokens.textPrimary }}>
                {`Выбрано: ${count}`}
              </Typography>
              {loading ? (
                <Typography sx={{ fontSize: tokens.fontSizeFine, color: tokens.textSecondary, whiteSpace: 'nowrap' }}>
                  Выполняем...
                </Typography>
              ) : null}
            </Stack>
            <IconButton
              size="small"
              aria-label="Снять выбор"
              onClick={onClear}
              disabled={loading}
              sx={{
                width: 32,
                height: 32,
                borderRadius: tokens.iconButtonRadius,
                color: tokens.textPrimary,
                bgcolor: tokens.actionBg,
                border: '1px solid',
                borderColor: tokens.actionBorder,
              }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Box>

        <Box
          data-testid="mail-mobile-bulk-bottom-bar"
          sx={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: theme.zIndex.appBar + 2,
            minHeight: `calc(${tokens.bulkBarHeight}px + env(safe-area-inset-bottom, 0px))`,
            px: 1,
            pt: 0.55,
            pb: 'calc(0.55rem + env(safe-area-inset-bottom, 0px))',
            bgcolor: tokens.bulkBottomBarBg,
            borderTop: '1px solid',
            borderColor: tokens.panelBorder,
            boxShadow: tokens.isDark
              ? '0 -18px 36px rgba(0, 0, 0, 0.32)'
              : '0 -18px 36px rgba(15, 23, 42, 0.12)',
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-around" spacing={0.35}>
            <MobileBulkActionButton
              icon={<DoneAllRoundedIcon />}
              label="Прочитано"
              disabled={loading}
              onClick={onMarkRead}
              tokens={tokens}
            />
            <MobileBulkActionButton
              icon={<MarkEmailUnreadRoundedIcon />}
              label="Не проч."
              disabled={loading}
              onClick={onMarkUnread}
              tokens={tokens}
            />
            <MobileBulkActionButton
              icon={<ArchiveRoundedIcon />}
              label="Архив"
              disabled={loading}
              onClick={onArchive}
              tokens={tokens}
            />
            <MobileBulkActionButton
              icon={<DeleteOutlineRoundedIcon />}
              label="Удалить"
              danger
              disabled={loading}
              onClick={onDelete}
              tokens={tokens}
            />
            <MobileBulkActionButton
              icon={<MoreHorizRoundedIcon />}
              label="Еще"
              disabled={loading}
              onClick={() => setMoreOpen(true)}
              tokens={tokens}
            />
          </Stack>
        </Box>

        <Drawer
          anchor="bottom"
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          PaperProps={{
            sx: {
              borderTopLeftRadius: tokens.sheetRadius,
              borderTopRightRadius: tokens.sheetRadius,
              bgcolor: tokens.panelSolid,
              color: tokens.textPrimary,
              backgroundImage: 'none',
              borderTop: '1px solid',
              borderColor: tokens.panelBorder,
              maxHeight: '72dvh',
              pb: 'env(safe-area-inset-bottom, 0px)',
              overflow: 'hidden',
            },
          }}
        >
          <Box sx={{ px: 1.4, pt: 1, pb: 1.2 }}>
            <Box
              aria-hidden
              sx={{
                width: 42,
                height: 4,
                borderRadius: tokens.radius.round,
                bgcolor: tokens.sheetHandleColor,
                mx: 'auto',
                mb: 1.2,
              }}
            />
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.8 }}>
              <Typography sx={{ fontWeight: 850, fontSize: '1rem' }}>
                Действия
              </Typography>
              <Button
                size="small"
                onClick={() => {
                  setMoreOpen(false);
                  onClear?.();
                }}
                disabled={loading}
                sx={{ textTransform: 'none', fontWeight: 750 }}
              >
                Снять выбор
              </Button>
            </Stack>

            <Typography sx={{ mb: 0.7, color: tokens.textSecondary, fontSize: tokens.fontSizeFine, fontWeight: 750 }}>
              Переместить в папку
            </Typography>
            <List
              dense
              disablePadding
              data-testid="mail-mobile-bulk-move-list"
              sx={{
                maxHeight: 260,
                overflowY: 'auto',
                border: '1px solid',
                borderColor: tokens.panelBorder,
                borderRadius: tokens.radiusLg,
                bgcolor: tokens.panelBg,
              }}
            >
              {normalizedMoveTargets.length > 0 ? normalizedMoveTargets.map((option) => {
                const active = String(option.value) === String(moveTarget || '');
                return (
                  <ListItemButton
                    key={option.value}
                    selected={active}
                    onClick={() => onMoveTargetChange(String(option.value || ''))}
                    sx={{
                      minHeight: 42,
                      '&.Mui-selected': {
                        bgcolor: tokens.selectedBg,
                      },
                    }}
                  >
                    <ListItemText
                      primary={option.label}
                      primaryTypographyProps={{
                        fontWeight: active ? 850 : 650,
                        fontSize: '0.92rem',
                        noWrap: true,
                      }}
                    />
                  </ListItemButton>
                );
              }) : (
                <Box sx={{ px: 1.3, py: 1.4, color: tokens.textSecondary, fontSize: tokens.fontSizeLabel }}>
                  Нет доступных папок
                </Box>
              )}
            </List>

            <Button
              fullWidth
              variant="contained"
              startIcon={<DriveFileMoveRoundedIcon />}
              onClick={() => {
                setMoreOpen(false);
                onMove?.();
              }}
              disabled={loading || !moveTarget}
              sx={{
                mt: 1.2,
                minHeight: 42,
                borderRadius: tokens.controlRadius,
                textTransform: 'none',
                fontWeight: 850,
              }}
            >
              Переместить
            </Button>
          </Box>
        </Drawer>
      </>
    );
  }

  return (
    <Box
      sx={{
        px: 1.2,
        py: 1,
        borderBottom: '1px solid',
        borderColor: tokens.panelBorder,
        bgcolor: tokens.surfaceBg,
      }}
    >
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={0.9}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', lg: 'center' }}
      >
        <Stack direction="row" spacing={0.7} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {`Выбрано: ${count}`}
          </Typography>
          <Button size="small" onClick={onMarkRead} disabled={loading} sx={neutralActionSx}>Прочитано</Button>
          <Button size="small" onClick={onMarkUnread} disabled={loading} sx={neutralActionSx}>Непрочитано</Button>
          <Button size="small" onClick={onArchive} disabled={loading} sx={neutralActionSx}>Архив</Button>
          <Button size="small" color="error" onClick={onDelete} disabled={loading} sx={dangerActionSx}>Удалить</Button>
          <Button size="small" onClick={onClear} disabled={loading} sx={neutralActionSx}>Снять выбор</Button>
        </Stack>
        <Stack direction="row" spacing={0.7} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <Select
              value={moveTarget}
              displayEmpty
              onChange={(event) => onMoveTargetChange(String(event.target.value || ''))}
            >
              <MenuItem value="">Куда переместить</MenuItem>
              {moveTargets.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button size="small" variant="outlined" onClick={onMove} disabled={loading || !moveTarget} sx={neutralActionSx}>
            Переместить
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
