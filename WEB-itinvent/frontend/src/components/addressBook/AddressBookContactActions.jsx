import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import PhoneIcon from '@mui/icons-material/Phone';
import { MaxBrandIcon, TelegramBrandIcon } from '../icons/MessengerBrandIcon';
import { isValidEmailRecipient } from '../mail/mailComposeState';
import { isPhoneDeepLinkReady } from '../../lib/messengerLinks';
import HighlightText from './HighlightText';
import { normalizePhoneDigits, normalizeText } from './addressBookUtils';

export function PhoneActions({
  phones = [],
  label,
  onCopy,
  enableTelLinks = false,
  onOpenTelegram,
  onOpenMax,
  query = '',
}) {
  const items = Array.isArray(phones) ? phones : [];
  if (items.length === 0) return null;

  return (
    <Stack spacing={0.75}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Stack spacing={0.6}>
        {items.map((phone, index) => {
          const value = normalizeText(phone?.value);
          const kind = normalizeText(phone?.kind);
          const normalized = normalizeText(phone?.normalized);
          const phoneDigits = normalized || normalizePhoneDigits(value);
          const telValue = phoneDigits ? `+${phoneDigits}` : value;
          const canCall = enableTelLinks && Boolean(telValue);
          const canOpenMessenger = isPhoneDeepLinkReady(phoneDigits);
          return (
            <Box
              key={`${kind}-${value}-${index}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                minWidth: 0,
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                {kind ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.15 }}>
                    <HighlightText value={kind} query={query} />
                  </Typography>
                ) : null}
                <Typography variant="body2" sx={{ lineHeight: 1.2, overflowWrap: 'anywhere' }}>
                  <HighlightText value={value} query={query} />
                </Typography>
              </Box>
              {canCall ? (
                <Tooltip title="Позвонить">
                  <IconButton
                    component="a"
                    href={`tel:${telValue}`}
                    size="small"
                    aria-label={`Позвонить ${value}`}
                  >
                    <PhoneIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
              <Tooltip title={canOpenMessenger ? 'Открыть в Telegram' : 'Номер не подходит для Telegram'}>
                <span>
                  <IconButton
                    size="small"
                    aria-label={`Открыть Telegram ${value}`}
                    onClick={() => onOpenTelegram(phoneDigits)}
                    disabled={!canOpenMessenger}
                  >
                    <TelegramBrandIcon size={20} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={canOpenMessenger ? 'Скопировать для MAX' : 'Номер не подходит для MAX'}>
                <span>
                  <IconButton
                    size="small"
                    aria-label={`Открыть MAX ${value}`}
                    onClick={(event) => onOpenMax(phoneDigits, event.currentTarget)}
                    disabled={!canOpenMessenger}
                  >
                    <MaxBrandIcon size={20} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Скопировать">
                <IconButton
                  size="small"
                  aria-label={`Скопировать ${value}`}
                  onClick={() => onCopy(value)}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          );
        })}
      </Stack>
    </Stack>
  );
}

export function EmailActions({ emails = [], label, onCopy, onComposeEmail, query = '' }) {
  const items = Array.isArray(emails) ? emails : [];
  if (items.length === 0) return null;

  return (
    <Stack spacing={0.75}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Stack spacing={0.6}>
        {items.map((email, index) => {
          const value = normalizeText(email?.value);
          const kind = normalizeText(email?.kind);
          const canMail = isValidEmailRecipient(value);
          return (
            <Box
              key={`${kind}-${value}-${index}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                minWidth: 0,
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                {kind ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.15 }}>
                    <HighlightText value={kind} query={query} />
                  </Typography>
                ) : null}
                <Typography variant="body2" sx={{ lineHeight: 1.2, overflowWrap: 'anywhere' }}>
                  <HighlightText value={value} query={query} />
                </Typography>
              </Box>
              <Tooltip title={canMail ? 'Написать в HUB' : 'Некорректный e-mail'}>
                <span>
                  <IconButton
                    size="small"
                    aria-label={`Написать в HUB ${value}`}
                    onClick={() => onComposeEmail(value)}
                    disabled={!canMail}
                  >
                    <MailOutlineIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={canMail ? 'Открыть внешнюю почту' : 'Некорректный e-mail'}>
                <span>
                  <IconButton
                    component={canMail ? 'a' : 'button'}
                    href={canMail ? `mailto:${value}` : undefined}
                    size="small"
                    aria-label={`Открыть внешнюю почту ${value}`}
                    disabled={!canMail}
                  >
                    <MailOutlineIcon fontSize="small" color={canMail ? 'action' : 'disabled'} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Скопировать">
                <IconButton
                  size="small"
                  aria-label={`Скопировать ${value}`}
                  onClick={() => onCopy(value)}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          );
        })}
      </Stack>
    </Stack>
  );
}
