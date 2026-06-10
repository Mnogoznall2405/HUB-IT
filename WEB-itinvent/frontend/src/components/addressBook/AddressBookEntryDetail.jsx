import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import PhoneIcon from '@mui/icons-material/Phone';
import { alpha, useTheme } from '@mui/material/styles';
import { TelegramBrandIcon } from '../icons/MessengerBrandIcon';
import { isValidEmailRecipient } from '../mail/mailComposeState';
import { isPhoneDeepLinkReady } from '../../lib/messengerLinks';
import { EmailActions, PhoneActions } from './AddressBookContactActions';
import HighlightText from './HighlightText';
import { pickPrimaryEmail, pickPrimaryPhone } from './addressBookUtils';

export default function AddressBookEntryDetail({
  item,
  query = '',
  enableTelLinks = false,
  compact = false,
  onCopy,
  onOpenTelegram,
  onOpenMax,
  onComposeEmail,
  onOpenChat,
  showChatAction = false,
  chatBusy = false,
}) {
  const theme = useTheme();

  if (!item) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: compact ? 120 : 280,
          border: `1px dashed ${theme.palette.divider}`,
          bgcolor: alpha(theme.palette.background.paper, 0.5),
          p: 3,
        }}
        data-testid="address-book-entry-detail-empty"
      >
        <Typography variant="body2" color="text.secondary" textAlign="center">
          Выберите сотрудника из списка, чтобы увидеть контакты.
        </Typography>
      </Box>
    );
  }

  const primaryPhone = pickPrimaryPhone(item);
  const primaryEmail = pickPrimaryEmail(item);
  const canCall = enableTelLinks && Boolean(primaryPhone?.telHref);
  const canTelegram = primaryPhone?.digits && isPhoneDeepLinkReady(primaryPhone.digits);
  const canMail = primaryEmail?.value && isValidEmailRecipient(primaryEmail.value);

  return (
    <Box
      data-testid="address-book-entry-detail"
      sx={{
        border: `1px solid ${theme.palette.divider}`,
        bgcolor: alpha(theme.palette.background.paper, 0.82),
        p: compact ? 2 : 2.5,
        minHeight: compact ? 'auto' : 280,
      }}
    >
      <Stack spacing={2}>
        <Box>
          <Typography variant={compact ? 'subtitle1' : 'h6'} fontWeight={800} sx={{ lineHeight: 1.25 }}>
            <HighlightText value={item.full_name} query={query} />
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {item.position ? <HighlightText value={item.position} query={query} /> : 'Должность не указана'}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {canCall ? (
            <Button
              component="a"
              href={primaryPhone.telHref}
              variant="contained"
              size="small"
              startIcon={<PhoneIcon />}
              aria-label={`Позвонить ${primaryPhone.value}`}
            >
              Позвонить
            </Button>
          ) : null}
          {primaryPhone ? (
            <Button
              variant="outlined"
              size="small"
              startIcon={<TelegramBrandIcon size={18} />}
              disabled={!canTelegram}
              onClick={() => onOpenTelegram(primaryPhone.digits)}
              aria-label={`Открыть Telegram ${primaryPhone.value}`}
            >
              Telegram
            </Button>
          ) : null}
          {primaryEmail ? (
            <Button
              variant="outlined"
              size="small"
              startIcon={<MailOutlineIcon />}
              disabled={!canMail}
              onClick={() => onComposeEmail(primaryEmail.value)}
              aria-label={`Написать в HUB ${primaryEmail.value}`}
            >
              Написать в HUB
            </Button>
          ) : null}
          {showChatAction ? (
            <Button
              variant="outlined"
              size="small"
              startIcon={<ForumOutlinedIcon />}
              disabled={chatBusy}
              onClick={() => onOpenChat?.(item)}
              aria-label={`Написать в чат ${item.full_name}`}
              data-testid="address-book-chat-detail"
            >
              Написать в чат
            </Button>
          ) : null}
        </Stack>

        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
          {item.department ? <Chip label={<HighlightText value={item.department} query={query} />} size="small" /> : null}
          {item.department_location ? (
            <Chip label={<HighlightText value={item.department_location} query={query} />} size="small" variant="outlined" />
          ) : null}
        </Stack>

        <PhoneActions
          phones={item.work_phones}
          label="Рабочие"
          onCopy={onCopy}
          enableTelLinks={enableTelLinks}
          onOpenTelegram={onOpenTelegram}
          onOpenMax={onOpenMax}
          query={query}
        />
        <PhoneActions
          phones={item.personal_phones}
          label="Личные"
          onCopy={onCopy}
          enableTelLinks={enableTelLinks}
          onOpenTelegram={onOpenTelegram}
          onOpenMax={onOpenMax}
          query={query}
        />
        <EmailActions emails={item.work_emails} label="Рабочая почта" onCopy={onCopy} onComposeEmail={onComposeEmail} query={query} />
        <EmailActions emails={item.personal_emails} label="Личная почта" onCopy={onCopy} onComposeEmail={onComposeEmail} query={query} />
      </Stack>
    </Box>
  );
}
