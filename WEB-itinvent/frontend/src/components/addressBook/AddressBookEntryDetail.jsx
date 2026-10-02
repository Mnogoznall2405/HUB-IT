import { Avatar, Box, Button, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import ContactPageOutlinedIcon from '@mui/icons-material/ContactPageOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import ForwardToInboxOutlinedIcon from '@mui/icons-material/ForwardToInboxOutlined';
import PhoneIcon from '@mui/icons-material/Phone';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import { alpha, useTheme } from '@mui/material/styles';
import { TelegramBrandIcon } from '../icons/MessengerBrandIcon';
import { isValidEmailRecipient } from '../mail/mailComposeState';
import { isPhoneDeepLinkReady } from '../../lib/messengerLinks';
import { EmailActions, PhoneActions } from './AddressBookContactActions';
import HighlightText from './HighlightText';
import {
  absenceChipColor,
  formatAbsenceLabel,
  formatAge,
  formatDate,
  getInitials,
  pickPrimaryEmail,
  pickPrimaryPhone,
} from './addressBookUtils';

const listAny = (value) => Array.isArray(value) && value.length > 0;

const metaRowSx = {
  display: 'flex',
  flexDirection: { xs: 'column', md: 'row' },
  alignItems: { md: 'center' },
  gap: { xs: 0.25, md: 1.25 },
  minWidth: 0,
};

const metaLabelSx = {
  color: 'text.secondary',
  fontWeight: 600,
  lineHeight: 1.2,
  width: { md: 132 },
  flexShrink: { md: 0 },
};

// Quick actions: 44px on touch, 36px on desktop per design system targets.
const actionButtonSx = { height: { xs: 44, sm: 36 }, minHeight: { xs: 44, sm: 36 } };

function MetaField({ label, testId, children }) {
  return (
    <Box sx={metaRowSx} data-testid={testId}>
      <Typography variant="caption" sx={metaLabelSx}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0, flex: { md: 1 } }}>{children}</Box>
    </Box>
  );
}

