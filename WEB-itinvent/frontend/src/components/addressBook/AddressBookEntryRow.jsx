import { Avatar, Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import PhoneIcon from '@mui/icons-material/Phone';
import { alpha, useTheme } from '@mui/material/styles';
import { TelegramBrandIcon } from '../icons/MessengerBrandIcon';
import { isValidEmailRecipient } from '../mail/mailComposeState';
import { isPhoneDeepLinkReady } from '../../lib/messengerLinks';
import HighlightText from './HighlightText';
import {
  buildEmployeeSubtitle,
  getInitials,
  pickPrimaryEmail,
  pickQuickActionPhone,
} from './addressBookUtils';

export default function AddressBookEntryRow({
  item,
  entryKey,
  selected = false,
  query = '',
  enableTelLinks = false,
  onSelect,
  onOpenTelegram,
  onComposeEmail,
  onOpenChat,
  showChatAction = false,
  chatBusy = false,
}) {
  const theme = useTheme();
  const primaryPhone = pickQuickActionPhone(item);
  const primaryEmail = pickPrimaryEmail(item);
  const subtitle = buildEmployeeSubtitle(item);
  const canCall = enableTelLinks && Boolean(primaryPhone?.telHref);
  const canTelegram = primaryPhone?.digits && isPhoneDeepLinkReady(primaryPhone.digits);
  const canMail = primaryEmail?.value && isValidEmailRecipient(primaryEmail.value);

  const stopAction = (event) => {
    event.stopPropagation();
  };

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.(item);
        }
      }}
      data-testid={`address-book-entry-row-${entryKey}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.25,
        py: 1,
        minHeight: 72,
        cursor: 'pointer',
        borderBottom: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
        bgcolor: selected ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
        '&:last-child': { borderBottom: 'none' },
        '&:hover': {
          bgcolor: selected
            ? alpha(theme.palette.primary.main, 0.12)
            : alpha(theme.palette.action.hover, 0.04),
        },
      }}
    >
      <Avatar
        sx={{
          width: 40,
          height: 40,
          fontSize: '0.875rem',
          fontWeight: 700,
          bgcolor: alpha(theme.palette.primary.main, 0.12),
          color: 'primary.main',
          flexShrink: 0,
        }}
      >
        {getInitials(item?.full_name)}
      </Avatar>

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" fontWeight={700} noWrap>
          <HighlightText value={item.full_name} query={query} />
        </Typography>
        {subtitle ? (
          <Typography variant="caption" color="text.secondary" noWrap display="block">
            <HighlightText value={subtitle} query={query} />
          </Typography>
        ) : null}
        {primaryPhone?.value ? (
          <Typography variant="caption" color="text.disabled" noWrap display="block">
            <HighlightText value={primaryPhone.value} query={query} />
          </Typography>
        ) : null}
      </Box>

      <Stack direction="row" spacing={0.25} alignItems="center" sx={{ flexShrink: 0 }}>
        {primaryPhone && canCall ? (
          <Tooltip title="Позвонить">
            <span onClick={stopAction} onKeyDown={stopAction}>
              <IconButton
                component="a"
                href={primaryPhone.telHref}
                size="medium"
                aria-label={`Позвонить ${primaryPhone.value}`}
                sx={{ p: 1.25 }}
              >
                <PhoneIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
        {primaryPhone ? (
          <Tooltip title={canTelegram ? 'Telegram' : 'Номер не подходит для Telegram'}>
            <span onClick={stopAction} onKeyDown={stopAction}>
              <IconButton
                size="medium"
                aria-label={`Открыть Telegram ${primaryPhone.value}`}
                disabled={!canTelegram}
                onClick={() => onOpenTelegram(primaryPhone.digits)}
                sx={{ p: 1.25 }}
              >
                <TelegramBrandIcon size={20} />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
        {primaryEmail ? (
          <Tooltip title={canMail ? 'Написать в HUB' : 'Некорректный e-mail'}>
            <span onClick={stopAction} onKeyDown={stopAction}>
              <IconButton
                size="medium"
                aria-label={`Написать в HUB ${primaryEmail.value}`}
                disabled={!canMail}
                onClick={() => onComposeEmail(primaryEmail.value)}
                sx={{ p: 1.25 }}
              >
                <MailOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
        {showChatAction ? (
          <Tooltip title="Написать в корпоративный чат">
            <span onClick={stopAction} onKeyDown={stopAction}>
              <IconButton
                size="medium"
                aria-label={`Написать в чат ${item.full_name}`}
                disabled={chatBusy}
                onClick={() => onOpenChat?.(item)}
                sx={{ p: 1.25 }}
                data-testid={`address-book-chat-${entryKey}`}
              >
                <ForumOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
      </Stack>
    </Box>
  );
}
