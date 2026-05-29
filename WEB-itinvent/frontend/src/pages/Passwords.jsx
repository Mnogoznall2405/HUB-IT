import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildOfficeUiTokens, getOfficeCodeBlockSx } from '../theme/officeUiTokens';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  Menu,
  List,
  MenuItem,
  InputLabel,
  Select,
  ListItemButton,
  ListItemText,
  Paper,
  Skeleton,
  Slider,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import MoreVertOutlinedIcon from '@mui/icons-material/MoreVertOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import { useNavigate } from 'react-router-dom';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { passwordsAPI } from '../api/passwords';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

const PASSWORD_HIDE_MS = 30_000;
const DEFAULT_PASSWORD_LENGTH = 20;
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';
const SIMILAR_CHARS = new Set('Il1O0o'.split(''));

const emptyForm = {
  id: '',
  group: '',
  tags: [],
  login: '',
  password: '',
  description: '',
};

const emptyGeneratorOptions = {
  length: DEFAULT_PASSWORD_LENGTH,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  excludeSimilar: true,
};

const normalizeText = (value) => String(value ?? '').trim();

const normalizeEntry = (entry) => ({
  id: normalizeText(entry?.id),
  group: normalizeText(entry?.group),
  tags: Array.isArray(entry?.tags) ? entry.tags.map(normalizeText).filter(Boolean) : [],
  login: normalizeText(entry?.login),
  description: normalizeText(entry?.description),
  is_archived: Boolean(entry?.is_archived),
  created_at: entry?.created_at || null,
  updated_at: entry?.updated_at || null,
  created_by: entry?.created_by || '',
  updated_by: entry?.updated_by || '',
  password_configured: entry?.password_configured !== false,
});

