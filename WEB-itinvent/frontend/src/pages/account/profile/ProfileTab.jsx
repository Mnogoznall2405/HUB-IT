import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import CameraAltOutlinedIcon from '@mui/icons-material/CameraAltOutlined';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import { PresenceAvatar } from '../../../components/chat/ChatCommon';
import OverflowMenu from '../../../components/common/OverflowMenu';
import {
  getAccountDisplayName,
  getAccountSubtitle,
} from '../../../components/account/AccountIdentity';
import { authAPI, mailAPI } from '../../../api/client';
import { useAuth } from '../../../contexts/AuthContext';
import { useNotification } from '../../../contexts/NotificationContext';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';
import { roleOptions } from '../accountConstants';
import {
  buildDefaultExchangeLoginPreview,
  createEmptyMailboxDraft,
  createMailboxDraftFromEntry,
  formatDateTime,
  getDbName,
  MAILBOX_AUTH_LABELS,
  MAILBOX_AUTH_SHORT_LABELS,
  normalizeMailboxAuthMode,
  summarizePermissions,
} from '../accountUserModel';
import SectionCard from '../shared/SectionCard';
import ProfileField from '../shared/ProfileField';

function AvatarUploadBlock({ user }) {

  const { refreshSession } = useAuth();
  const { notifyApiError, notifySuccess } = useNotification();
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notifyApiError(null, 'Можно загружать только изображения.', { source: 'avatar' });
      return;
    }
    setUploading(true);
    try {
      await authAPI.uploadAvatar(file);
      await refreshSession({ suppressAuthRequired: true });
      notifySuccess('Фото профиля обновлено.', { source: 'avatar' });
    } catch (err) {
      notifyApiError(err, 'Не удалось загрузить фото.', { source: 'avatar' });
    } finally {
      setUploading(false);
    }
  }, [notifyApiError, notifySuccess, refreshSession]);

  const handleDelete = useCallback(async () => {
    setUploading(true);
    try {
      await authAPI.deleteAvatar();
      await refreshSession({ suppressAuthRequired: true });
      notifySuccess('Фото профиля удалено.', { source: 'avatar' });
    } catch (err) {
      notifyApiError(err, 'Не удалось удалить фото.', { source: 'avatar' });
    } finally {
      setUploading(false);
    }
  }, [notifyApiError, notifySuccess, refreshSession]);

  return (
    <Box sx={{ position: 'relative', width: 78, height: 78, flexShrink: 0 }}>
      <PresenceAvatar
        item={user}
        size={78}
        sx={{
          border: '2px solid',
          borderColor: 'background.paper',
          borderRadius: '999px',
          boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <Tooltip title="Изменить фото">
        <span>
          <IconButton
            aria-label="Изменить фото профиля"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            sx={{
              position: 'absolute',
              right: -5,
              bottom: -5,
              width: 38,
              height: 38,
              minWidth: '38px !important',
              minHeight: '38px !important',
              border: '2px solid',
              borderColor: 'background.paper',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              boxShadow: '0 8px 18px rgba(0,0,0,0.24)',
              '&:hover': { bgcolor: 'primary.dark' },
            }}
          >
            <CameraAltOutlinedIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </span>
      </Tooltip>
      {user?.avatar_url ? (
        <Tooltip title="Удалить фото">
          <span>
            <IconButton
              aria-label="Удалить фото профиля"
              onClick={handleDelete}
              disabled={uploading}
              sx={{
                position: 'absolute',
                left: -5,
                bottom: -5,
                width: 34,
                height: 34,
                minWidth: '34px !important',
                minHeight: '34px !important',
                border: '2px solid',
                borderColor: 'background.paper',
                bgcolor: 'background.paper',
                color: 'error.main',
                boxShadow: '0 8px 18px rgba(0,0,0,0.2)',
              }}
            >
              <DeleteOutlinedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      ) : null}
      {uploading ? (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '999px', bgcolor: 'rgba(0,0,0,0.45)' }}>
          <CircularProgress size={24} sx={{ color: '#fff' }} />
        </Box>
      ) : null}
    </Box>
  );
}

