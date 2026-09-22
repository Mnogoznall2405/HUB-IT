import { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
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
import { isMobileAppWebViewRuntime, requestMobileAppCommand } from '../../lib/mobileAppBridge';
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
  const apkShareAvailable = isMobileAppWebViewRuntime();
  const nativeShareAvailable = apkShareAvailable
    || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');

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
      const payload = { title: post?.title || 'Публикация', text: post?.preview || '', url };
      if (apkShareAvailable) await requestMobileAppCommand('share.text', payload);
      else await navigator.share(payload);
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
      <DialogContent>
        <Stack spacing={2}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              p: 0.75,
              pl: 1.5,
              borderRadius: '12px',
              bgcolor: ui.panelBg,
              border: '1px solid',
              borderColor: alpha(theme.palette.text.primary, 0.08),
            }}
          >
            <Typography
              variant="body2"
              color="text.secondary"
              noWrap
              title={url}
              sx={{ flex: 1, minWidth: 0, fontFamily: 'monospace' }}
            >
              {url}
            </Typography>
            <Button
              variant="contained"
              size="small"
              startIcon={<ContentCopyRoundedIcon />}
              onClick={copyLink}
              sx={{ flexShrink: 0, minHeight: 40, borderRadius: '10px', textTransform: 'none', fontWeight: 700 }}
            >
              Копировать
            </Button>
          </Box>

          <Stack direction="row" spacing={1}>
            <Button
              component="a"
              href={telegramUrl || undefined}
              target="_blank"
              rel="noreferrer"
              variant="outlined"
              startIcon={<TelegramIcon />}
              disabled={!telegramUrl}
              fullWidth
              sx={{ minHeight: 44, borderRadius: '12px', textTransform: 'none', fontWeight: 700 }}
            >
              Telegram
            </Button>
            {nativeShareAvailable ? (
              <Button
                variant="outlined"
                startIcon={<ShareOutlinedIcon />}
                onClick={shareNative}
                fullWidth
                sx={{ minHeight: 44, borderRadius: '12px', textTransform: 'none', fontWeight: 700 }}
              >
                Другие приложения
              </Button>
            ) : null}
          </Stack>

          {CHAT_FEATURE_ENABLED ? (
            <>
              <Divider sx={{ '&::before, &::after': { borderColor: alpha(theme.palette.text.primary, 0.08) } }}>
                <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
                  или сотруднику в чат
                </Typography>
              </Divider>
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
                    placeholder="Имя или логин"
                    inputProps={{ ...params.inputProps, 'aria-label': 'Сотрудник' }}
                    InputProps={{
                      ...params.InputProps,
                      startAdornment: <ForumOutlinedIcon sx={{ mr: 1, color: 'text.disabled' }} />,
                      endAdornment: <>{loading ? <CircularProgress size={18} /> : null}{params.InputProps.endAdornment}</>,
                    }}
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px', bgcolor: ui.panelBg } }}
                  />
                )}
              />
              <Button
                variant="contained"
                startIcon={<ForumOutlinedIcon />}
                onClick={shareToChat}
                disabled={!selectedUser}
                fullWidth
                sx={{ minHeight: 44, borderRadius: '12px', textTransform: 'none', fontWeight: 700 }}
              >
                {selectedUser ? 'Отправить в чат' : 'Открыть чат'}
              </Button>
            </>
          ) : null}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
