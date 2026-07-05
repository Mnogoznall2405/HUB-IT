import {
  Box,
  Drawer,
  Link,
  List,
  ListItemText,
  Typography,
} from '@mui/material';
import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import {
  buildMailUiTokens,
  getMailBottomSheetPaperSx,
  getMailMetaTextSx,
  getMailMetadataEmailLinkSx,
  getMailSheetHandleSx,
} from './mailUiTokens';
import { buildMailMessageDetailSections, buildMailRecipientSections } from './mailMessageDetails';

function SectionValue({ section, emailLinkSx }) {
  if (Array.isArray(section.items)) {
    return (
      <List disablePadding>
        {section.items.map((item, index) => (
          <Box key={`${section.id}-${index}`} sx={{ py: 0.55 }}>
            {item.email ? (
              <Link href={`mailto:${item.email}`} sx={emailLinkSx}>
                {item.label}
              </Link>
            ) : (
              <Typography sx={{ wordBreak: 'break-word' }}>{item.label}</Typography>
            )}
          </Box>
        ))}
      </List>
    );
  }

  if (section.email) {
    return (
      <Link href={`mailto:${section.email}`} sx={emailLinkSx}>
        {section.value}
      </Link>
    );
  }

  return (
    <Typography sx={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
      {section.value}
    </Typography>
  );
}

export default function MailDetailsBottomSheet({
  open = false,
  onClose,
  message,
  formatFullDate,
  title = 'Детали письма',
  mode = 'all',
  testId = 'mail-details-bottom-sheet',
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const emailLinkSx = getMailMetadataEmailLinkSx(tokens);
  const sections = mode === 'recipients'
    ? buildMailRecipientSections(message)
    : buildMailMessageDetailSections(message, formatFullDate);

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
            px: 2,
            pb: 1,
          }}
        >
          {sections.map((section) => (
            <Box key={section.id} sx={{ py: 0.85, borderBottom: '1px solid', borderColor: tokens.panelBorder }}>
              <Typography sx={getMailMetaTextSx(tokens, { fontWeight: 700, mb: 0.2 })}>
                {section.label}
              </Typography>
              <ListItemText
                primary={<SectionValue section={section} emailLinkSx={emailLinkSx} />}
                primaryTypographyProps={{ component: 'div' }}
              />
            </Box>
          ))}
        </List>
      </Box>
    </Drawer>
  );
}
