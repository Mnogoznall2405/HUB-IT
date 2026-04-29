import { Box, ButtonBase, IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import { alpha, useTheme } from '@mui/material/styles';
import { useMemo, useState } from 'react';
import { buildMailUiTokens, getMailMenuPaperSx } from './mailUiTokens';
import { getMailAttachmentVisual } from './mailAttachmentVisuals';

const normalizeText = (value, fallback = '') => {
  const text = String(value || '').trim();
  return text || fallback;
};

export default function MailAttachmentCard({
  attachment,
  onOpen,
  onDownload,
  formatFileSize,
  mine = false,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const visual = useMemo(() => getMailAttachmentVisual(attachment), [attachment]);
  const IconComponent = visual.Icon;
  const name = normalizeText(attachment?.name, 'attachment.bin');
  const size = Number(attachment?.size || 0);
  const sizeLabel = size > 0 && typeof formatFileSize === 'function' ? formatFileSize(size) : '';
  const isDownloadable = attachment?.downloadable !== false;
  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const menuOpen = Boolean(menuAnchorEl);

  const cardBg = mine
    ? alpha(theme.palette.common.white, 0.12)
    : (tokens.isDark ? '#191d24' : '#f5f6f8');
  const cardBorder = mine
    ? alpha(theme.palette.common.white, 0.16)
    : (tokens.isDark ? alpha(theme.palette.common.white, 0.07) : '#e7e9ee');
  const cardHoverBg = mine
    ? alpha(theme.palette.common.white, 0.16)
    : (tokens.isDark ? '#20252d' : '#eef1f5');
  const iconTileBg = mine
    ? alpha(theme.palette.common.white, 0.12)
    : (tokens.isDark ? alpha(theme.palette.common.white, 0.04) : alpha(visual.color, 0.08));

  const handleMenuOpen = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchorEl(null);
  };

  const handleOpenAction = () => {
    handleMenuClose();
    onOpen?.();
  };

  const handleDownloadAction = () => {
    handleMenuClose();
    onDownload?.();
  };

  return (
    <Box sx={{ width: 'min(100%, 320px)' }}>
      <Box
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'stretch',
          borderRadius: tokens.radiusSm,
          bgcolor: cardBg,
          border: '1px solid',
          borderColor: cardBorder,
          overflow: 'hidden',
          transition: theme.transitions.create(['background-color', 'border-color'], {
            duration: theme.transitions.duration.shorter,
          }),
          '&:hover': {
            bgcolor: cardHoverBg,
            borderColor: mine ? alpha(theme.palette.common.white, 0.22) : (tokens.isDark ? alpha(theme.palette.common.white, 0.11) : '#d9dce3'),
          },
        }}
      >
        <ButtonBase
          onClick={onOpen}
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 1.1,
            px: 1.2,
            py: 0.95,
            textAlign: 'left',
            justifyContent: 'flex-start',
          }}
        >
          <Box
            sx={{
              width: 34,
              height: 34,
              flexShrink: 0,
              borderRadius: tokens.radiusXs,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: iconTileBg,
              color: mine ? 'rgba(255,255,255,0.96)' : visual.color,
            }}
          >
            <IconComponent sx={{ fontSize: 20 }} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              sx={{
                fontSize: '0.92rem',
                fontWeight: 500,
                lineHeight: 1.18,
                color: mine ? 'rgba(255,255,255,0.96)' : tokens.textPrimary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </Typography>
            <Typography
              sx={{
                mt: 0.22,
                fontSize: tokens.fontSizeFine,
                lineHeight: 1.2,
                color: mine ? alpha(theme.palette.common.white, 0.74) : tokens.textSecondary,
              }}
            >
              {sizeLabel || visual.label}
            </Typography>
          </Box>
        </ButtonBase>

        <Stack
          sx={{
            pr: 0.35,
            pl: 0.15,
            justifyContent: 'center',
          }}
        >
          <IconButton
            size="small"
            aria-label={`Действия для вложения ${name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen ? 'true' : undefined}
            onClick={handleMenuOpen}
            sx={{
              color: mine ? alpha(theme.palette.common.white, 0.76) : tokens.textSecondary,
              bgcolor: menuOpen
                ? (mine ? alpha(theme.palette.common.white, 0.14) : alpha(theme.palette.common.black, tokens.isDark ? 0.16 : 0.04))
                : 'transparent',
              transition: theme.transitions.create(['background-color', 'transform', 'color'], {
                duration: theme.transitions.duration.shorter,
              }),
              '&:hover': {
                bgcolor: mine ? alpha(theme.palette.common.white, 0.14) : alpha(theme.palette.common.black, tokens.isDark ? 0.18 : 0.05),
              },
            }}
          >
            <KeyboardArrowDownRoundedIcon
              sx={{
                transform: menuOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: theme.transitions.create('transform', {
                  duration: theme.transitions.duration.shortest,
                }),
              }}
            />
          </IconButton>
        </Stack>
      </Box>

      <Menu
        anchorEl={menuAnchorEl}
        open={menuOpen}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: getMailMenuPaperSx(tokens, { minWidth: 180 }),
        }}
      >
        <MenuItem onClick={handleOpenAction}>Открыть</MenuItem>
        {isDownloadable ? <MenuItem onClick={handleDownloadAction}>Скачать</MenuItem> : null}
      </Menu>
    </Box>
  );
}
