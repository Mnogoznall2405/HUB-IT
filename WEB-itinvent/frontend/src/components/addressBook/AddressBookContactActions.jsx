import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import PhoneIcon from '@mui/icons-material/Phone';
import { MaxBrandIcon, TelegramBrandIcon } from '../icons/MessengerBrandIcon';
import { isValidEmailRecipient } from '../mail/mailComposeState';
import { isPhoneDeepLinkReady } from '../../lib/messengerLinks';
import HighlightText from './HighlightText';
import { normalizePhoneDigits, normalizeText } from './addressBookUtils';

const contactRowSx = {
  display: 'flex',
  flexDirection: { xs: 'column', md: 'row' },
  alignItems: { md: 'center' },
  gap: { xs: 0.25, md: 1.25 },
  minWidth: 0,
};

const contactLabelSx = {
  color: 'text.secondary',
  fontWeight: 600,
  lineHeight: 1.2,
  width: { md: 132 },
  flexShrink: { md: 0 },
};

const contactValueBoxSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.75,
  minWidth: 0,
  flex: { md: 1 },
};

const contactValueSx = {
  lineHeight: 1.2,
  overflowWrap: 'anywhere',
  minWidth: 0,
  flex: 1,
};

export function PhoneActions({
  phones = [],
  fallbackLabel,
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
            sx={contactRowSx}
          >
            <Typography variant="caption" sx={contactLabelSx}>
              <HighlightText value={kind || fallbackLabel} query={query} />
            </Typography>
            <Box sx={contactValueBoxSx}>
              <Typography variant="body2" sx={contactValueSx}>
                <HighlightText value={value} query={query} />
              </Typography>
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
          </Box>
        );
      })}
    </Stack>
  );
}

export function EmailActions({ emails = [], fallbackLabel, onCopy, onComposeEmail, query = '' }) {
  const items = Array.isArray(emails) ? emails : [];
  if (items.length === 0) return null;

  return (
    <Stack spacing={0.75}>
      {items.map((email, index) => {
        const value = normalizeText(email?.value);
        const kind = normalizeText(email?.kind);
        const canMail = isValidEmailRecipient(value);
        return (
          <Box
            key={`${kind}-${value}-${index}`}
            sx={contactRowSx}
          >
            <Typography variant="caption" sx={contactLabelSx}>
              <HighlightText value={kind || fallbackLabel} query={query} />
            </Typography>
            <Box sx={contactValueBoxSx}>
              <Typography variant="body2" sx={contactValueSx}>
                <HighlightText value={value} query={query} />
              </Typography>
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
          </Box>
        );
      })}
    </Stack>
  );
}
