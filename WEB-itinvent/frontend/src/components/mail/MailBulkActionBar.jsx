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
import MailMobileBottomActionButton from './MailMobileBottomActionButton';
import { buildMailUiTokens, getMailMobileBottomBarSx, getMailSoftActionStyles } from './mailUiTokens';

function MobileBulkActionButton({ icon, label, danger = false, disabled = false, onClick, tokens }) {
  return (
    <MailMobileBottomActionButton
      icon={icon}
      label={label}
      danger={danger}
      disabled={disabled}
      onClick={onClick}
      tokens={tokens}
    />
  );
}

function MailBulkSelectionHeader({
  count,
  loading,
  onClear,
  tokens,
}) {
  return (
    <Box
      data-testid="mail-mobile-bulk-header"
      sx={{
        px: 1.2,
        py: 0.75,
        minHeight: 44,
        borderBottom: '1px solid',
        borderColor: tokens.panelBorder,
        bgcolor: tokens.panelBg,
        flexShrink: 0,
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
  );
}

function MailBulkSelectionFooter({
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
  tokens,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const normalizedMoveTargets = Array.isArray(moveTargets) ? moveTargets : [];

  return (
    <>
      <Box
        data-testid="mail-mobile-bulk-bottom-bar"
        data-layout="inline"
        sx={getMailMobileBottomBarSx(tokens)}
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
  mobilePlacement = 'all',
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const neutralActionSx = getMailSoftActionStyles(theme, tokens);
  const dangerActionSx = getMailSoftActionStyles(theme, tokens, 'error');

  if (isMobile) {
    if (mobilePlacement === 'header') {
      return (
        <MailBulkSelectionHeader
          count={count}
          loading={loading}
          onClear={onClear}
          tokens={tokens}
        />
      );
    }

    if (mobilePlacement === 'footer') {
      return (
        <MailBulkSelectionFooter
          moveTarget={moveTarget}
          moveTargets={moveTargets}
          loading={loading}
          onMoveTargetChange={onMoveTargetChange}
          onMarkRead={onMarkRead}
          onMarkUnread={onMarkUnread}
          onArchive={onArchive}
          onMove={onMove}
          onDelete={onDelete}
          onClear={onClear}
          tokens={tokens}
        />
      );
    }

    return (
      <>
        <MailBulkSelectionHeader
          count={count}
          loading={loading}
          onClear={onClear}
          tokens={tokens}
        />
        <MailBulkSelectionFooter
          moveTarget={moveTarget}
          moveTargets={moveTargets}
          loading={loading}
          onMoveTargetChange={onMoveTargetChange}
          onMarkRead={onMarkRead}
          onMarkUnread={onMarkUnread}
          onArchive={onArchive}
          onMove={onMove}
          onDelete={onDelete}
          onClear={onClear}
          tokens={tokens}
        />
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
