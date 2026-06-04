import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import { useNavigate } from 'react-router-dom';
import { addressBookAPI } from '../../api/addressBook';
import { chatDirectoryAPI } from '../../api/chatDirectory';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';
import {
  buildTelegramShareUrl,
  isPhoneDeepLinkReady,
  openTelegramChat,
} from '../../lib/messengerLinks';
import {
  buildMyFilesShareMessage,
  formatAddressBookOptionLabel,
  formatChatDirectoryUserLabel,
  listAddressBookPhones,
  openCorporateChat,
  openMailCompose,
} from '../../lib/myFilesShareDelivery';

const SEND_CHANNELS = [
  { id: 'mail', label: 'Почта' },
  { id: 'chat', label: 'Корпоративный чат' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'max', label: 'MAX' },
];

const SEARCH_DEBOUNCE_MS = 300;

const useDebouncedValue = (value, delayMs = SEARCH_DEBOUNCE_MS) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
};

export default function MyFilesShareDialog({
  open,
  url = '',
  expiresAt = null,
  fileName = '',
  linkCopied = false,
  onClose,
  onRotateShare,
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { notifySuccess, notifyWarning } = useNotification();

  const [copyState, setCopyState] = useState('idle');
  const [sendChannel, setSendChannel] = useState('mail');
  const [telegramQuery, setTelegramQuery] = useState('');
  const [telegramOptions, setTelegramOptions] = useState([]);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [contactPhones, setContactPhones] = useState([]);
  const [selectedPhoneId, setSelectedPhoneId] = useState('');
  const [chatQuery, setChatQuery] = useState('');
  const [chatOptions, setChatOptions] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [selectedChatUser, setSelectedChatUser] = useState(null);

  const debouncedTelegramQuery = useDebouncedValue(telegramQuery);
  const debouncedChatQuery = useDebouncedValue(chatQuery);
  const canSearchAddressBook = hasPermission('address_book.read');
  const canUseMail = hasPermission('mail.access');
  const canUseChat = CHAT_FEATURE_ENABLED && hasPermission('chat.read');
  const selectedPhone = useMemo(
    () => contactPhones.find((phone) => phone.id === selectedPhoneId) || null,
    [contactPhones, selectedPhoneId],
  );
  const shareMessage = useMemo(
    () => buildMyFilesShareMessage({ fileName, url, expiresAt }),
    [expiresAt, fileName, url],
  );

  useEffect(() => {
    if (!open) return;
    setCopyState(linkCopied ? 'copied' : 'idle');
    setSendChannel('mail');
    setTelegramQuery('');
    setSelectedContact(null);
    setContactPhones([]);
    setSelectedPhoneId('');
    setChatQuery('');
    setSelectedChatUser(null);
  }, [linkCopied, open, url]);

  const visibleSendChannels = useMemo(
    () => SEND_CHANNELS.filter((channel) => channel.id !== 'chat' || canUseChat),
    [canUseChat],
  );

  useEffect(() => {
    if (!open || sendChannel !== 'telegram' || !canSearchAddressBook) {
      setTelegramOptions([]);
      return undefined;
    }
    const query = String(debouncedTelegramQuery || '').trim();
    if (query.length < 2) {
      setTelegramOptions([]);
      return undefined;
    }

    let cancelled = false;
    setTelegramLoading(true);
    addressBookAPI.search({ q: query, limit: 12 })
      .then((data) => {
        if (cancelled) return;
        setTelegramOptions(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setTelegramOptions([]);
      })
      .finally(() => {
        if (!cancelled) setTelegramLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canSearchAddressBook, debouncedTelegramQuery, open, sendChannel]);

  useEffect(() => {
    if (!open || sendChannel !== 'chat' || !canUseChat) {
      setChatOptions([]);
      return undefined;
    }
    const query = String(debouncedChatQuery || '').trim();
    if (query.length < 2) {
      setChatOptions([]);
      return undefined;
    }

    let cancelled = false;
    setChatLoading(true);
    chatDirectoryAPI.getUsers({ q: query, limit: 12 })
      .then((data) => {
        if (cancelled) return;
        const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
        setChatOptions(items);
      })
      .catch(() => {
        if (!cancelled) setChatOptions([]);
      })
      .finally(() => {
        if (!cancelled) setChatLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canUseChat, debouncedChatQuery, open, sendChannel]);

  useEffect(() => {
    if (!selectedContact) {
      setContactPhones([]);
      setSelectedPhoneId('');
      return;
    }
    const phones = listAddressBookPhones(selectedContact);
    setContactPhones(phones);
    if (phones.length === 1) {
      setSelectedPhoneId(phones[0].id);
      return;
    }
    setSelectedPhoneId('');
  }, [selectedContact]);

  const handleCopyLink = useCallback(async () => {
    const text = String(url || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard?.writeText(text);
      setCopyState('copied');
      notifySuccess('Ссылка скопирована.', { source: 'my-files-share-copy', dedupeMode: 'none' });
    } catch {
      setCopyState('error');
      notifyWarning('Не удалось скопировать ссылку.', { source: 'my-files-share-copy', dedupeMode: 'none' });
    }
  }, [notifySuccess, notifyWarning, url]);

  const handleOpenMail = useCallback(() => {
    openMailCompose({ navigate, fileName, url, expiresAt });
    onClose?.();
  }, [expiresAt, fileName, navigate, onClose, url]);

  const handleOpenTelegram = useCallback(() => {
    const digits = String(selectedPhone?.digits || '').trim();
    if (!selectedContact) {
      notifyWarning('Выберите сотрудника из адресной книги.', { source: 'my-files-share-telegram', dedupeMode: 'none' });
      return;
    }
    if (!isPhoneDeepLinkReady(digits)) {
      notifyWarning('Выберите номер телефона для Telegram.', { source: 'my-files-share-telegram', dedupeMode: 'none' });
      return;
    }
    if (!openTelegramChat(digits, shareMessage)) {
      const shareUrl = buildTelegramShareUrl({ text: shareMessage });
      if (shareUrl) window.open(shareUrl, '_blank', 'noopener,noreferrer');
      notifyWarning('Не удалось открыть чат Telegram. Попробуйте ещё раз.', { source: 'my-files-share-telegram', dedupeMode: 'none' });
      return;
    }
    notifySuccess('Открываем Telegram с готовым текстом сообщения.', {
      source: 'my-files-share-telegram',
      dedupeMode: 'none',
      durationMs: 3200,
    });
    onClose?.();
  }, [notifySuccess, notifyWarning, onClose, selectedContact, selectedPhone?.digits, shareMessage, url]);

  const handleOpenChat = useCallback(() => {
    const peerUserId = Number(selectedChatUser?.id || 0);
    if (!Number.isFinite(peerUserId) || peerUserId <= 0) {
      notifyWarning('Выберите сотрудника из списка.', { source: 'my-files-share-chat', dedupeMode: 'none' });
      return;
    }
    openCorporateChat({
      navigate,
      peerUserId,
      fileName,
      url,
      expiresAt,
    });
    onClose?.();
  }, [expiresAt, fileName, navigate, notifyWarning, onClose, selectedChatUser?.id, url]);

  const handleChatUserChange = useCallback((_event, value) => {
    setSelectedChatUser(value || null);
    if (value) {
      setChatQuery(formatChatDirectoryUserLabel(value));
    }
  }, []);

  const handleCopyForMax = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(shareMessage);
      notifySuccess('Текст сообщения скопирован.', { source: 'my-files-share-max', dedupeMode: 'none' });
    } catch {
      notifyWarning('Не удалось скопировать текст.', { source: 'my-files-share-max', dedupeMode: 'none' });
    }
  }, [notifySuccess, notifyWarning, shareMessage]);

  const handleContactChange = useCallback((_event, value) => {
    setSelectedContact(value || null);
    if (value) {
      setTelegramQuery(formatAddressBookOptionLabel(value));
    }
  }, []);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>Публичная ссылка</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {copyState === 'copied' ? (
            <Alert severity="success" data-testid="my-files-share-copied-alert">
              Ссылка скопирована в буфер обмена.
            </Alert>
          ) : null}
          {copyState === 'error' ? (
            <Alert severity="warning">Ссылка создана. Скопируйте её вручную.</Alert>
          ) : null}

          <Alert severity="info" sx={{ py: 0.75 }}>
            Одна и та же ссылка подставляется во все каналы отправки ниже.
          </Alert>

          <Alert severity="warning">
            Ссылка доступна без авторизации{expiresAt ? ` до ${new Date(expiresAt).toLocaleString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}` : ''}.
          </Alert>

          <Paper variant="outlined" sx={{ p: 1.25, bgcolor: 'action.hover' }}>
            <Typography variant="body2" sx={{ wordBreak: 'break-all' }} data-testid="my-files-share-url">
              {url}
            </Typography>
          </Paper>

          <FormControl fullWidth size="small">
            <InputLabel id="my-files-share-channel-label">Отправить через</InputLabel>
            <Select
              labelId="my-files-share-channel-label"
              label="Отправить через"
              value={sendChannel}
              onChange={(event) => setSendChannel(event.target.value)}
              data-testid="my-files-share-channel"
            >
              {visibleSendChannels.map((channel) => (
                <MenuItem key={channel.id} value={channel.id}>{channel.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {sendChannel === 'mail' ? (
            <Stack spacing={1.25}>
              <Typography variant="body2" color="text.secondary">
                Откроется редактор письма с готовым текстом и ссылкой на файл.
              </Typography>
              <Button
                variant="contained"
                startIcon={<MailOutlineIcon />}
                onClick={handleOpenMail}
                disabled={!canUseMail}
                fullWidth={isMobile}
                data-testid="my-files-share-open-mail"
              >
                Открыть почту
              </Button>
              {!canUseMail ? (
                <Typography variant="caption" color="text.secondary">
                  Нет доступа к почте. Скопируйте ссылку или выберите другой канал.
                </Typography>
              ) : null}
            </Stack>
          ) : null}

          {sendChannel === 'chat' ? (
            <Stack spacing={1.25}>
              <Typography variant="body2" color="text.secondary">
                Введите фамилию — откроется личный диалог с готовым текстом сообщения.
              </Typography>
              <Autocomplete
                options={chatOptions}
                loading={chatLoading}
                value={selectedChatUser}
                inputValue={chatQuery}
                onInputChange={(_event, value, reason) => {
                  setChatQuery(value);
                  if (reason === 'clear' || !value) {
                    setSelectedChatUser(null);
                  }
                }}
                onChange={handleChatUserChange}
                getOptionLabel={(option) => formatChatDirectoryUserLabel(option)}
                isOptionEqualToValue={(option, value) => (
                  String(option?.id || '') === String(value?.id || '')
                )}
                noOptionsText={chatQuery.trim().length < 2 ? 'Введите минимум 2 символа' : 'Никого не найдено'}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Фамилия"
                    size="small"
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {chatLoading ? <CircularProgress color="inherit" size={18} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                    inputProps={{
                      ...params.inputProps,
                      'data-testid': 'my-files-share-chat-query',
                    }}
                  />
                )}
              />
              <Button
                variant="contained"
                startIcon={<ForumOutlinedIcon />}
                onClick={handleOpenChat}
                disabled={!selectedChatUser}
                fullWidth={isMobile}
                data-testid="my-files-share-open-chat"
              >
                Открыть чат
              </Button>
            </Stack>
          ) : null}

          {sendChannel === 'telegram' ? (
            <Stack spacing={1.25}>
              {!canSearchAddressBook ? (
                <Alert severity="info">
                  Для отправки в Telegram нужен доступ к адресной книге.
                </Alert>
              ) : (
                <>
                  <Typography variant="body2" color="text.secondary">
                    Введите фамилию сотрудника — номер подставится из адресной книги.
                  </Typography>
                  <Autocomplete
                    options={telegramOptions}
                    loading={telegramLoading}
                    value={selectedContact}
                    inputValue={telegramQuery}
                    onInputChange={(_event, value, reason) => {
                      setTelegramQuery(value);
                      if (reason === 'clear' || !value) {
                        setSelectedContact(null);
                      }
                    }}
                    onChange={handleContactChange}
                    getOptionLabel={(option) => formatAddressBookOptionLabel(option)}
                    isOptionEqualToValue={(option, value) => (
                      String(option?.employee_code || option?.id || '') === String(value?.employee_code || value?.id || '')
                    )}
                    noOptionsText={telegramQuery.trim().length < 2 ? 'Введите минимум 2 символа' : 'Никого не найдено'}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Фамилия"
                        size="small"
                        InputProps={{
                          ...params.InputProps,
                          endAdornment: (
                            <>
                              {telegramLoading ? <CircularProgress color="inherit" size={18} /> : null}
                              {params.InputProps.endAdornment}
                            </>
                          ),
                        }}
                        inputProps={{
                          ...params.inputProps,
                          'data-testid': 'my-files-share-telegram-query',
                        }}
                      />
                    )}
                  />
                  {selectedContact && contactPhones.length === 0 ? (
                    <Alert severity="warning">У выбранного сотрудника нет номера для Telegram.</Alert>
                  ) : null}
                  {contactPhones.length > 1 ? (
                    <FormControl fullWidth size="small">
                      <InputLabel id="my-files-share-phone-label">Номер телефона</InputLabel>
                      <Select
                        labelId="my-files-share-phone-label"
                        label="Номер телефона"
                        value={selectedPhoneId}
                        onChange={(event) => setSelectedPhoneId(event.target.value)}
                        data-testid="my-files-share-telegram-phone"
                      >
                        {contactPhones.map((phone) => (
                          <MenuItem key={phone.id} value={phone.id}>{phone.label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : null}
                  {selectedContact && contactPhones.length === 1 ? (
                    <Typography variant="body2" color="text.secondary" data-testid="my-files-share-telegram-phone-auto">
                      Номер: {contactPhones[0].label}
                    </Typography>
                  ) : null}
                  <Button
                    variant="contained"
                    startIcon={<SendOutlinedIcon />}
                    onClick={handleOpenTelegram}
                    disabled={!selectedContact || !selectedPhone}
                    fullWidth={isMobile}
                    data-testid="my-files-share-open-telegram"
                  >
                    Открыть Telegram
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    Текст сообщения подставится в Telegram автоматически.
                  </Typography>
                </>
              )}
            </Stack>
          ) : null}

          {sendChannel === 'max' ? (
            <Stack spacing={1.25}>
              <Alert severity="info" data-testid="my-files-share-max-help">
                <Typography variant="body2" component="div" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Как отправить в MAX
                </Typography>
                <Typography variant="body2" component="div">1. Нажмите «Скопировать текст».</Typography>
                <Typography variant="body2" component="div">2. Откройте приложение MAX.</Typography>
                <Typography variant="body2" component="div">3. Найдите нужный контакт в поиске.</Typography>
                <Typography variant="body2" component="div">4. Вставьте текст в сообщение и отправьте.</Typography>
              </Alert>
              <Button
                variant="contained"
                startIcon={<ContentCopyOutlinedIcon />}
                onClick={handleCopyForMax}
                fullWidth={isMobile}
                data-testid="my-files-share-copy-max"
              >
                Скопировать текст
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'stretch', gap: 1, px: 2, pb: 2 }}>
        <Button
          startIcon={<ContentCopyOutlinedIcon />}
          onClick={handleCopyLink}
          fullWidth={isMobile}
        >
          Скопировать ссылку
        </Button>
        {typeof onRotateShare === 'function' ? (
          <Button onClick={onRotateShare} fullWidth={isMobile} data-testid="my-files-share-rotate">
            Новая ссылка
          </Button>
        ) : null}
        <Button onClick={onClose} fullWidth={isMobile}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