export function ProfileTab({ user, dbOptions, canAccessMail }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const { notifyApiError, notifySuccess } = useNotification();
  const [mailboxes, setMailboxes] = useState([]);
  const [mailboxesLoading, setMailboxesLoading] = useState(true);
  const [mailboxDialogOpen, setMailboxDialogOpen] = useState(false);
  const [mailboxDialogMode, setMailboxDialogMode] = useState('create');
  const [mailboxDraft, setMailboxDraft] = useState(() => createEmptyMailboxDraft(user));
  const [mailboxSaving, setMailboxSaving] = useState(false);

  const loadMailboxes = useCallback(async () => {
    if (!canAccessMail) {
      setMailboxes([]);
      setMailboxesLoading(false);
      return;
    }
    setMailboxesLoading(true);
    try {
      const data = await mailAPI.listMailboxes({ includeUnread: true });
      setMailboxes(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить список подключённых ящиков.', {
        source: 'settings-mailboxes',
      });
      setMailboxes([]);
    } finally {
      setMailboxesLoading(false);
    }
  }, [canAccessMail, notifyApiError]);

  useEffect(() => {
    loadMailboxes();
  }, [loadMailboxes]);

  useEffect(() => {
    if (!mailboxDialogOpen) {
      setMailboxDraft(createEmptyMailboxDraft(user));
    }
  }, [mailboxDialogOpen, user]);

  const openCreateMailboxDialog = useCallback(() => {
    setMailboxDialogMode('create');
    setMailboxDraft(createEmptyMailboxDraft(user));
    setMailboxDialogOpen(true);
  }, [user]);

  const openEditMailboxDialog = useCallback((entry) => {
    setMailboxDialogMode('edit');
    setMailboxDraft(createMailboxDraftFromEntry(entry, user));
    setMailboxDialogOpen(true);
  }, [user]);

  const handleMailboxDraftChange = useCallback((key, value) => {
    setMailboxDraft((prev) => {
      const next = { ...(prev || {}), [key]: value };
      if (key === 'auth_mode' && value !== 'stored_credentials') {
        next.mailbox_login = '';
        next.mailbox_password = '';
        next.is_primary = false;
      }
      if (key === 'auth_mode' && value === 'stored_credentials' && !String(next.mailbox_login || '').trim()) {
        next.mailbox_login = buildDefaultExchangeLoginPreview(user?.username);
      }
      return next;
    });
  }, [user?.username]);

  const handleMailboxSubmit = useCallback(async () => {
    const authMode = normalizeMailboxAuthMode(mailboxDraft.auth_mode);
    const payload = {
      label: String(mailboxDraft.label || '').trim() || undefined,
      mailbox_email: String(mailboxDraft.mailbox_email || '').trim(),
      mailbox_login: authMode === 'stored_credentials' ? String(mailboxDraft.mailbox_login || '').trim() || undefined : undefined,
      mailbox_password: authMode === 'stored_credentials' ? String(mailboxDraft.mailbox_password || '') : undefined,
      auth_mode: authMode,
      is_primary: authMode === 'primary_credentials' ? false : Boolean(mailboxDraft.is_primary),
      is_active: Boolean(mailboxDraft.is_active),
    };
    if (!payload.mailbox_email) return;
    if (authMode === 'stored_credentials' && mailboxDialogMode === 'create' && !payload.mailbox_password) return;
    setMailboxSaving(true);
    try {
      if (mailboxDialogMode === 'edit' && mailboxDraft.id) {
        await mailAPI.updateMailbox(mailboxDraft.id, payload);
        notifySuccess('Ящик обновлён.', { source: 'settings-mailboxes', dedupeMode: 'none' });
      } else {
        await mailAPI.createMailbox(payload);
        notifySuccess('Ящик подключён.', { source: 'settings-mailboxes', dedupeMode: 'none' });
      }
      setMailboxDialogOpen(false);
      await loadMailboxes();
    } catch (error) {
      notifyApiError(error, mailboxDialogMode === 'edit' ? 'Не удалось обновить ящик.' : 'Не удалось подключить ящик.', {
        source: 'settings-mailboxes',
      });
    } finally {
      setMailboxSaving(false);
    }
  }, [loadMailboxes, mailboxDialogMode, mailboxDraft, notifyApiError, notifySuccess]);

  const handleMailboxPrimary = useCallback(async (entry) => {
    try {
      await mailAPI.updateMailbox(entry.id, { is_primary: true });
      notifySuccess('Основной ящик обновлён.', { source: 'settings-mailboxes', dedupeMode: 'none' });
      await loadMailboxes();
    } catch (error) {
      notifyApiError(error, 'Не удалось назначить основной ящик.', {
        source: 'settings-mailboxes',
      });
    }
  }, [loadMailboxes, notifyApiError, notifySuccess]);

  const handleMailboxActiveToggle = useCallback(async (entry) => {
    try {
      await mailAPI.updateMailbox(entry.id, { is_active: !Boolean(entry?.is_active) });
      notifySuccess(entry?.is_active ? 'Ящик отключён.' : 'Ящик включён.', {
        source: 'settings-mailboxes',
        dedupeMode: 'none',
      });
      await loadMailboxes();
    } catch (error) {
      notifyApiError(error, 'Не удалось изменить состояние ящика.', {
        source: 'settings-mailboxes',
      });
    }
  }, [loadMailboxes, notifyApiError, notifySuccess]);

  const handleMailboxDelete = useCallback(async (entry) => {
    if (!entry?.id) return;
    if (!window.confirm(`Отключить ящик "${entry.label || entry.mailbox_email || 'без названия'}"?`)) return;
    try {
      await mailAPI.deleteMailbox(entry.id);
      notifySuccess('Ящик удалён.', { source: 'settings-mailboxes', dedupeMode: 'none' });
      await loadMailboxes();
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить ящик.', {
        source: 'settings-mailboxes',
      });
    }
  }, [loadMailboxes, notifyApiError, notifySuccess]);

  const handleMailboxAction = useCallback((action, entry) => {
    if (action === 'edit') {
      openEditMailboxDialog(entry);
      return;
    }
    if (action === 'primary') {
      void handleMailboxPrimary(entry);
      return;
    }
    if (action === 'toggle') {
      void handleMailboxActiveToggle(entry);
      return;
    }
    if (action === 'delete') {
      void handleMailboxDelete(entry);
    }
  }, [
    handleMailboxActiveToggle,
    handleMailboxDelete,
    handleMailboxPrimary,
    openEditMailboxDialog,
  ]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0 }}>
      <Paper
        data-testid="profile-hero"
        sx={{
          p: { xs: 1.25, sm: 1.6, md: 2 },
          borderRadius: { xs: '18px', sm: '22px' },
          border: '1px solid',
          borderColor: alpha(theme.palette.divider, 0.62),
          bgcolor: alpha(ui.panelSolid, theme.palette.mode === 'dark' ? 0.72 : 0.78),
          backgroundImage: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.2)}, ${alpha(theme.palette.info.main, 0.08)} 48%, transparent 86%)`,
          backdropFilter: 'blur(22px) saturate(145%)',
          WebkitBackdropFilter: 'blur(22px) saturate(145%)',
          boxShadow: ui.dialogShadow,
          overflow: 'hidden',
        }}
      >
        <Stack direction="row" spacing={{ xs: 1.5, sm: 2 }} alignItems="center">
          <AvatarUploadBlock user={user} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              sx={{
                fontSize: { xs: '1.45rem', sm: '1.75rem' },
                lineHeight: 1.12,
                letterSpacing: '-0.025em',
                fontWeight: 900,
                overflowWrap: 'anywhere',
              }}
            >
              {getAccountDisplayName(user)}
            </Typography>
            <Typography
              color="text.secondary"
              sx={{
                mt: 0.4,
                fontSize: { xs: '0.92rem', sm: '1rem' },
                lineHeight: 1.3,
                overflowWrap: 'anywhere',
              }}
            >
              {getAccountSubtitle(user)}
            </Typography>
            {user?.email ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.35, fontSize: { xs: '0.82rem', sm: '0.875rem' }, overflowWrap: 'anywhere' }}
              >
                {user.email}
              </Typography>
            ) : null}
          </Box>
        </Stack>
      </Paper>

      <Accordion
        disableGutters
        elevation={0}
        sx={{
          border: '1px solid',
          borderColor: ui.borderSoft,
          borderRadius: '14px !important',
          bgcolor: ui.panelSolid,
          overflow: 'hidden',
          '&.Mui-expanded': { margin: '0 !important' },
          '&::before': { display: 'none' },
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreOutlinedIcon />}
          sx={{
            minHeight: 52,
            px: 1.4,
            '& .MuiAccordionSummary-content': { my: 1 },
          }}
        >
          <Typography sx={{ fontWeight: 850 }}>Служебные данные</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={1.2}>
            <Grid item xs={12} md={4}><ProfileField label="Логин" value={user?.username} /></Grid>
            <Grid item xs={12} md={4}><ProfileField label="Роль" value={roleOptions.find((item) => item.value === user?.role)?.label || user?.role} /></Grid>
            <Grid item xs={12} md={4}><ProfileField label="Источник входа" value={user?.auth_source === 'ldap' ? 'AD / LDAP' : 'Локальная'} /></Grid>
            <Grid item xs={12} md={4}><ProfileField label="Назначенная БД" value={getDbName(dbOptions, user?.assigned_database)} /></Grid>
            <Grid item xs={12} md={4}><ProfileField label="Telegram ID" value={user?.telegram_id ? String(user.telegram_id) : 'не указан'} /></Grid>
            <Grid item xs={12} md={4}><ProfileField label="Права" value={summarizePermissions(user)} /></Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {canAccessMail ? (
        <SectionCard
        title="Подключённые ящики"
        action={(
          <Button
            size="small"
            startIcon={<AddOutlinedIcon />}
            onClick={openCreateMailboxDialog}
            sx={{ borderRadius: '11px', px: 1 }}
          >
            Добавить
          </Button>
        )}
        headerSx={{ px: { xs: 1.15, sm: 1.35 }, py: { xs: 0.75, sm: 0.95 } }}
        contentSx={{ p: { xs: 0.8, sm: 1.25 } }}
        >
        <Stack spacing={1}>
          {mailboxesLoading ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">Загружаю подключённые ящики...</Typography>
            </Stack>
          ) : mailboxes.length === 0 ? (
            <Alert severity="info" sx={{ borderRadius: '10px' }}>
              Дополнительные ящики пока не подключены.
            </Alert>
          ) : mailboxes.map((entry) => {
            const displayName = entry.label || entry.mailbox_email || 'Без названия';
            const authMode = String(entry.auth_mode || '').trim();
            const unreadCount = Number(entry.unread_count || 0);
            const actions = [
              { key: 'edit', label: 'Редактировать' },
              ...(!entry.is_primary ? [{ key: 'primary', label: 'Сделать основным' }] : []),
              { key: 'toggle', label: entry.is_active ? 'Отключить' : 'Включить' },
              { key: 'delete', label: 'Удалить', tone: 'danger' },
            ];
            return (
            <Paper
              key={String(entry.id)}
              data-testid={`profile-mailbox-card-${String(entry.id)}`}
              variant="outlined"
              sx={{
                p: { xs: 1, sm: 1.25 },
                borderRadius: '13px',
                borderColor: ui.borderSoft,
                bgcolor: alpha(ui.panelSolid, theme.palette.mode === 'dark' ? 0.54 : 0.72),
                boxShadow: 'none',
              }}
            >
              <Stack spacing={0.85}>
                <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>
                      {displayName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15, overflowWrap: 'anywhere' }}>
                      {entry.mailbox_email || 'Почта не указана'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                      {entry.mailbox_login || entry.effective_mailbox_login || buildDefaultExchangeLoginPreview(user?.username)}
                    </Typography>
                  </Box>
                  <OverflowMenu
                    size="medium"
                    label={`Действия для ящика ${displayName}`}
                    items={actions}
                    onSelect={(action) => handleMailboxAction(action, entry)}
                  />
                </Stack>
                <Stack direction="row" spacing={0.65} flexWrap="wrap" useFlexGap>
                  {entry.is_primary ? <Chip size="small" color="primary" label="Основной" sx={{ height: 26 }} /> : null}
                  <Chip
                    size="small"
                    color={entry.is_active ? 'success' : 'default'}
                    label={entry.is_active ? 'Активен' : 'Отключён'}
                    sx={{ height: 26 }}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={MAILBOX_AUTH_SHORT_LABELS[authMode] || MAILBOX_AUTH_SHORT_LABELS.stored_credentials}
                    sx={{ height: 26 }}
                  />
                  {unreadCount > 0 ? (
                    <Chip size="small" variant="outlined" label={`Непрочитанных: ${unreadCount}`} sx={{ height: 26 }} />
                  ) : null}
                </Stack>
              </Stack>
            </Paper>
            );
          })}
        </Stack>
        </SectionCard>
      ) : null}

      {canAccessMail ? (
        <Dialog open={mailboxDialogOpen} onClose={() => setMailboxDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{mailboxDialogMode === 'edit' ? 'Редактировать ящик' : 'Подключить ящик'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.25} sx={{ mt: 0.5 }}>
            <TextField
              fullWidth
              size="small"
              label="Название"
              value={mailboxDraft.label}
              onChange={(event) => handleMailboxDraftChange('label', event.target.value)}
            />
            <TextField
              fullWidth
              size="small"
              label="Почта"
              value={mailboxDraft.mailbox_email}
              onChange={(event) => handleMailboxDraftChange('mailbox_email', event.target.value)}
              required
            />
            <FormControl fullWidth size="small">
              <InputLabel id="mailbox-auth-mode-label">{'\u0421\u043f\u043e\u0441\u043e\u0431 \u0432\u0445\u043e\u0434\u0430'}</InputLabel>
              <Select
                labelId="mailbox-auth-mode-label"
                label={'\u0421\u043f\u043e\u0441\u043e\u0431 \u0432\u0445\u043e\u0434\u0430'}
                value={mailboxDraft.auth_mode || 'stored_credentials'}
                onChange={(event) => handleMailboxDraftChange('auth_mode', event.target.value)}
              >
                <MenuItem value="primary_credentials">{MAILBOX_AUTH_LABELS.primary_credentials}</MenuItem>
                {String(mailboxDraft.auth_mode || '').trim() === 'primary_session' ? (
                  <MenuItem value="primary_session">{MAILBOX_AUTH_LABELS.primary_session}</MenuItem>
                ) : null}
                <MenuItem value="stored_credentials">{MAILBOX_AUTH_LABELS.stored_credentials}</MenuItem>
              </Select>
            </FormControl>
            {String(mailboxDraft.auth_mode || '').trim() === 'primary_credentials' ? (
              <Alert severity="info" sx={{ borderRadius: '10px' }}>
                {'\u0414\u043b\u044f \u043e\u0431\u0449\u0435\u0433\u043e \u044f\u0449\u0438\u043a\u0430 \u0443\u043a\u0430\u0436\u0438\u0442\u0435 \u0442\u043e\u043b\u044c\u043a\u043e \u0435\u0433\u043e \u0430\u0434\u0440\u0435\u0441. Exchange \u0431\u0443\u0434\u0435\u0442 \u043e\u0442\u043a\u0440\u044b\u0442 \u0447\u0435\u0440\u0435\u0437 \u0432\u0430\u0448\u0443 \u043e\u0441\u043d\u043e\u0432\u043d\u0443\u044e AD-\u0443\u0447\u0435\u0442\u043a\u0443. \u0415\u0441\u043b\u0438 \u043f\u0430\u0440\u043e\u043b\u044c \u0438\u0437\u043c\u0435\u043d\u0438\u043b\u0441\u044f, \u0432\u044b\u0439\u0434\u0438\u0442\u0435 \u0438 \u0441\u043d\u043e\u0432\u0430 \u0432\u043e\u0439\u0434\u0438\u0442\u0435 \u0447\u0435\u0440\u0435\u0437 AD.'}
              </Alert>
            ) : null}
            <TextField
              fullWidth
              size="small"
              label="Логин"
              value={mailboxDraft.mailbox_login}
              onChange={(event) => handleMailboxDraftChange('mailbox_login', event.target.value)}
              placeholder={buildDefaultExchangeLoginPreview(user?.username)}
              disabled={String(mailboxDraft.auth_mode || '').trim() !== 'stored_credentials'}
            />
            <TextField
              fullWidth
              size="small"
              type="password"
              label="Пароль"
              value={mailboxDraft.mailbox_password}
              onChange={(event) => handleMailboxDraftChange('mailbox_password', event.target.value)}
              disabled={String(mailboxDraft.auth_mode || '').trim() !== 'stored_credentials'}
              helperText={mailboxDialogMode === 'edit' ? 'Оставьте пустым, чтобы не менять текущий пароль.' : 'Пароль будет сразу проверен через Exchange.'}
            />
            <FormControlLabel
              control={(
                <Checkbox
                  checked={Boolean(mailboxDraft.is_primary)}
                  onChange={(event) => handleMailboxDraftChange('is_primary', event.target.checked)}
                  disabled={String(mailboxDraft.auth_mode || '').trim() === 'primary_credentials'}
                />
              )}
              label="Сделать основным"
            />
            <FormControlLabel
              control={(
                <Checkbox
                  checked={Boolean(mailboxDraft.is_active)}
                  onChange={(event) => handleMailboxDraftChange('is_active', event.target.checked)}
                />
              )}
              label="Ящик активен"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMailboxDialogOpen(false)}>Отмена</Button>
          <Button
            variant="contained"
            onClick={handleMailboxSubmit}
            disabled={
              mailboxSaving
              || !String(mailboxDraft.mailbox_email || '').trim()
              || (
                String(mailboxDraft.auth_mode || '').trim() === 'stored_credentials'
                && mailboxDialogMode === 'create'
                && !String(mailboxDraft.mailbox_password || '').trim()
              )
            }
          >
            {mailboxSaving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogActions>
        </Dialog>
      ) : null}
    </Box>
  );
}