export const normalizeTagList = (value) => {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  return items
    .map((item) => normalizeText(item).replace(/^#+/, '').trim())
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 20);
};

const buildCharacterSets = (options = {}) => {
  const excludeSimilar = options.excludeSimilar !== false;
  const clean = (value) => (
    excludeSimilar
      ? value.split('').filter((char) => !SIMILAR_CHARS.has(char)).join('')
      : value
  );
  return [
    options.lower !== false ? clean(LOWER) : '',
    options.upper !== false ? clean(UPPER) : '',
    options.digits !== false ? clean(DIGITS) : '',
    options.symbols !== false ? clean(SYMBOLS) : '',
  ].filter(Boolean);
};

export function generateVaultPassword(options = {}, cryptoSource = globalThis.crypto) {
  if (!cryptoSource || typeof cryptoSource.getRandomValues !== 'function') {
    throw new Error('Web Crypto API is unavailable');
  }
  const sets = buildCharacterSets({ ...emptyGeneratorOptions, ...options });
  if (!sets.length) {
    throw new Error('Select at least one character set');
  }
  const length = Math.max(sets.length, Math.min(128, Number(options.length || DEFAULT_PASSWORD_LENGTH) || DEFAULT_PASSWORD_LENGTH));
  const charset = sets.join('');
  const bytes = new Uint8Array(1);
  const randomIndex = (size) => {
    const max = 256 - (256 % size);
    do {
      cryptoSource.getRandomValues(bytes);
    } while (bytes[0] >= max);
    return bytes[0] % size;
  };
  const result = sets.map((set) => set[randomIndex(set.length)]);
  while (result.length < length) {
    result.push(charset[randomIndex(charset.length)]);
  }
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result.join('');
}

const isUnlockedUntilActive = (value) => {
  const raw = normalizeText(value);
  if (!raw) return false;
  const parsed = new Date(raw);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now();
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

function Passwords() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const { notifySuccess, notifyWarning, notifyApiError } = useNotification();
  const [entries, setEntries] = useState([]);
  const [groups, setGroups] = useState([]);
  const [tags, setTags] = useState([]);
  const [auditItems, setAuditItems] = useState([]);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [unlockedUntil, setUnlockedUntil] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revealBusyId, setRevealBusyId] = useState('');
  const [revealedPasswords, setRevealedPasswords] = useState({});
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [formMode, setFormMode] = useState('create');
  const [form, setForm] = useState(emptyForm);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [unlockCode, setUnlockCode] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [pendingReveal, setPendingReveal] = useState(null);
  const [generatorOptions, setGeneratorOptions] = useState(emptyGeneratorOptions);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [nowTs, setNowTs] = useState(Date.now());
  const [rowMenuAnchor, setRowMenuAnchor] = useState(null);
  const [rowMenuEntry, setRowMenuEntry] = useState(null);
  const hideTimersRef = useRef({});

  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const canWrite = isAdmin || hasPermission('passwords.write');
  const isUnlocked = isUnlockedUntilActive(unlockedUntil);
  const unlockedRemainingMs = useMemo(() => {
    const parsed = new Date(unlockedUntil || '');
    if (Number.isNaN(parsed.getTime())) return 0;
    return Math.max(0, parsed.getTime() - nowTs);
  }, [nowTs, unlockedUntil]);

  const unlockedRemainingLabel = useMemo(() => {
    const totalSeconds = Math.floor(unlockedRemainingMs / 1000);
    if (totalSeconds <= 0) return '';
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }, [unlockedRemainingMs]);
  const isUnlockExpiringSoon = isUnlocked && unlockedRemainingMs > 0 && unlockedRemainingMs <= 30_000;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => () => {
    Object.values(hideTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
  }, []);

  useEffect(() => {
    if (!isUnlocked) return undefined;
    const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isUnlocked]);

  const loadAudit = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const payload = await passwordsAPI.getAudit({ limit: 100 });
      setAuditItems(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить аудит паролей.', { dedupeMode: 'recent' });
    }
  }, [isAdmin, notifyApiError]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const [payload, groupsPayload] = await Promise.all([
        passwordsAPI.getEntries({
          q: debouncedQuery,
          group: selectedGroup,
          tag: selectedTag,
          include_archived: includeArchived,
        }),
        passwordsAPI.getGroups(),
      ]);
      const configuredGroups = (Array.isArray(groupsPayload?.items) ? groupsPayload.items : [])
        .map((item) => normalizeText(item?.name))
        .filter(Boolean);
      const responseGroups = Array.isArray(payload?.groups) ? payload.groups.map(normalizeText).filter(Boolean) : [];
      const nextGroups = configuredGroups.length ? configuredGroups : responseGroups;
      setEntries((Array.isArray(payload?.items) ? payload.items : []).map(normalizeEntry));
      setGroups(nextGroups);
      setTags(Array.isArray(payload?.tags) ? payload.tags.map(normalizeText).filter(Boolean) : []);
      setUnlockedUntil(payload?.unlocked_until || null);
      if (selectedGroup && !nextGroups.includes(selectedGroup)) {
        setSelectedGroup('');
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить список паролей.', { dedupeMode: 'recent' });
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, includeArchived, notifyApiError, selectedGroup, selectedTag]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  const visibleEntries = useMemo(() => entries, [entries]);

  const openCreateDialog = () => {
    setFormMode('create');
    setForm(emptyForm);
    setGeneratedPassword('');
    setEntryDialogOpen(true);
  };

  const openEditDialog = (entry) => {
    setFormMode('edit');
    setForm({
      id: entry.id,
      group: entry.group,
      tags: [...entry.tags],
      login: entry.login,
      password: '',
      description: entry.description,
    });
    setGeneratedPassword('');
    setEntryDialogOpen(true);
  };

  const handleSaveEntry = async () => {
    const payload = {
      group: form.group,
      tags: normalizeTagList(form.tags),
      login: form.login,
      description: form.description,
    };
    if (formMode === 'create' || form.password) {
      payload.password = form.password;
    }
    setSaving(true);
    try {
      if (formMode === 'edit') {
        await passwordsAPI.updateEntry(form.id, payload);
        notifySuccess('Запись обновлена.', { source: 'passwords', dedupeMode: 'none' });
      } else {
        await passwordsAPI.createEntry(payload);
        notifySuccess('Запись создана.', { source: 'passwords', dedupeMode: 'none' });
      }
      setEntryDialogOpen(false);
      await loadEntries();
      await loadAudit();
    } catch (error) {
      notifyApiError(error, 'Не удалось сохранить запись.', { dedupeMode: 'none' });
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (entry) => {
    if (!window.confirm(`Архивировать пароль для ${entry.login}?`)) return;
    setSaving(true);
    try {
      await passwordsAPI.archiveEntry(entry.id);
      notifySuccess('Запись перенесена в архив.', { source: 'passwords', dedupeMode: 'none' });
      await loadEntries();
      await loadAudit();
    } catch (error) {
      notifyApiError(error, 'Не удалось архивировать запись.', { dedupeMode: 'none' });
    } finally {
      setSaving(false);
    }
  };

  const hidePassword = (entryId) => {
    window.clearTimeout(hideTimersRef.current[entryId]);
    delete hideTimersRef.current[entryId];
    setRevealedPasswords((prev) => {
      const next = { ...prev };
      delete next[entryId];
      return next;
    });
  };

  const scheduleHide = (entryId) => {
    window.clearTimeout(hideTimersRef.current[entryId]);
    hideTimersRef.current[entryId] = window.setTimeout(() => hidePassword(entryId), PASSWORD_HIDE_MS);
  };

  const copyPassword = async (value) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      notifyWarning('Буфер обмена недоступен в этом браузере.', { source: 'passwords', dedupeMode: 'none' });
      return false;
    }
    await navigator.clipboard.writeText(value);
    return true;
  };

  const revealEntry = async (entry, purpose) => {
    setRevealBusyId(`${entry.id}:${purpose}`);
    try {
      const payload = await passwordsAPI.revealEntry(entry.id, { purpose });
      setUnlockedUntil(payload?.unlocked_until || unlockedUntil);
      if (purpose === 'copy') {
        const copied = await copyPassword(payload.password || '');
        if (copied) {
          notifySuccess('Пароль скопирован.', { source: 'passwords', dedupeMode: 'none', durationMs: 1800 });
        }
      } else {
        setRevealedPasswords((prev) => ({ ...prev, [entry.id]: payload.password || '' }));
        scheduleHide(entry.id);
      }
      await loadAudit();
    } catch (error) {
      notifyApiError(error, 'Не удалось раскрыть пароль.', { dedupeMode: 'none' });
    } finally {
      setRevealBusyId('');
    }
  };

  const requestReveal = (entry, purpose) => {
    if (!isUnlocked) {
      setPendingReveal({ entry, purpose });
      setUnlockCode('');
      setUnlockDialogOpen(true);
      return;
    }
    revealEntry(entry, purpose);
  };

  const handleUnlock = async () => {
    const code = unlockCode.trim();
    if (!code) return;
    setUnlocking(true);
    try {
      const payload = /^\d+$/.test(code) ? { totp_code: code } : { backup_code: code };
      const result = await passwordsAPI.unlock(payload);
      setUnlockedUntil(result?.unlocked_until || null);
      setUnlockDialogOpen(false);
      notifySuccess('Доступ к раскрытию паролей открыт на 5 минут.', { source: 'passwords', dedupeMode: 'none' });
      const nextReveal = pendingReveal;
      setPendingReveal(null);
      await loadEntries();
      await loadAudit();
      if (nextReveal?.entry) {
        await revealEntry(nextReveal.entry, nextReveal.purpose);
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось подтвердить 2FA.', { dedupeMode: 'none' });
    } finally {
      setUnlocking(false);
    }
  };

  const handleGenerate = () => {
    try {
      const password = generateVaultPassword(generatorOptions);
      setGeneratedPassword(password);
    } catch (error) {
      notifyWarning(error?.message || 'Не удалось сгенерировать пароль.', { source: 'passwords', dedupeMode: 'none' });
    }
  };

  const insertGeneratedPassword = () => {
    if (!generatedPassword) return;
    setForm((prev) => ({ ...prev, password: generatedPassword }));
  };

  const copyGeneratedPassword = async () => {
    if (!generatedPassword) return;
    try {
      const copied = await copyPassword(generatedPassword);
      if (copied) notifySuccess('Сгенерированный пароль скопирован.', { source: 'passwords', dedupeMode: 'none' });
    } catch (error) {
      notifyWarning('Не удалось скопировать сгенерированный пароль.', { source: 'passwords', dedupeMode: 'none' });
    }
  };

  const formIsValid = normalizeText(form.group) && normalizeText(form.login) && (formMode === 'edit' || form.password);

  return (
    <MainLayout>
      <PageShell fullHeight sx={{ gap: 2.5 }} data-testid="passwords-page">
        <Paper
          elevation={0}
          sx={{
            p: { xs: 2, md: 2.5 },
            borderRadius: 2,
            border: `1px solid ${alpha(theme.palette.divider, 0.9)}`,
            bgcolor: 'background.paper',
          }}
        >
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} justifyContent="space-between">
            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <KeyOutlinedIcon color="primary" />
                <Typography variant="h5" fontWeight={800}>Пароли</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Хранилище доступов с 2FA-разблокировкой перед раскрытием.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Chip
                color={isUnlocked ? (isUnlockExpiringSoon ? 'warning' : 'success') : 'default'}
                icon={<LockOpenOutlinedIcon />}
                label={isUnlocked
                  ? `${isUnlockExpiringSoon ? 'Истекает' : 'Разблокировано'} (${unlockedRemainingLabel || formatDateTime(unlockedUntil)})`
                  : 'Раскрытие заблокировано'}
                variant={isUnlocked ? 'filled' : 'outlined'}
              />
              <Button
                variant="outlined"
                startIcon={<LockOpenOutlinedIcon />}
                onClick={() => setUnlockDialogOpen(true)}
              >
                Разблокировка 2FA
              </Button>
              {canWrite ? (
                <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={openCreateDialog}>
                  Новая запись
                </Button>
              ) : null}
            </Stack>
          </Stack>
        </Paper>

        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <Paper elevation={0} sx={{ borderRadius: 2, border: `1px solid ${theme.palette.divider}`, overflow: 'hidden' }}>
              <Box sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight={800}>Группы</Typography>
              </Box>
              <Divider />
              <List dense disablePadding>
                <ListItemButton selected={!selectedGroup} onClick={() => setSelectedGroup('')}>
                  <ListItemText primary="Все группы" />
                </ListItemButton>
                {groups.map((group) => (
                  <ListItemButton
                    key={group}
                    selected={selectedGroup === group}
                    onClick={() => setSelectedGroup(group)}
                    data-testid={`password-group-${group}`}
                  >
                    <ListItemText primary={group} />
                  </ListItemButton>
                ))}
              </List>
              <Divider />
              <Box sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>Теги</Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Chip
                    size="small"
                    label="Все"
                    color={!selectedTag ? 'primary' : 'default'}
                    variant={!selectedTag ? 'filled' : 'outlined'}
                    onClick={() => setSelectedTag('')}
                  />
                  {tags.map((tag) => (
                    <Chip
                      key={tag}
                      size="small"
                      label={tag}
                      color={selectedTag === tag ? 'primary' : 'default'}
                      variant={selectedTag === tag ? 'filled' : 'outlined'}
                      onClick={() => setSelectedTag(tag)}
                      data-testid={`password-tag-${tag}`}
                    />
                  ))}
                </Stack>
              </Box>
            </Paper>
          </Grid>

          <Grid item xs={12} md={9}>
            <Paper elevation={0} sx={{ borderRadius: 2, border: `1px solid ${theme.palette.divider}`, p: 2 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Поиск по логину"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchOutlinedIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                  inputProps={{ 'data-testid': 'password-search-input' }}
                />
                <FormControlLabel
                  control={<Switch checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />}
                  label="Архив"
                  sx={{ flexShrink: 0 }}
                />
                <Tooltip title="Обновить">
                  <span>
                    <IconButton onClick={loadEntries} disabled={loading} aria-label="Обновить пароли">
                      <RefreshOutlinedIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>

              {loading ? (
                <Grid container spacing={1.5}>
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Grid item xs={12} lg={6} key={`password-skeleton-${index}`}>
                      <Paper elevation={0} sx={{ p: 2, minHeight: 210, borderRadius: 2, border: `1px solid ${theme.palette.divider}` }}>
                        <Stack spacing={1.25}>
                          <Skeleton variant="text" width="35%" />
                          <Skeleton variant="text" width="65%" height={34} />
                          <Stack direction="row" spacing={0.75}>
                            <Skeleton variant="rounded" width={70} height={24} />
                            <Skeleton variant="rounded" width={90} height={24} />
                          </Stack>
                          <Skeleton variant="rounded" height={36} />
                          <Skeleton variant="rounded" height={40} />
                          <Stack direction="row" justifyContent="space-between">
                            <Skeleton variant="text" width={120} />
                            <Stack direction="row" spacing={0.75}>
                              <Skeleton variant="circular" width={28} height={28} />
                              <Skeleton variant="circular" width={28} height={28} />
                              <Skeleton variant="circular" width={28} height={28} />
                            </Stack>
                          </Stack>
                        </Stack>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              ) : visibleEntries.length === 0 ? (
                <Alert severity="info">Записей по текущим фильтрам нет.</Alert>
              ) : (
                <Grid container spacing={1.5}>
                  {visibleEntries.map((entry) => {
                    const revealed = revealedPasswords[entry.id];
                    return (
                      <Grid item xs={12} lg={6} key={entry.id}>
                        <Paper
                          elevation={0}
                          sx={{
                            p: 2,
                            minHeight: 210,
                            borderRadius: 2,
                            border: `1px solid ${entry.is_archived ? alpha(theme.palette.warning.main, 0.4) : theme.palette.divider}`,
                            bgcolor: entry.is_archived
                              ? alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.12 : 0.08)
                              : ui.panelSolid,
                          }}
                        >
                          <Stack spacing={1.25}>
                            <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
                              <Box sx={{ minWidth: 0 }}>
                                <Typography
                                  variant="overline"
                                  sx={{ color: 'text.secondary', letterSpacing: '0.08em' }}
                                >
                                  {entry.group || 'Без группы'}
                                </Typography>
                                <Typography variant="h6" fontWeight={800} noWrap title={entry.login}>{entry.login}</Typography>
                              </Box>
                              {entry.is_archived ? <Chip size="small" color="warning" label="Архив" /> : null}
                            </Stack>
                            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                              {entry.tags.length ? entry.tags.map((tag) => (
                                <Chip
                                  key={tag}
                                  size="small"
                                  label={tag}
                                  variant="outlined"
                                  sx={{ color: 'text.primary', bgcolor: ui.panelSolid }}
                                />
                              )) : (
                                <Chip
                                  size="small"
                                  label="без тегов"
                                  variant="outlined"
                                  sx={{ color: 'text.secondary', bgcolor: ui.panelSolid }}
                                />
                              )}
                            </Stack>
                            <Typography variant="body2" color="text.secondary" sx={{ minHeight: 40 }}>
                              {entry.description || 'Описание не заполнено.'}
                            </Typography>
                            <Box
                              sx={getOfficeCodeBlockSx(ui, {
                                fontWeight: revealed ? 600 : 500,
                                color: revealed ? 'text.primary' : 'text.secondary',
                              })}
                              data-testid={`password-value-${entry.id}`}
                            >
                              {revealed || '••••••••••••••••'}
                            </Box>
                            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                              <Typography variant="caption" color="text.secondary">
                                Обновлено: {formatDateTime(entry.updated_at)}
                              </Typography>
                              <Stack direction="row" spacing={0.5}>
                                {revealed ? (
                                  <Tooltip title="Скрыть">
                                    <IconButton size="small" onClick={() => hidePassword(entry.id)} aria-label={`Скрыть пароль ${entry.login}`}>
                                      <VisibilityOffOutlinedIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                ) : (
                                  <Tooltip title="Показать">
                                    <span>
                                      <IconButton
                                        size="small"
                                        onClick={() => requestReveal(entry, 'show')}
                                        disabled={revealBusyId === `${entry.id}:show`}
                                        aria-label={`Показать пароль ${entry.login}`}
                                      >
                                        <VisibilityOutlinedIcon fontSize="small" />
                                      </IconButton>
                                    </span>
                                  </Tooltip>
                                )}
                                <Tooltip title="Скопировать">
                                  <span>
                                    <IconButton
                                      size="small"
                                      onClick={() => requestReveal(entry, 'copy')}
                                      disabled={revealBusyId === `${entry.id}:copy`}
                                      aria-label={`Скопировать пароль ${entry.login}`}
                                    >
                                      <ContentCopyOutlinedIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                                {canWrite && !entry.is_archived ? (
                                  <Tooltip title="Ещё действия">
                                    <IconButton
                                      size="small"
                                      aria-label={`Дополнительно ${entry.login}`}
                                      onClick={(event) => {
                                        setRowMenuAnchor(event.currentTarget);
                                        setRowMenuEntry(entry);
                                      }}
                                    >
                                      <MoreVertOutlinedIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                ) : null}
                              </Stack>
                            </Stack>
                          </Stack>
                        </Paper>
                      </Grid>
                    );
                  })}
                </Grid>
              )}
            </Paper>

            {isAdmin ? (
              <Paper elevation={0} sx={{ borderRadius: 2, border: `1px solid ${theme.palette.divider}`, p: 2, mt: 2 }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
                  <Typography variant="h6" fontWeight={800}>Аудит</Typography>
                  <Button size="small" startIcon={<RefreshOutlinedIcon />} onClick={loadAudit}>Обновить</Button>
                </Stack>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Время</TableCell>
                      <TableCell>Действие</TableCell>
                      <TableCell>Пользователь</TableCell>
                      <TableCell>Запись</TableCell>
                      <TableCell>IP</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {auditItems.slice(0, 12).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{formatDateTime(item.created_at)}</TableCell>
                        <TableCell>{item.action}</TableCell>
                        <TableCell>{item.actor_username || item.actor_user_id}</TableCell>
                        <TableCell>{[item.entry_group, item.entry_login].filter(Boolean).join(' / ') || '—'}</TableCell>
                        <TableCell>{item.ip_address || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            ) : null}
          </Grid>
        </Grid>
      </PageShell>

      <Dialog open={entryDialogOpen} onClose={() => setEntryDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{formMode === 'edit' ? 'Редактировать запись' : 'Новая запись'}</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12} md={7}>
              <Stack spacing={2} sx={{ pt: 0.5 }}>
                <FormControl fullWidth required>
                  <InputLabel id="password-group-label">Группа</InputLabel>
                  <Select
                    labelId="password-group-label"
                    label="Группа"
                    value={form.group}
                    onChange={(event) => setForm((prev) => ({ ...prev, group: String(event.target.value || '') }))}
                    data-testid="password-form-group-select"
                  >
                    {groups.map((group) => (
                      <MenuItem key={group} value={group}>{group}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {!groups.length ? (
                  <Alert severity="warning">
                    Нет доступных групп. Попросите администратора добавить группы в Настройках.
                    <Box sx={{ mt: 1 }}>
                      <Button size="small" variant="outlined" onClick={() => navigate('/settings?tab=env#password-groups-settings')}>
                        Открыть Настройки
                      </Button>
                    </Box>
                  </Alert>
                ) : null}
                <TextField
                  label="Логин"
                  value={form.login}
                  onChange={(event) => setForm((prev) => ({ ...prev, login: event.target.value }))}
                  required
                  fullWidth
                  inputProps={{ 'data-testid': 'password-form-login' }}
                />
                <Autocomplete
                  multiple
                  freeSolo
                  options={tags}
                  value={form.tags}
                  filterSelectedOptions
                  onChange={(_, nextValue) => {
                    setForm((prev) => ({ ...prev, tags: normalizeTagList(nextValue) }));
                  }}
                  isOptionEqualToValue={(option, value) => (
                    String(option).toLowerCase() === String(value).toLowerCase()
                  )}
                  getOptionLabel={(option) => String(option)}
                  noOptionsText={tags.length ? 'Нет подходящих тегов' : 'Сначала создайте записи с тегами'}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Теги"
                      placeholder={tags.length ? 'Выберите из списка или введите новый' : 'Введите тег'}
                      helperText="До 20 тегов. Можно выбрать существующий или добавить новый."
                      inputProps={{
                        ...params.inputProps,
                        'data-testid': 'password-form-tags',
                      }}
                    />
                  )}
                />
                <TextField
                  label={formMode === 'edit' ? 'Новый пароль' : 'Пароль'}
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                  required={formMode !== 'edit'}
                  helperText={formMode === 'edit' ? 'Оставьте пустым, чтобы не менять пароль.' : ''}
                  inputProps={{ 'data-testid': 'password-form-password' }}
                  fullWidth
                />
                <TextField
                  label="Описание"
                  value={form.description}
                  onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                  multiline
                  minRows={4}
                  fullWidth
                />
              </Stack>
            </Grid>
            <Grid item xs={12} md={5}>
              <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: `1px solid ${theme.palette.divider}` }}>
                <Typography variant="subtitle1" fontWeight={800}>Генератор</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Генерация выполняется в браузере через Web Crypto.
                </Typography>
                <Typography variant="caption" color="text.secondary">Длина: {generatorOptions.length}</Typography>
                <Slider
                  min={12}
                  max={64}
                  value={generatorOptions.length}
                  onChange={(_, value) => setGeneratorOptions((prev) => ({ ...prev, length: Number(value) }))}
                />
                <Grid container spacing={0.5}>
                  {[
                    ['lower', 'a-z'],
                    ['upper', 'A-Z'],
                    ['digits', '0-9'],
                    ['symbols', '#$%'],
                    ['excludeSimilar', 'без похожих'],
                  ].map(([key, label]) => (
                    <Grid item xs={6} key={key}>
                      <FormControlLabel
                        control={<Switch size="small" checked={Boolean(generatorOptions[key])} onChange={(event) => setGeneratorOptions((prev) => ({ ...prev, [key]: event.target.checked }))} />}
                        label={label}
                      />
                    </Grid>
                  ))}
                </Grid>
                <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                  <Button variant="outlined" onClick={handleGenerate}>Сгенерировать</Button>
                  <Button onClick={insertGeneratedPassword} disabled={!generatedPassword}>Вставить</Button>
                  <IconButton onClick={copyGeneratedPassword} disabled={!generatedPassword} aria-label="Скопировать сгенерированный пароль">
                    <ContentCopyOutlinedIcon />
                  </IconButton>
                </Stack>
                <Box
                  sx={getOfficeCodeBlockSx(ui, {
                    mt: 1.5,
                    minHeight: 42,
                    color: generatedPassword ? 'text.primary' : 'text.secondary',
                    fontWeight: generatedPassword ? 600 : 400,
                  })}
                  data-testid="generated-password"
                >
                  {generatedPassword || '—'}
                </Box>
              </Paper>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEntryDialogOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleSaveEntry} disabled={!formIsValid || saving || !groups.length}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={unlockDialogOpen} onClose={() => setUnlockDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Разблокировка 2FA</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Alert severity="info">
              Введите TOTP-код или резервный код. После подтверждения раскрытие и копирование будут доступны 5 минут.
            </Alert>
            <TextField
              label="Код 2FA"
              value={unlockCode}
              onChange={(event) => setUnlockCode(event.target.value)}
              autoFocus
              fullWidth
              inputProps={{ 'data-testid': 'password-unlock-code' }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleUnlock();
                }
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUnlockDialogOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleUnlock} disabled={!unlockCode.trim() || unlocking}>
            {unlocking ? 'Проверка...' : 'Разблокировать'}
          </Button>
        </DialogActions>
      </Dialog>
      <Menu
        anchorEl={rowMenuAnchor}
        open={Boolean(rowMenuAnchor)}
        onClose={() => {
          setRowMenuAnchor(null);
          setRowMenuEntry(null);
        }}
      >
        <MenuItem
          onClick={() => {
            if (rowMenuEntry) openEditDialog(rowMenuEntry);
            setRowMenuAnchor(null);
            setRowMenuEntry(null);
          }}
        >
          <EditOutlinedIcon fontSize="small" sx={{ mr: 1 }} />
          Редактировать
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (rowMenuEntry) handleArchive(rowMenuEntry);
            setRowMenuAnchor(null);
            setRowMenuEntry(null);
          }}
        >
          <ArchiveOutlinedIcon fontSize="small" sx={{ mr: 1 }} />
          Архивировать
        </MenuItem>
      </Menu>
    </MainLayout>
  );
}

export default Passwords;
