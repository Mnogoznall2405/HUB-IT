import {
  Box,
  ButtonBase,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import {
  buildMailUiTokens,
  getMailBottomSheetPaperSx,
  getMailMetaTextSx,
  getMailSheetHandleSx,
} from './mailUiTokens';
import { getMailAttachmentVisual } from './mailAttachmentVisuals';
import { buildAttachmentCountLabel, buildAttachmentSummaryLine } from './mailAttachmentLayout';

export default function MailAttachmentsSheet({
  open = false,
  onClose,
  attachments = [],
  formatFileSize,
  onOpen,
  title = 'Все вложения',
  testId = 'mail-attachments-sheet',
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      ModalProps={{ keepMounted: true, sx: { zIndex: theme.zIndex.drawer + 4 } }}
      PaperProps={{
        'data-testid': testId,
        sx: getMailBottomSheetPaperSx(tokens),
      }}
    >
      <Box sx={{ pt: 1 }}>
        <Box sx={getMailSheetHandleSx(tokens, { mb: 1 })} />
        <Typography sx={{ px: 2, pb: 1, fontWeight: 800 }}>{title}</Typography>
        <List
          disablePadding
          sx={{
            maxHeight: 'min(60dvh, 420px)',
            overflowY: 'auto',
            px: 1,
            pb: 1,
          }}
        >
          {attachments.map((attachment, index) => {
            const visual = getMailAttachmentVisual(attachment);
            const IconComponent = visual.Icon;
            const name = String(attachment?.name || 'attachment.bin').trim();
            const size = Number(attachment?.size || 0);
            const sizeLabel = size > 0 && typeof formatFileSize === 'function'
              ? formatFileSize(size)
              : '';
            const secondary = [visual.label, sizeLabel].filter(Boolean).join(' • ');

            return (
              <ListItemButton
                key={`${attachment?.id || attachment?.name || index}`}
                data-testid={`mail-attachments-sheet-item-${index}`}
                onClick={() => {
                  onOpen?.(attachment);
                  onClose?.();
                }}
                sx={{
                  borderRadius: tokens.radiusSm,
                  mb: 0.35,
                }}
              >
                <ListItemIcon sx={{ minWidth: 42, color: visual.color }}>
                  <IconComponent />
                </ListItemIcon>
                <ListItemText
                  primary={name}
                  secondary={secondary || visual.label}
                  primaryTypographyProps={{
                    fontWeight: 600,
                    noWrap: true,
                  }}
                  secondaryTypographyProps={{
                    sx: getMailMetaTextSx(tokens),
                  }}
                />
              </ListItemButton>
            );
          })}
        </List>
      </Box>
    </Drawer>
  );
}

export function MailAttachmentSummaryRow({
  count = 0,
  totalSizeLabel = '',
  onShowAll,
  tokens,
  placement = 'above',
}) {
  const summaryText = placement === 'below'
    ? buildAttachmentSummaryLine(count, totalSizeLabel)
    : [buildAttachmentCountLabel(count), totalSizeLabel].filter(Boolean).join(' • ');

  return (
    <Box
      data-testid="mail-attachment-summary-row"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 0.75,
        mt: placement === 'below' ? 0.15 : 0,
        mb: placement === 'above' ? 0.75 : 0,
        px: 0.1,
      }}
    >
      <Typography
        sx={getMailMetaTextSx(tokens, {
          fontWeight: placement === 'below' ? 500 : 700,
          color: placement === 'below' ? tokens.textSecondary : tokens.textPrimary,
        })}
      >
        {summaryText}
      </Typography>
      {typeof onShowAll === 'function' ? (
        <ButtonBase
          data-testid="mail-attachment-show-all"
          onClick={onShowAll}
          sx={{
            px: 0.75,
            py: 0.25,
            borderRadius: tokens.radiusSm,
            color: 'primary.main',
            fontWeight: 700,
            fontSize: '0.78rem',
            flexShrink: 0,
          }}
        >
          Все
        </ButtonBase>
      ) : null}
    </Box>
  );
}
