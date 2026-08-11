import { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import TelegramIcon from '@mui/icons-material/Telegram';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import { useNavigate } from 'react-router-dom';
import { chatDirectoryAPI } from '../../api/chatDirectory';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';
import { stashChatComposePrefill } from '../../lib/chatComposePrefill';
import { buildTelegramShareUrl } from '../../lib/messengerLinks';
import { buildOfficeUiTokens, getOfficeDialogPaperSx } from '../../theme/officeUiTokens';
import { buildFeedShareMessage } from './feedUtils';

const userLabel = (user) => {
  const fullName = String(user?.full_name || '').trim();
  const username = String(user?.username || '').trim();
  return [fullName, username ? `@${username}` : ''].filter(Boolean).join(' · ') || 'Пользователь';
};

export default function FeedShareDialog({ open, post, url, onClose, notifySuccess, notifyWarning }) {
  const navigate = useNavigate();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const shareMessage = useMemo(() => buildFeedShareMessage(post, url), [post, url]);
  const telegramUrl = useMemo(() => buildTelegramShareUrl({ url, text: post?.title || '' }), [post?.title, url]);
  const nativeShareAvailable = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelectedUser(null);
      setUsers([]);
      return undefined;
    }
    if (!CHAT_FEATURE_ENABLED || query.trim().length < 2) {
      setUsers([]);
      return undefined;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      chatDirectoryAPI.getUsers({ q: query.trim(), limit: 12 })
        .then((payload) => {
          if (!cancelled) setUsers(Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []));
        })
        .catch(() => {
          if (!cancelled) setUsers([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [open, query]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      notifySuccess?.('Ссылка на публикацию скопирована.');
    } catch {
      notifyWarning?.('Не удалось скопировать ссылку. Скопируйте адрес из браузера вручную.');
    }
  };

  const shareToChat = () => {
    const peerUserId = Number(selectedUser?.id || 0);
    if (!peerUserId) {
      notifyWarning?.('Выберите сотрудника для отправки в корпоративный чат.');
      return;
    }
    stashChatComposePrefill({ peerUserId, bodyText: shareMessage });
    onClose?.();
    navigate('/chat?compose=prefill');
  };

  const shareNative = async () => {
    try {
      await navigator.share({ title: post?.title || 'Публикация', text: post?.preview || '', url });
      onClose?.();
    } catch (error) {
      if (error?.name !== 'AbortError') notifyWarning?.('Не удалось открыть системное меню отправки.');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullScreen={mobile} fullWidth maxWidth="sm" PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}>
      <DialogTitle sx={{ pr: 7 }}>
        <Typography component="div" variant="h6" sx={{ fontWeight: 800 }}>Поделиться публикацией</Typography>
        <Typography variant="body2" color="text.secondary" noWrap>{post?.title}</Typography>
        <IconButton aria-label="Закрыть меню отправки" onClick={onClose} sx={{ position: 'absolute', top: 8, right: 8 }}>
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {CHAT_FEATURE_ENABLED ? (
            <Box>
              <Typography sx={{ fontWeight: 800, mb: 0.75 }}>Корпоративный чат</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
                <Autocomplete
                  fullWidth
                  options={users}
                  value={selectedUser}
                  inputValue={query}
                  onInputChange={(_event, value) => setQuery(value)}
                  onChange={(_event, value) => setSelectedUser(value)}
                  getOptionLabel={userLabel}
                  isOptionEqualToValue={(option, value) => Number(option?.id) === Number(value?.id)}
                  loading={loading}
                  noOptionsText={query.trim().length < 2 ? 'Введите минимум 2 символа' : 'Сотрудники не найдены'}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Получатель"
                      placeholder="Имя или логин"
                      InputProps={{
                        ...params.InputProps,
                        endAdornment: <>{loading ? <CircularProgress size={18} /> : null}{params.InputProps.endAdornment}</>,
                      }}
                    />
                  )}
                />
                <Button variant="contained" startIcon={<ForumOutlinedIcon />} onClick={shareToChat} sx={{ minHeight: 56, whiteSpace: 'nowrap' }}>
                  Открыть чат
                </Button>
              </Stack>
            </Box>
          ) : null}
          <Divider />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              component="a"
              href={telegramUrl || undefined}
              target="_blank"
              rel="noreferrer"
              variant="outlined"
              startIcon={<TelegramIcon />}
              disabled={!telegramUrl}
              fullWidth
            >
              Telegram
            </Button>
            <Button variant="outlined" startIcon={<ContentCopyRoundedIcon />} onClick={copyLink} fullWidth>
              Копировать ссылку
            </Button>
            {nativeShareAvailable ? (
              <Button variant="outlined" startIcon={<ShareOutlinedIcon />} onClick={shareNative} fullWidth>
                Другие приложения
              </Button>
            ) : null}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}

