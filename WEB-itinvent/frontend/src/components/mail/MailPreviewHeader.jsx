import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Divider,
  IconButton,
  Menu,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import DraftsRoundedIcon from '@mui/icons-material/DraftsRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import ForwardRoundedIcon from '@mui/icons-material/ForwardRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import SubjectRoundedIcon from '@mui/icons-material/SubjectRounded';
import {
  buildMailPreviewActionItems,
  buildMailPreviewReadState,
  filterMailPreviewDesktopOverflowActions,
} from './mailPreviewActions';
import {
  MailCompactMenuItem,
  MailMoveSection,
} from './MailMoveToMenu';
import { filterMailMoveTargets } from './mailMoveTargets';
import {
  buildMailUiTokens,
  getMailIconButtonSx,
  getMailMenuPaperSx,
  getMailMetaTextSx,
} from './mailUiTokens';
import { formatMailPersonWithEmail, getMailPersonEmail } from './mailPeople';
import {
  formatMailRecipientSummary,
  getMailRecipientPeople,
  getMailSenderPerson,
  isMailOutgoingMessage,
  isMailSelfPerson,
} from './mailCorrespondent';
import { formatRuRecipientCount } from './mailPlural';
import { getDefaultMailReplyMode } from './mailReplyIntent';
import MailPersonLink from './MailPersonLink';
import MailReplySplitButton from './MailReplySplitButton';
import MailSummarizeButton from './MailSummarizeButton';
import MailSummarySheet, { useMailSummarySheetState } from './MailSummarySheet';

const buildRecipients = (selectedMessage) => ([
  ...(Array.isArray(selectedMessage?.to_people) ? selectedMessage.to_people : (Array.isArray(selectedMessage?.to) ? selectedMessage.to : []))
    .map((value) => ({ type: 'Кому', value })),
  ...(Array.isArray(selectedMessage?.cc_people) ? selectedMessage.cc_people : (Array.isArray(selectedMessage?.cc) ? selectedMessage.cc : []))
    .map((value) => ({ type: 'Копия', value })),
  ...(Array.isArray(selectedMessage?.bcc_people) ? selectedMessage.bcc_people : (Array.isArray(selectedMessage?.bcc) ? selectedMessage.bcc : []))
    .map((value) => ({ type: 'Скрытая копия', value })),
]).filter((item) => String(formatMailPersonWithEmail(item.value, '') || '').trim());

const buildParticipantsLabel = (participants) => formatMailRecipientSummary(participants, { maxVisible: 3 });

function DesktopActionItem({ icon, label, onClick, danger = false, disabled = false }) {
  return (
    <MailCompactMenuItem
      icon={icon}
      label={label}
      onClick={onClick}
      danger={danger}
      disabled={disabled}
    />
  );
}

