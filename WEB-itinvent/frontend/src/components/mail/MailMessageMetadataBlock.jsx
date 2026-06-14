import { useMemo, useState } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useTheme } from '@mui/material/styles';
import MailDetailsBottomSheet from './MailDetailsBottomSheet';
import {
  buildMailUiTokens,
  getMailMetaTextSx,
} from './mailUiTokens';
import {
  buildMailMessageFromLabel,
  buildMailMessageSentLabel,
  buildMailMessageToSummary,
  MAIL_DETAIL_LABELS,
} from './mailMessageDetails';

function MetadataRow({
  label,
  value,
  tokens,
  onClick,
  testId,
}) {
  return (
    <ButtonBase
      data-testid={testId}
      onClick={onClick}
      sx={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 1.2,
        py: 0.55,
        px: 0.15,
        borderRadius: tokens.radiusSm,
        textAlign: 'left',
        justifyContent: 'flex-start',
      }}
    >
      <Typography sx={getMailMetaTextSx(tokens, { width: 52, flexShrink: 0, fontWeight: 700 })}>
        {label}
      </Typography>
      <Typography
        sx={{
          flex: 1,
          minWidth: 0,
          color: tokens.textPrimary,
          fontSize: '0.84rem',
          lineHeight: 1.45,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Typography>
      <ChevronRightRoundedIcon sx={{ color: tokens.textSecondary, fontSize: 18, flexShrink: 0 }} />
    </ButtonBase>
  );
}

export default function MailMessageMetadataBlock({
  message,
  formatFullDate,
  ui,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (!message) return null;

  const openDetails = () => setDetailsOpen(true);

  return (
    <>
      <Box
        data-testid="mail-message-metadata-block"
        sx={{
          mb: 1.2,
          pb: 0.35,
          borderBottom: '1px solid',
          borderColor: ui?.borderSoft || tokens.panelBorder,
        }}
      >
        <MetadataRow
          label={MAIL_DETAIL_LABELS.from}
          value={buildMailMessageFromLabel(message)}
          tokens={tokens}
          onClick={openDetails}
          testId="mail-message-metadata-from"
        />
        <MetadataRow
          label={MAIL_DETAIL_LABELS.sent}
          value={buildMailMessageSentLabel(message, formatFullDate)}
          tokens={tokens}
          onClick={openDetails}
          testId="mail-message-metadata-sent"
        />
        <MetadataRow
          label={MAIL_DETAIL_LABELS.to}
          value={buildMailMessageToSummary(message)}
          tokens={tokens}
          onClick={openDetails}
          testId="mail-message-metadata-to"
        />
      </Box>

      <MailDetailsBottomSheet
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        message={message}
        formatFullDate={formatFullDate}
        title="Детали письма"
        testId="mail-message-metadata-sheet"
      />
    </>
  );
}
