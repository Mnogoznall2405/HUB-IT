import { Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import MailAttachmentCard from './MailAttachmentCard';
import { buildRenderedMailHtml, filterVisibleMailAttachments } from './mailHtmlContent';
import { getMessageBodyHtmlSource } from './useMailMessageRenderState';

const formatConversationDay = (isoStr) => {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

export default function MailConversationReader({
  conversation,
  selectedMessage,
  scrollRef,
  ui,
  isMobile = false,
  quickReplyBody = '',
  quickReplySending = false,
  onQuickReplyBodyChange,
  onSendQuickReply,
  onOpenComposeFromMessage,
  onSelectMessage,
  isOwnMessage,
  getSenderDisplay,
  getAvatarColor,
  getInitials,
  formatTime,
  formatFileSize,
  revealedRemoteImagesByMessageId,
  mailRenderColorScheme,
  getRenderedContentSx,
  onRevealRemoteImages,
  onOpenAttachment,
  onDownloadAttachment,
} = {}) {
  const theme = useTheme();
  const getContentSx = typeof getRenderedContentSx === 'function'
    ? getRenderedContentSx
    : () => ({});
  const items = Array.isArray(conversation?.items) ? conversation.items : [];

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          px: 1.2,
          py: 1,
          pb: { xs: 1, sm: 1.4 },
          bgcolor: ui?.panelBg,
        }}
      >
        <Stack spacing={1}>
          {items.map((item, index, arr) => {
            const itemDateValue = item?.received_at || item?.created_at || Date.now();
            const currentDay = formatConversationDay(itemDateValue);
            const previous = arr[index - 1];
            const previousDay = previous ? formatConversationDay(previous?.received_at || previous?.created_at || Date.now()) : '';
            const showDaySeparator = currentDay !== previousDay;
            const mine = typeof isOwnMessage === 'function' ? isOwnMessage(item) : false;
            const senderLine = typeof getSenderDisplay === 'function'
              ? getSenderDisplay(item, item?.sender || '-')
              : (item?.sender || '-');
            const itemAllowsExternalImages = Boolean(
              item?.id && revealedRemoteImagesByMessageId?.[String(item.id)]
            );
            const itemAttachments = Array.isArray(item?.attachments) ? item.attachments : [];
            const conversationBodyHtmlSource = getMessageBodyHtmlSource(item);
            const renderedConversationBody = buildRenderedMailHtml(
              conversationBodyHtmlSource,
              itemAttachments,
              { allowExternalImages: itemAllowsExternalImages, colorScheme: mailRenderColorScheme }
            );
            const visibleConversationAttachments = filterVisibleMailAttachments(
              itemAttachments,
              renderedConversationBody.usedInlineAttachmentIds
            );

            return (
              <Box key={item?.id || index}>
                {showDaySeparator ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.2 }}>
                    <Chip
                      size="small"
                      label={currentDay}
                      sx={{
                        height: 22,
                        fontSize: ui?.fontSizeFine,
                        borderRadius: ui?.chipRadius,
                        bgcolor: ui?.actionBg,
                        color: ui?.mutedText,
                        border: '1px solid',
                        borderColor: ui?.borderSoft,
                        fontWeight: 600,
                      }}
                    />
                  </Box>
                ) : null}
                <Stack direction="row" justifyContent={mine ? 'flex-end' : 'flex-start'} alignItems="flex-end" spacing={0.7}>
                  {!mine ? (
                    <Box
                      sx={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        bgcolor: typeof getAvatarColor === 'function' ? getAvatarColor(senderLine) : 'primary.main',
                        color: 'common.white',
                        fontSize: ui?.fontSizeFine,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {typeof getInitials === 'function' ? getInitials(senderLine) : '?'}
                    </Box>
                  ) : null}
                  <Paper
                    variant="outlined"
                    sx={{
                      px: 1.1,
                      py: 0.9,
                      maxWidth: { xs: '92%', md: '78%' },
                      borderRadius: mine ? `${ui?.radiusLg} ${ui?.radiusLg} ${ui?.radiusXs} ${ui?.radiusLg}` : `${ui?.radiusLg} ${ui?.radiusLg} ${ui?.radiusLg} ${ui?.radiusXs}`,
                      borderColor: mine
                        ? alpha(theme.palette.primary.main, ui?.isDark ? 0.46 : 0.28)
                        : (String(selectedMessage?.id) === String(item?.id) ? ui?.selectedBorder : ui?.borderSoft),
                      bgcolor: mine
                        ? alpha(theme.palette.primary.main, ui?.isDark ? 0.22 : 0.10)
                        : ui?.panelSolid,
                      color: mine
                        ? (ui?.isDark ? alpha(theme.palette.common.white, 0.96) : theme.palette.text.primary)
                        : 'text.primary',
                      cursor: 'pointer',
                      boxShadow: 'none',
                    }}
                    onClick={() => onSelectMessage?.(item)}
                  >
                    <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                      <Typography variant="caption" sx={{ fontWeight: 700, color: mine ? 'inherit' : 'text.secondary' }}>
                        {mine ? 'Вы' : senderLine}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: mine ? 0.85 : 0.7 }}>
                        {typeof formatTime === 'function' ? formatTime(itemDateValue) : ''}
                      </Typography>
                    </Stack>
                    {renderedConversationBody.hasBlockedExternalImages ? (
                      <Box sx={{ mt: 0.55 }}>
                        <Button
                          size="small"
                          variant="text"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRevealRemoteImages?.(item?.id);
                          }}
                          sx={{
                            minWidth: 0,
                            px: 0,
                            textTransform: 'none',
                            color: mine ? 'inherit' : 'primary.main',
                          }}
                        >
                          Показать изображения
                        </Button>
                      </Box>
                    ) : null}
                    <Box
                      sx={getContentSx({ ui, variant: 'conversation', mine })}
                      dangerouslySetInnerHTML={{ __html: renderedConversationBody.html || '<p style="color:#999">Нет содержимого</p>' }}
                    />
                    {visibleConversationAttachments.length > 0 ? (
                      <Stack spacing={0.8} sx={{ mt: 0.9 }}>
                        {visibleConversationAttachments.map((attachment, attachmentIndex) => (
                          <MailAttachmentCard
                            key={`${attachment?.id || attachment?.name || attachmentIndex}`}
                            attachment={attachment}
                            mine={mine}
                            formatFileSize={formatFileSize}
                            onOpen={(event) => {
                              event?.stopPropagation?.();
                              onOpenAttachment?.(item, attachment);
                            }}
                            onDownload={(event) => {
                              event?.stopPropagation?.();
                              onDownloadAttachment?.(item, attachment);
                            }}
                          />
                        ))}
                      </Stack>
                    ) : null}
                  </Paper>
                  {mine ? (
                    <Box
                      sx={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        fontSize: ui?.fontSizeFine,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      Я
                    </Box>
                  ) : null}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Box>
      {!isMobile ? (
        <Box
          sx={{
            p: 1,
            pb: 'calc(8px + env(safe-area-inset-bottom, 0px))',
            borderTop: '1px solid',
            borderColor: ui?.borderSoft,
            bgcolor: ui?.panelSolid,
            position: 'sticky',
            bottom: 0,
            zIndex: 1,
          }}
        >
          <Stack spacing={0.7}>
            <TextField
              multiline
              minRows={2}
              maxRows={6}
              size="small"
              label="Быстрый ответ"
              placeholder="Напишите сообщение..."
              value={quickReplyBody}
              onChange={(event) => onQuickReplyBodyChange?.(event.target.value)}
              inputProps={{ 'data-testid': 'mail-quick-reply-body' }}
              InputProps={{ sx: { borderRadius: ui?.inputRadius } }}
            />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'stretch', sm: 'center' }}
              flexWrap="wrap"
              useFlexGap
              gap={0.6}
            >
              <Stack direction="row" spacing={0.4} flexWrap="wrap" useFlexGap>
                <Button size="small" variant="text" onClick={() => onOpenComposeFromMessage?.('reply')} sx={{ textTransform: 'none', minWidth: 0, px: 0.7 }}>
                  Ответить
                </Button>
                <Button size="small" variant="text" onClick={() => onOpenComposeFromMessage?.('reply_all')} sx={{ textTransform: 'none', minWidth: 0, px: 0.7 }}>
                  Всем
                </Button>
                <Button size="small" variant="text" onClick={() => onOpenComposeFromMessage?.('forward')} sx={{ textTransform: 'none', minWidth: 0, px: 0.7 }}>
                  Переслать
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ maxWidth: { xs: '100%', sm: 280 } }}>
                Ответ отправляется отправителю выбранного сообщения.
              </Typography>
              <Button
                data-testid="mail-quick-reply-send"
                size="small"
                variant="contained"
                disabled={quickReplySending || !String(quickReplyBody || '').trim()}
                sx={{ alignSelf: { xs: 'stretch', sm: 'center' } }}
                onClick={() => onSendQuickReply?.()}
              >
                {quickReplySending ? 'Отправка...' : 'Отправить'}
              </Button>
            </Stack>
          </Stack>
        </Box>
      ) : null}
    </Box>
  );
}
