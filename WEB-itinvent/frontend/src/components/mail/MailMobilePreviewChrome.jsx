import { useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  ButtonBase,
  IconButton,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import {
  buildMailUiTokens,
  getMailMetaTextSx,
  getMailMobileChromeBackButtonSx,
  getMailMobileDetailsToggleSx,
  getMailMobilePreviewChromeSx,
  getMailMobilePreviewSenderSx,
  getMailMobilePreviewSubjectSx,
} from './mailUiTokens';
import { getMailPersonDisplay } from './mailPeople';
import { formatMailMessageMobileDate } from './mailMessageDetails';
import MailDetailsBottomSheet from './MailDetailsBottomSheet';
import MailSummarizeButton from './MailSummarizeButton';
import MailSummarySheet, { useMailSummarySheetState } from './MailSummarySheet';

export default function MailMobilePreviewChrome({
  selectedMessage,
  selectedConversation,
  viewMode,
  folder = 'inbox',
  onBackToList,
  getAvatarColor,
  getInitials,
  formatFullDate,
  summarizeLoading = false,
  summarizeText = '',
  onSummarize,
  onCopySummary,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const {
    summaryOpen,
    setSummaryOpen,
    summarySheetText,
    summarySheetError,
    openSummary,
  } = useMailSummarySheetState({ onSummarize, summarizeText });

  if (!selectedMessage) return null;

  const isConversation = viewMode === 'conversations'
    && Array.isArray(selectedConversation?.items)
    && selectedConversation.items.length > 0;

  const title = isConversation
    ? String(selectedConversation?.subject || selectedMessage.subject || '(без темы)')
    : String(selectedMessage.subject || '(без темы)');

  const senderLine = getMailPersonDisplay(
    selectedMessage?.sender_person || {
      display: selectedMessage?.sender_display,
      email: selectedMessage?.sender_email || selectedMessage?.sender,
      name: selectedMessage?.sender_name,
    },
    selectedMessage?.sender || '-',
  );

  const mobileDateLabel = formatMailMessageMobileDate(selectedMessage.received_at);

  return (
    <>
      <Box data-testid="mail-mobile-preview-chrome" sx={getMailMobilePreviewChromeSx(tokens)}>
        <Box sx={{ px: 0.85, pt: 0.55, pb: 0.35 }}>
          <IconButton
            aria-label="Назад к списку"
            data-testid="preview-back"
            onClick={onBackToList}
            sx={getMailMobileChromeBackButtonSx(tokens)}
          >
            <ArrowBackRoundedIcon fontSize="small" />
          </IconButton>
        </Box>

        <Box sx={{ px: 1.35, pb: 0.85 }}>
          <Typography data-testid="mail-mobile-preview-subject" sx={getMailMobilePreviewSubjectSx(tokens)}>
            {title}
          </Typography>
        </Box>

        <Box sx={{ px: 1.35, pb: 0.45, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Avatar
            sx={{
              width: 40,
              height: 40,
              bgcolor: getAvatarColor?.(senderLine),
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {getInitials?.(senderLine)}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography data-testid="mail-mobile-preview-sender" sx={getMailMobilePreviewSenderSx(tokens)}>
              {senderLine}
            </Typography>
          </Box>
        </Box>

        {!isConversation ? (
          <Box sx={{ px: 1.35, pb: 0.95, display: 'flex', alignItems: 'center', gap: 0.65 }}>
            <ButtonBase
              data-testid="mail-mobile-preview-details-toggle"
              onClick={() => setDetailsOpen(true)}
              sx={getMailMobileDetailsToggleSx(tokens)}
            >
              <PersonOutlineRoundedIcon sx={{ color: tokens.textSecondary, fontSize: 18, flexShrink: 0 }} />
              <Typography
                data-testid="mail-mobile-preview-date"
                noWrap
                sx={{
                  minWidth: 0,
                  flex: 1,
                  color: tokens.textPrimary,
                  fontSize: '0.82rem',
                  lineHeight: 1.35,
                }}
              >
                {mobileDateLabel}
              </Typography>
              <PersonOutlineRoundedIcon sx={{ color: tokens.textSecondary, fontSize: 18, flexShrink: 0 }} />
              <ExpandMoreRoundedIcon sx={{ color: tokens.textSecondary, flexShrink: 0, fontSize: 20 }} />
            </ButtonBase>

            {folder !== 'drafts' ? (
              <MailSummarizeButton
                tokens={tokens}
                loading={summarizeLoading}
                onClick={openSummary}
                testId="mail-mobile-preview-summarize"
              />
            ) : null}
          </Box>
        ) : null}
      </Box>

      <MailDetailsBottomSheet
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        message={selectedMessage}
        formatFullDate={formatFullDate}
        title="Детали письма"
        testId="mail-mobile-preview-details-sheet"
      />

      <MailSummarySheet
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        tokens={tokens}
        summarizeLoading={summarizeLoading}
        summarizeText={summarizeText}
        summarySheetText={summarySheetText}
        summarySheetError={summarySheetError}
        onCopySummary={onCopySummary}
        testId="mail-mobile-preview-summary-sheet"
      />
    </>
  );
}