export default function MailPreviewHeader({
  selectedMessage,
  selectedConversation,
  viewMode,
  folder,
  messageActionLoading,
  onOpenComposeFromDraft,
  onOpenComposeFromMessage,
  onToggleReadState,
  onRestoreSelectedMessage,
  onDeleteSelectedMessage,
  onArchiveSelectedMessage,
  onMoveTargetChange,
  onMoveSelectedMessage,
  moveTargets,
  onOpenHeaders,
  onDownloadSource,
  onPrintSelectedMessage,
  getAvatarColor: _getAvatarColor,
  getInitials: _getInitials,
  formatFullDate,
  showBackButton,
  onBackToList,
  compactMobile = false,
  summarizeLoading = false,
  summarizeText = '',
  onSummarize,
  onCopySummary,
  aiEnabled = true,
  onRequestAiEnable,
  mailboxEmails,
  onComposeToPerson,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const [recipientsExpanded, setRecipientsExpanded] = useState(false);
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
  const conversationItems = isConversation ? selectedConversation.items : [];
  const conversationParticipants = isConversation
    ? (
      Array.isArray(selectedConversation?.participant_people) && selectedConversation.participant_people.length > 0
        ? selectedConversation.participant_people
        : Array.from(
            new Set(
              conversationItems.flatMap((item) => {
                const parties = [
                  item?.sender_person || { display: item?.sender_display, email: item?.sender_email || item?.sender, name: item?.sender_name },
                  ...(
                    Array.isArray(item?.to_people) && item.to_people.length > 0
                      ? item.to_people
                      : (Array.isArray(item?.to) ? item.to : [])
                  ),
                ];
                return parties.filter(Boolean);
              }),
            ),
          )
    )
    : [];
  const senderPerson = getMailSenderPerson(selectedMessage);
  const toPeople = getMailRecipientPeople(selectedMessage);
  const outgoing = isMailOutgoingMessage(selectedMessage, { folder, mailboxEmails });
  const visibleToPeople = toPeople.slice(0, 2);
  const hiddenRecipientCount = Math.max(0, toPeople.length - 2);
  const recipientsFallback = outgoing ? 'Без получателя' : 'Вы';
  const title = isConversation
    ? String(selectedConversation?.subject || selectedMessage.subject || '(без темы)')
    : String(selectedMessage.subject || '(без темы)');
  const recipients = buildRecipients(selectedMessage);
  const recipientCount = recipients.length;
  const participantsLabel = buildParticipantsLabel(conversationParticipants);
  const canArchive = folder !== 'archive' && folder !== 'trash';
  const availableMoveTargets = filterMailMoveTargets(moveTargets, folder);
  const { readActionIcon, readActionLabel } = buildMailPreviewReadState(
    selectedMessage,
    selectedConversation,
    viewMode,
  );

  const closeActionMenu = () => {
    setMenuAnchorEl(null);
  };

  const handleAction = (callback) => () => {
    closeActionMenu();
    callback?.();
  };

  const handleMoveAction = (value) => {
    closeActionMenu();
    onMoveTargetChange?.(value);
    onMoveSelectedMessage?.(value);
  };

  const defaultReplyMode = getDefaultMailReplyMode({
    message: selectedMessage,
    mailboxEmails,
    conversationParticipants: isConversation ? conversationParticipants : [],
  });
  const primaryActionLabel = 'Открыть черновик';
  const primaryActionIcon = <DraftsRoundedIcon fontSize="small" />;
  const primaryActionHandler = () => onOpenComposeFromDraft?.();

  const actionItems = filterMailPreviewDesktopOverflowActions(buildMailPreviewActionItems({
    folder,
    readActionIcon,
    readActionLabel,
    onOpenComposeFromDraft,
    onOpenComposeFromMessage,
    onToggleReadState,
    onRestoreSelectedMessage,
    onDeleteSelectedMessage,
    onArchiveSelectedMessage,
    canArchive,
  }), folder);

  return (
    <>
    <Box sx={{ borderBottom: '1px solid', borderColor: tokens.panelBorder, flexShrink: 0 }}>
      <Box
        className="mail-glass-header"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 3,
          px: { xs: 1.1, md: 1.5 },
          py: compactMobile ? 0.75 : 0.9,
          minHeight: compactMobile ? 72 : 80,
          bgcolor: tokens.panelSolid || tokens.panelBg,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          {showBackButton ? (
            <IconButton
              aria-label="Назад к списку"
              onClick={onBackToList}
              sx={getMailIconButtonSx(tokens, {
                width: 34,
                height: 34,
                mt: 0.15,
              })}
            >
              <ArrowBackRoundedIcon fontSize="small" />
            </IconButton>
          ) : null}

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              data-testid="mail-preview-title"
              noWrap
              sx={{
                fontWeight: 700,
                fontSize: compactMobile ? '0.95rem' : '1rem',
                lineHeight: 1.25,
                color: tokens.textPrimary,
              }}
            >
              {title}
            </Typography>
            <Typography
              data-testid="mail-preview-sender-label"
              noWrap
              sx={getMailMetaTextSx(tokens, { mt: 0.35, lineHeight: 1.45 })}
            >
              {isConversation
                ? (participantsLabel ? `Участники: ${participantsLabel}` : 'Участники не определены')
                : (
                  <>
                    {'От: '}
                    <MailPersonLink
                      person={senderPerson}
                      mailboxEmails={mailboxEmails}
                      onComposeToPerson={onComposeToPerson}
                      fallback={selectedMessage?.sender || '-'}
                    />
                  </>
                )}
            </Typography>
            {!isConversation ? (
              <Box
                data-testid="mail-preview-recipients-label"
                sx={{
                  ...getMailMetaTextSx(tokens, { mt: 0.2, lineHeight: 1.45 }),
                  display: 'block',
                  width: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <Box
                  component="button"
                  type="button"
                  onClick={() => setRecipientsExpanded((prev) => !prev)}
                  aria-expanded={recipientsExpanded}
                  aria-label={`Показать всех, ${formatRuRecipientCount(recipientCount)}`}
                  sx={{
                    border: 0,
                    p: 0,
                    background: 'none',
                    cursor: 'pointer',
                    font: 'inherit',
                    fontWeight: 700,
                    color: tokens.textPrimary,
                  }}
                >
                  Кому:
                </Box>
                {' '}
                {visibleToPeople.length > 0 ? visibleToPeople.map((person, index) => (
                  <Box component="span" key={`${getMailPersonEmail(person) || index}`}>
                    {index > 0 ? ', ' : null}
                    <MailPersonLink
                      person={person}
                      mailboxEmails={mailboxEmails}
                      onComposeToPerson={onComposeToPerson}
                      fallback=""
                    />
                  </Box>
                )) : recipientsFallback}
                {hiddenRecipientCount > 0 ? (
                  <Box
                    component="button"
                    type="button"
                    data-testid="mail-preview-recipients-more"
                    onClick={() => setRecipientsExpanded((prev) => !prev)}
                    aria-label={`Ещё ${hiddenRecipientCount}`}
                    sx={{
                      border: 0,
                      p: 0,
                      ml: 0.5,
                      background: 'none',
                      cursor: 'pointer',
                      font: 'inherit',
                      fontWeight: 700,
                      color: 'inherit',
                    }}
                  >
                    {`+${hiddenRecipientCount}`}
                  </Box>
                ) : null}
              </Box>
            ) : null}
            <Typography data-testid="mail-preview-date" noWrap sx={getMailMetaTextSx(tokens, { mt: 0.2, lineHeight: 1.45 })}>
              {formatFullDate(selectedMessage.received_at)}
            </Typography>
          </Box>

          {!compactMobile ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flexShrink: 0 }}>
              {folder === 'drafts' ? (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={primaryActionIcon}
                  onClick={primaryActionHandler}
                  disabled={messageActionLoading}
                  aria-label={primaryActionLabel}
                  sx={{
                    minHeight: 32,
                    textTransform: 'none',
                    fontWeight: 700,
                    boxShadow: 'none',
                    borderRadius: tokens.radiusSm,
                  }}
                >
                  {primaryActionLabel}
                </Button>
              ) : (
                <MailReplySplitButton
                  mode={defaultReplyMode}
                  disabled={messageActionLoading}
                  tokens={tokens}
                  onReply={(nextMode) => onOpenComposeFromMessage?.(nextMode)}
                />
              )}
              {folder !== 'drafts' ? (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<ForwardRoundedIcon fontSize="small" />}
                  data-testid="mail-preview-forward"
                  onClick={() => onOpenComposeFromMessage?.('forward')}
                  disabled={messageActionLoading}
                  aria-label="Переслать"
                  sx={{
                    minHeight: 32,
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: tokens.radiusSm,
                  }}
                >
                  Переслать
                </Button>
              ) : null}
              {folder !== 'drafts' && !isConversation ? (
                <MailSummarizeButton
                  tokens={tokens}
                  loading={summarizeLoading}
                  onClick={aiEnabled ? openSummary : () => onRequestAiEnable?.()}
                  testId="mail-preview-summarize"
                />
              ) : null}
              <Tooltip title="Ещё действия">
                <IconButton
                  size="small"
                  aria-label="Еще действия"
                  data-testid="mail-preview-desktop-more"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuAnchorEl(event.currentTarget);
                  }}
                  sx={getMailIconButtonSx(tokens, {
                    width: 32,
                    height: 32,
                  })}
                >
                  <MoreHorizRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          ) : null}
        </Box>

        {!isConversation && recipientsExpanded ? (
          <Box sx={{ pt: 0.75 }}>
            {recipients.length > 0 ? recipients.map((item, index) => {
              const line = formatMailPersonWithEmail(item.value);
              const email = getMailPersonEmail(item.value);
              const clickable = Boolean(onComposeToPerson && email && !isMailSelfPerson(item.value, mailboxEmails));
              return (
                <Typography
                  key={`${item.type}_${email || line}_${index}`}
                  sx={{ color: tokens.textSecondary, fontSize: '0.8125rem', lineHeight: 1.45, wordBreak: 'break-word' }}
                >
                  <Box component="span" sx={{ fontWeight: 700, color: tokens.textPrimary }}>
                    {item.type}
                  </Box>
                  {': '}
                  {clickable ? (
                    <Box
                      component="button"
                      type="button"
                      data-testid="mail-person-link"
                      onClick={() => onComposeToPerson?.(item.value)}
                      sx={{
                        border: 0,
                        p: 0,
                        background: 'none',
                        cursor: 'pointer',
                        font: 'inherit',
                        color: 'primary.main',
                        fontWeight: 650,
                        '&:hover': { textDecoration: 'underline' },
                      }}
                    >
                      {line}
                    </Box>
                  ) : line}
                </Typography>
              );
            }) : (
              <Typography sx={{ color: tokens.textSecondary, fontSize: '0.8125rem' }}>
                Получатели не указаны
              </Typography>
            )}
          </Box>
        ) : null}
      </Box>

      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={closeActionMenu}
        MenuListProps={{
          dense: true,
          'data-testid': 'mail-preview-desktop-more-menu',
        }}
        PaperProps={{
          sx: getMailMenuPaperSx(tokens, {
            mt: 0.5,
            minWidth: 248,
            maxHeight: 'min(72vh, 420px)',
            '& .MuiMenuItem-root': { minHeight: 32 },
          }),
        }}
      >
        {actionItems.map((item) => (
          <DesktopActionItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            danger={item.danger}
            disabled={messageActionLoading}
            onClick={handleAction(item.onClick)}
          />
        ))}
        {availableMoveTargets.length > 0 ? <Divider /> : null}
        <MailMoveSection
          targets={availableMoveTargets}
          disabled={messageActionLoading}
          tokens={tokens}
          currentFolder={folder}
          onSelect={handleMoveAction}
        />
        <Divider />
        <DesktopActionItem
          icon={<SubjectRoundedIcon fontSize="small" />}
          label="Заголовки"
          onClick={handleAction(onOpenHeaders)}
        />
        <DesktopActionItem
          icon={<DownloadRoundedIcon fontSize="small" />}
          label="Скачать .eml"
          onClick={handleAction(onDownloadSource)}
        />
        <DesktopActionItem
          icon={<PrintOutlinedIcon fontSize="small" />}
          label="Печать"
          onClick={handleAction(onPrintSelectedMessage)}
        />
      </Menu>
    </Box>
    <MailSummarySheet
      open={summaryOpen}
      onClose={() => setSummaryOpen(false)}
      tokens={tokens}
      summarizeLoading={summarizeLoading}
      summarizeText={summarizeText}
      summarySheetText={summarySheetText}
      summarySheetError={summarySheetError}
      onCopySummary={onCopySummary}
      testId="mail-preview-summary-sheet"
    />
    </>
  );
}