export default function AddressBookEntryDetail({
  item,
  titleId,
  query = '',
  enableTelLinks = false,
  compact = false,
  dismissed = false,
  onCopy,
  onOpenTelegram,
  onOpenMax,
  onComposeEmail,
  canComposeEmail = false,
  onOpenChat,
  showChatAction = false,
  chatBusy = false,
  isFavorite = false,
  onToggleFavorite,
  onSaveContact,
  // R5: bottom-sheet variant keeps primary actions (call/chat) exclusively in
  // the sticky footer; the header block shows secondary actions only.
  primaryActionsInFooter = false,
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
  const absenceLabel = formatAbsenceLabel(item?.absence);
  const ageLabel = formatAge(item?.age);
  const hireDateLabel = formatDate(item?.hire_date);
  const dismissalDateLabel = formatDate(item?.dismissal_date);
  const dismissedLabel = dismissed
    ? `Уволен${dismissalDateLabel ? ` ${dismissalDateLabel}` : ''}`
    : '';
  const canCall = enableTelLinks && Boolean(primaryPhone?.telHref);
  const canTelegram = primaryPhone?.digits && isPhoneDeepLinkReady(primaryPhone.digits);
  const canMail = primaryEmail?.value && isValidEmailRecipient(primaryEmail.value);
  const workplaceLabel = [
    item.office_address,
    item.office_room && item.office_room !== '0' ? `каб. ${item.office_room}` : '',
    item.workplace_number && item.workplace_number !== '0' ? `рм ${item.workplace_number}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const hasWorkMeta = Boolean(
    item.department
      || item.department_code
      || item.department_location
      || item.employee_code
      || workplaceLabel
      || hireDateLabel
      || dismissalDateLabel
  );
  const hasPersonalMeta = Boolean(item.middle_name || ageLabel || item.inn);
  const hasContacts = listAny(item.work_phones)
    || listAny(item.personal_phones)
    || listAny(item.work_emails)
    || listAny(item.personal_emails);

  return (
    <Box
      data-testid="address-book-entry-detail"
      sx={{
        border: compact ? 'none' : `1px solid ${theme.palette.divider}`,
        bgcolor: compact ? 'transparent' : alpha(theme.palette.background.paper, 0.82),
        p: compact ? 2 : 2.5,
        minHeight: compact ? 'auto' : 280,
      }}
    >
      <Stack spacing={3}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar
              sx={{
                width: compact ? 40 : 48,
                height: compact ? 40 : 48,
                fontSize: compact ? '0.8rem' : '0.95rem',
                fontWeight: 700,
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                color: 'primary.main',
                flexShrink: 0,
              }}
            >
              {getInitials(item.full_name)}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                id={titleId}
                variant={compact ? 'subtitle1' : 'h6'}
                fontWeight={800}
                sx={{ lineHeight: 1.25, overflowWrap: 'anywhere' }}
              >
                <HighlightText value={item.full_name} query={query} />
              </Typography>
              <Typography variant="body2" color="text.secondary" data-testid="address-book-person-meta">
                {item.position ? <HighlightText value={item.position} query={query} /> : 'Должность не указана'}
                {ageLabel ? ` · ${ageLabel}` : null}
              </Typography>
              {absenceLabel ? (
                <Chip
                  size="small"
                  color={absenceChipColor(item.absence)}
                  label={absenceLabel}
                  sx={{ mt: 0.5, fontWeight: 700 }}
                  data-testid="address-book-absence-chip"
                />
              ) : null}
              {dismissedLabel ? (
                <Chip
                  size="small"
                  label={dismissedLabel}
                  sx={{ mt: 0.5, fontWeight: 700 }}
                  data-testid="address-book-dismissed-chip"
                />
              ) : null}
            </Box>
            {onToggleFavorite && item.employee_code ? (
              <Tooltip title={isFavorite ? 'Убрать из избранного' : 'В избранное'}>
                <IconButton
                  aria-label={isFavorite ? `Убрать из избранного ${item.full_name}` : `В избранное ${item.full_name}`}
                  aria-pressed={isFavorite}
                  onClick={() => onToggleFavorite(item)}
                  sx={{
                    width: { xs: 44, sm: 36 },
                    height: { xs: 44, sm: 36 },
                    color: isFavorite ? 'warning.main' : (theme.customAdmin?.iconMuted || 'text.secondary'),
                    flexShrink: 0,
                    alignSelf: 'flex-start',
                  }}
                  data-testid="address-book-favorite-toggle"
                >
                  {isFavorite ? <StarIcon /> : <StarBorderIcon />}
                </IconButton>
              </Tooltip>
            ) : null}
          </Stack>

          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            flexWrap="wrap"
            data-testid="address-book-detail-actions"
          >
            {canCall && !primaryActionsInFooter ? (
              <Tooltip title={primaryPhone.value}>
                <Button
                  component="a"
                  href={primaryPhone.telHref}
                  variant="contained"
                  size="small"
                  startIcon={<PhoneIcon />}
                  aria-label={`Позвонить ${primaryPhone.value}`}
                  // tel: links only make sense on a handset; desktop gets copy.
                  sx={{ ...actionButtonSx, display: { xs: 'inline-flex', sm: 'none' } }}
                >
                  Позвонить
                </Button>
              </Tooltip>
            ) : null}
            {primaryPhone?.value ? (
              <Button
                variant="contained"
                size="small"
                startIcon={<ContentCopyIcon />}
                onClick={() => onCopy?.(primaryPhone.value)}
                aria-label={`Скопировать номер ${primaryPhone.value}`}
                sx={{ ...actionButtonSx, display: { xs: 'none', sm: 'inline-flex' } }}
                data-testid="address-book-copy-number"
              >
                Скопировать номер
              </Button>
            ) : null}
            {primaryPhone ? (
              <Tooltip title={canTelegram ? `Telegram: ${primaryPhone.value}` : 'Номер не подходит для Telegram'}>
                <span>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<TelegramBrandIcon size={18} />}
                    disabled={!canTelegram}
                    onClick={() => onOpenTelegram(primaryPhone.digits)}
                    aria-label={`Открыть Telegram ${primaryPhone.value}`}
                    sx={actionButtonSx}
                  >
                    Telegram
                  </Button>
                </span>
              </Tooltip>
            ) : null}
            {primaryEmail && !dismissed && canComposeEmail ? (
              <Tooltip title={canMail ? primaryEmail.value : 'Некорректный e-mail'}>
                <span>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<ForwardToInboxOutlinedIcon />}
                    disabled={!canMail}
                    onClick={() => onComposeEmail(primaryEmail.value)}
                    aria-label={`Новое письмо в HUB ${primaryEmail.value}`}
                    sx={actionButtonSx}
                  >
                    Новое письмо в HUB
                  </Button>
                </span>
              </Tooltip>
            ) : null}
            {showChatAction && !primaryActionsInFooter ? (
              <Button
                variant="outlined"
                size="small"
                startIcon={<ForumOutlinedIcon />}
                disabled={chatBusy}
                onClick={() => onOpenChat?.(item)}
                aria-label={`Написать в чат ${item.full_name}`}
                data-testid="address-book-chat-detail"
                sx={actionButtonSx}
              >
                Написать в чат
              </Button>
            ) : null}
            {!dismissed && onSaveContact ? (
              <Tooltip title="Скачать vCard (.vcf) для телефонной книги">
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<ContactPageOutlinedIcon />}
                  onClick={() => onSaveContact(item)}
                  aria-label={`Скачать контакт ${item.full_name}`}
                  data-testid="address-book-save-contact"
                  sx={actionButtonSx}
                >
                  Добавить в контакты
                </Button>
              </Tooltip>
            ) : null}
          </Stack>
        </Stack>

        {hasContacts ? (
          <Stack spacing={1.5}>
            <Typography variant="overline" color="text.secondary" fontWeight={800}>
              Контакты
            </Typography>
            <Stack spacing={1.5}>
              <PhoneActions
                phones={item.work_phones}
                fallbackLabel="Рабочий"
                onCopy={onCopy}
                enableTelLinks={enableTelLinks}
                onOpenTelegram={onOpenTelegram}
                onOpenMax={onOpenMax}
                showMaxAction={!dismissed}
                query={query}
              />
              <PhoneActions
                phones={item.personal_phones}
                fallbackLabel="Личный"
                onCopy={onCopy}
                enableTelLinks={enableTelLinks}
                onOpenTelegram={onOpenTelegram}
                onOpenMax={onOpenMax}
                showMaxAction={!dismissed}
                query={query}
              />
              <EmailActions
                emails={item.work_emails}
                fallbackLabel="Рабочий e-mail"
                onCopy={onCopy}
                onComposeEmail={onComposeEmail}
                dismissed={dismissed}
                canComposeEmail={canComposeEmail}
                query={query}
              />
              <EmailActions
                emails={item.personal_emails}
                fallbackLabel="Личный e-mail"
                onCopy={onCopy}
                onComposeEmail={onComposeEmail}
                dismissed={dismissed}
                canComposeEmail={canComposeEmail}
                query={query}
              />
            </Stack>
          </Stack>
        ) : null}

        {hasWorkMeta ? (
          <Stack spacing={1}>
            <Typography variant="overline" color="text.secondary" fontWeight={800}>
              Работа
            </Typography>
            <Stack spacing={0.75}>
              {item.department ? (
                <MetaField label="Подразделение">
                  <Chip label={<HighlightText value={item.department} query={query} />} size="small" />
                </MetaField>
              ) : null}
              {item.department_code ? (
                <MetaField label="Код подразделения" testId="address-book-division">
                  <Typography variant="body2" color="text.secondary">
                    <HighlightText value={item.department_code} query={query} />
                  </Typography>
                </MetaField>
              ) : null}
              {item.department_location ? (
                <MetaField label="Город">
                  <Chip label={<HighlightText value={item.department_location} query={query} />} size="small" variant="outlined" />
                </MetaField>
              ) : null}
              {workplaceLabel ? (
                <MetaField label="Рабочее место" testId="address-book-workplace">
                  <Typography variant="body2" color="text.secondary">
                    {workplaceLabel}
                  </Typography>
                </MetaField>
              ) : null}
              {item.employee_code ? (
                <MetaField label="Табельный номер" testId="address-book-employee-code">
                  <Typography variant="body2" color="text.secondary">
                    <HighlightText value={item.employee_code} query={query} />
                  </Typography>
                </MetaField>
              ) : null}
              {hireDateLabel ? (
                <MetaField label="Дата приёма" testId="address-book-hire-date">
                  <Typography variant="body2" color="text.secondary">
                    {hireDateLabel}
                  </Typography>
                </MetaField>
              ) : null}
              {dismissalDateLabel ? (
                <MetaField label="Дата увольнения" testId="address-book-dismissal-date">
                  <Typography variant="body2" color="text.secondary">
                    {dismissalDateLabel}
                  </Typography>
                </MetaField>
              ) : null}
            </Stack>
          </Stack>
        ) : null}

        {hasPersonalMeta ? (
          <Stack spacing={1}>
            <Typography variant="overline" color="text.secondary" fontWeight={800}>
              Личное
            </Typography>
            <Stack spacing={0.75}>
              {item.middle_name ? (
                <MetaField label="Отчество" testId="address-book-middle-name">
                  <Typography variant="body2" color="text.secondary">
                    <HighlightText value={item.middle_name} query={query} />
                  </Typography>
                </MetaField>
              ) : null}
              {ageLabel ? (
                <MetaField label="Возраст" testId="address-book-age">
                  <Typography variant="body2" color="text.secondary">
                    {ageLabel}
                  </Typography>
                </MetaField>
              ) : null}
              {item.inn ? (
                <MetaField label="ИНН" testId="address-book-inn">
                  <Typography variant="body2" color="text.secondary">
                    <HighlightText value={item.inn} query={query} />
                  </Typography>
                </MetaField>
              ) : null}
            </Stack>
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}
