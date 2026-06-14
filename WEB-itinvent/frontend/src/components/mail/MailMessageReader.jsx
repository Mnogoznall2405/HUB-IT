import { Alert, Box, Button } from '@mui/material';
import MailAttachmentHero from './MailAttachmentHero';

export default function MailMessageReader({
  message,
  renderState,
  ui,
  isMobile = false,
  scrollRoot = true,
  formatFileSize,
  getRenderedContentSx,
  onRevealRemoteImages,
  onOpenAttachment,
  onDownloadAttachment,
} = {}) {
  const {
    renderResult = {},
    visibleAttachments = [],
    attachmentTotalSize = '',
    hasQuotedHistory = false,
    quotedHtml = '',
    usesQuoteFallback = false,
    messageHtml = '',
    showQuotedHistory = false,
    toggleQuotedHistory,
  } = renderState || {};
  const getContentSx = typeof getRenderedContentSx === 'function'
    ? getRenderedContentSx
    : () => ({});

  return (
    <Box
      className={scrollRoot ? 'mail-scroll-hidden mail-safe-bottom' : undefined}
      sx={{
        ...(scrollRoot ? {
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        } : {}),
        p: { xs: 1.35, md: 2 },
        pb: { xs: scrollRoot ? 1.35 : 0.5, md: 2 },
      }}
    >
      {renderResult.hasBlockedExternalImages ? (
        <Alert
          severity="info"
          sx={{ mb: 1.2, borderRadius: ui?.radiusMd }}
          action={(
            <Button
              color="inherit"
              size="small"
              onClick={() => onRevealRemoteImages?.(message?.id)}
            >
              Показать изображения
            </Button>
          )}
        >
          В письме есть внешние изображения. Они скрыты до вашего разрешения.
        </Alert>
      ) : null}
      {visibleAttachments.length > 0 ? (
        <MailAttachmentHero
          attachments={visibleAttachments}
          attachmentTotalSize={attachmentTotalSize}
          formatFileSize={formatFileSize}
          onOpen={(attachment) => onOpenAttachment?.(message, attachment)}
        />
      ) : null}
      {hasQuotedHistory ? (
        <Button
          onClick={toggleQuotedHistory}
          sx={{
            mb: 1.1,
            px: 0.2,
            minWidth: 0,
            textTransform: 'none',
            color: ui?.mutedText,
            fontWeight: 700,
          }}
        >
          {showQuotedHistory ? 'Скрыть историю переписки' : 'Показать историю переписки'}
        </Button>
      ) : null}
      <Box
        className={!quotedHtml && usesQuoteFallback && !showQuotedHistory ? 'mail-quote-collapsed' : ''}
        sx={getContentSx({ ui })}
        dangerouslySetInnerHTML={{ __html: messageHtml || '<p style="color:#999">Нет содержимого</p>' }}
      />
      {quotedHtml && showQuotedHistory ? (
        <Box
          sx={getContentSx({ ui, quoted: true })}
          dangerouslySetInnerHTML={{ __html: quotedHtml }}
        />
      ) : null}
    </Box>
  );
}
