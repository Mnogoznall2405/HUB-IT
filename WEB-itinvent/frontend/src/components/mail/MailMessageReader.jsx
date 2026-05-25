import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import MailAttachmentCard from './MailAttachmentCard';

export default function MailMessageReader({
  message,
  renderState,
  ui,
  isMobile = false,
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
      className="mail-scroll-hidden mail-safe-bottom"
      sx={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        p: { xs: 1.35, md: 2 },
        pb: isMobile ? 'calc(86px + env(safe-area-inset-bottom, 0px))' : { xs: 1.35, md: 2 },
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
        <Stack spacing={0.6} sx={{ mb: 1.2 }}>
          <Typography variant="caption" color="text.secondary">{`${visibleAttachments.length} вложений • ${attachmentTotalSize}`}</Typography>
          <Stack spacing={0.85}>
            {visibleAttachments.map((attachment, index) => (
              <MailAttachmentCard
                key={`${attachment?.id || attachment?.name || index}`}
                attachment={attachment}
                formatFileSize={formatFileSize}
                onOpen={() => onOpenAttachment?.(message, attachment)}
                onDownload={(event) => {
                  event?.stopPropagation?.();
                  onDownloadAttachment?.(message, attachment);
                }}
              />
            ))}
          </Stack>
        </Stack>
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
