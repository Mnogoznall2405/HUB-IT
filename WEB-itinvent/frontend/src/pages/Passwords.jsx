import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildOfficeUiTokens, getOfficeCodeBlockSx } from '../theme/officeUiTokens';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import { useNavigate } from 'react-router-dom';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import PasswordAuditAccordion from '../components/passwords/PasswordAuditAccordion';
import PasswordEntryDetail from '../components/passwords/PasswordEntryDetail';
import PasswordEntryList from '../components/passwords/PasswordEntryList';
import PasswordEntryMobileSheet from '../components/passwords/PasswordEntryMobileSheet';
import PasswordFiltersPanel from '../components/passwords/PasswordFiltersPanel';
import PasswordMobileToolbar from '../components/passwords/PasswordMobileToolbar';
import PasswordUnlockBanner from '../components/passwords/PasswordUnlockBanner';
import PasswordUnlockDialog from '../components/passwords/PasswordUnlockDialog';
import PasswordUnlockStrip from '../components/passwords/PasswordUnlockStrip';
import {
  PASSWORD_HIDE_MS,
  buildGroupCounts,
  isUnlockedUntilActive,
  normalizeEntry,
  normalizeText,
} from '../components/passwords/passwordVaultUtils';
import { passwordsAPI } from '../api/passwords';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
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
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false);
  const [auditExpanded, setAuditExpanded] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const hideTimersRef = useRef({});
  const searchInputRef = useRef(null);

  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const canWrite = isAdmin || hasPermission('passwords.write');
  const isUnlocked = isUnlockedUntilActive(unlockedUntil);
  const unlockedRemainingMs = useMemo(() => {
    const parsed = new Date(unlockedUntil || '');
    if (Number.isNaN(parsed.getTime())) return 0;
    return Math.max(0, parsed.getTime() - nowTs);
  }, [nowTs, unlockedUntil]);

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
    setAuditLoading(true);
    try {
      const payload = await passwordsAPI.getAudit({ limit: 100 });
      setAuditItems(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить аудит паролей.', { dedupeMode: 'recent' });
    } finally {
      setAuditLoading(false);
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
    if (auditExpanded) {
      loadAudit();
    }
  }, [auditExpanded, loadAudit]);

  useEffect(() => {
    if (!entries.length) {
      setSelectedEntryId('');
      return;
    }
    if (!entries.some((entry) => entry.id === selectedEntryId)) {
      setSelectedEntryId(entries[0].id);
    }
  }, [entries, selectedEntryId]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const tagName = String(event.target?.tagName || '').toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || event.target?.isContentEditable) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const visibleEntries = useMemo(() => entries, [entries]);
  const groupCounts = useMemo(() => buildGroupCounts(entries), [entries]);
  const selectedEntry = useMemo(
    () => visibleEntries.find((entry) => entry.id === selectedEntryId) || null,
    [selectedEntryId, visibleEntries],
  );
  const selectedRevealBusy = Boolean(
    selectedEntry && revealBusyId.startsWith(`${selectedEntry.id}:`),
  );

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

  const handleCopyLogin = async (entry) => {
    try {
      const copied = await copyPassword(entry.login);
      if (copied) {
        notifySuccess('Логин скопирован.', { source: 'passwords', dedupeMode: 'none', durationMs: 1800 });
      }
    } catch {
      notifyWarning('Не удалось скопировать логин.', { source: 'passwords', dedupeMode: 'none' });
    }
  };

  const handleSelectEntry = (entry) => {
    setSelectedEntryId(entry.id);
    if (isMobile) {
      setMobileSheetOpen(true);
    }
  };

  const handleOpenUnlock = () => {
    setUnlockCode('');
    setUnlockDialogOpen(true);
  };

  const handleEditEntry = (entry) => {
    setMobileSheetOpen(false);
    openEditDialog(entry);
  };

  const handleArchiveEntry = async (entry) => {
    setMobileSheetOpen(false);
    await handleArchive(entry);
    if (selectedEntryId === entry.id) {
      setSelectedEntryId('');
    }
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
      <PageShell fullHeight sx={{ gap: { xs: 0.75, md: 2.5 } }} data-testid="passwords-page">
        {isMobile ? (
          <>
            <PasswordMobileToolbar
              canWrite={canWrite}
              loading={loading}
              query={query}
              searchInputRef={searchInputRef}
              onQueryChange={(event) => setQuery(event.target.value)}
              onUnlockClick={handleOpenUnlock}
              onOpenFilters={() => setFiltersDrawerOpen(true)}
              onRefresh={loadEntries}
              onCreate={openCreateDialog}
            />
            <PasswordUnlockStrip
              isUnlocked={isUnlocked}
              isUnlockExpiringSoon={isUnlockExpiringSoon}
              unlockedRemainingMs={unlockedRemainingMs}
              onUnlockClick={handleOpenUnlock}
            />
          </>
        ) : (
          <>
            <Paper
              elevation={0}
              sx={{
                flexShrink: 0,
                p: 2.5,
                border: `1px solid ${alpha(theme.palette.divider, 0.9)}`,
                bgcolor: 'background.paper',
              }}
            >
              <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <KeyOutlinedIcon color="primary" />
                    <Typography variant="h5" fontWeight={800}>Пароли</Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Хранилище доступов с 2FA-разблокировкой перед раскрытием.
                  </Typography>
                </Box>
                {canWrite ? (
                  <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={openCreateDialog}>
                    Новая запись
                  </Button>
                ) : null}
              </Stack>
            </Paper>

            <PasswordUnlockBanner
              isUnlocked={isUnlocked}
              isUnlockExpiringSoon={isUnlockExpiringSoon}
              unlockedRemainingMs={unlockedRemainingMs}
              unlockedUntil={unlockedUntil}
              onUnlockClick={handleOpenUnlock}
            />

            <Paper
              elevation={0}
              sx={{
                flexShrink: 0,
                border: `1px solid ${theme.palette.divider}`,
                p: 2,
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center">
                <TextField
                  fullWidth
                  size="small"
                  label="Поиск по логину, описанию или тегам"
                  placeholder="Нажмите / для фокуса"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  inputRef={searchInputRef}
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
            </Paper>
          </>
        )}

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: { xs: 0.5, md: 2 },
          }}
        >
          <Grid
            container
            spacing={{ xs: 0, md: 2 }}
            sx={{
              flex: 1,
              minHeight: 0,
              height: '100%',
            }}
          >
            {!isMobile ? (
              <Grid
                item
                md={3}
                sx={{
                  display: { xs: 'none', md: 'flex' },
                  flexDirection: 'column',
                  minHeight: 0,
                  height: '100%',
                }}
              >
                <Paper
                  elevation={0}
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    border: `1px solid ${theme.palette.divider}`,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    WebkitOverflowScrolling: 'touch',
                  }}
                  data-testid="password-filters-scroll"
                >
                  <PasswordFiltersPanel
                    groups={groups}
                    tags={tags}
                    groupCounts={groupCounts}
                    selectedGroup={selectedGroup}
                    selectedTag={selectedTag}
                    totalCount={visibleEntries.length}
                    onSelectGroup={setSelectedGroup}
                    onSelectTag={setSelectedTag}
                  />
                </Paper>
              </Grid>
            ) : null}

            <Grid
              item
              xs={12}
              md={4}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                height: '100%',
              }}
            >
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  WebkitOverflowScrolling: 'touch',
                  pr: 0.5,
                }}
                data-testid="password-entry-list-scroll"
              >
                <PasswordEntryList
                  entries={visibleEntries}
                  selectedEntryId={selectedEntryId}
                  loading={loading}
                  compact={isMobile}
                  onSelect={handleSelectEntry}
                />
              </Box>
            </Grid>

            {!isMobile ? (
              <Grid
                item
                md={5}
                sx={{
                  display: { xs: 'none', md: 'flex' },
                  flexDirection: 'column',
                  minHeight: 0,
                  height: '100%',
                }}
              >
                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    WebkitOverflowScrolling: 'touch',
                  }}
                  data-testid="password-entry-detail-scroll"
                >
                  <PasswordEntryDetail
                    entry={selectedEntry}
                    revealed={selectedEntry ? revealedPasswords[selectedEntry.id] : ''}
                    revealBusy={selectedRevealBusy}
                    canWrite={canWrite && selectedEntry && !selectedEntry.is_archived}
                    onCopyPassword={(entry) => requestReveal(entry, 'copy')}
                    onCopyLogin={handleCopyLogin}
                    onShow={(entry) => requestReveal(entry, 'show')}
                    onHide={(entry) => hidePassword(entry.id)}
                    onEdit={handleEditEntry}
                    onArchive={handleArchiveEntry}
                  />
                </Box>
              </Grid>
            ) : null}
          </Grid>

          {isAdmin && !isMobile ? (
            <Box sx={{ flexShrink: 0 }}>
              <PasswordAuditAccordion
                expanded={auditExpanded}
                onExpandedChange={setAuditExpanded}
                loading={auditLoading}
                items={auditItems.slice(0, 12)}
              />
            </Box>
          ) : null}
        </Box>
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
              <Paper elevation={0} sx={{ p: 2, border: `1px solid ${theme.palette.divider}` }}>
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

      <PasswordUnlockDialog
        open={unlockDialogOpen}
        isMobile={isMobile}
        unlockCode={unlockCode}
        unlocking={unlocking}
        onClose={() => setUnlockDialogOpen(false)}
        onCodeChange={(event) => setUnlockCode(event.target.value)}
        onSubmit={handleUnlock}
      />
      <Drawer
        anchor="left"
        open={filtersDrawerOpen}
        onClose={() => setFiltersDrawerOpen(false)}
        PaperProps={{ sx: { width: 300, maxWidth: '90vw' } }}
        data-testid="password-filters-drawer"
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="subtitle1" fontWeight={800}>Фильтры</Typography>
              <IconButton size="small" onClick={loadEntries} disabled={loading} aria-label="Обновить пароли">
                <RefreshOutlinedIcon fontSize="small" />
              </IconButton>
            </Stack>
            <FormControlLabel
              control={(
                <Switch
                  size="small"
                  checked={includeArchived}
                  onChange={(event) => setIncludeArchived(event.target.checked)}
                />
              )}
              label="Показывать архив"
              sx={{ mt: 0.5, ml: 0 }}
            />
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto' }}>
            <PasswordFiltersPanel
              groups={groups}
              tags={tags}
              groupCounts={groupCounts}
              selectedGroup={selectedGroup}
              selectedTag={selectedTag}
              totalCount={visibleEntries.length}
              onSelectGroup={(group) => {
                setSelectedGroup(group);
              }}
              onSelectTag={(tag) => {
                setSelectedTag(tag);
              }}
            />
          </Box>
          {isAdmin && isMobile ? (
            <Box sx={{ flexShrink: 0, p: 1.5, borderTop: `1px solid ${theme.palette.divider}` }}>
              <PasswordAuditAccordion
                expanded={auditExpanded}
                onExpandedChange={setAuditExpanded}
                loading={auditLoading}
                items={auditItems.slice(0, 12)}
              />
            </Box>
          ) : null}
        </Box>
      </Drawer>

      <PasswordEntryMobileSheet
        open={mobileSheetOpen && Boolean(selectedEntry)}
        entry={selectedEntry}
        revealed={selectedEntry ? revealedPasswords[selectedEntry.id] : ''}
        revealBusy={selectedRevealBusy}
        canWrite={canWrite && selectedEntry && !selectedEntry.is_archived}
        onClose={() => setMobileSheetOpen(false)}
        onCopyPassword={(entry) => requestReveal(entry, 'copy')}
        onCopyLogin={handleCopyLogin}
        onShow={(entry) => requestReveal(entry, 'show')}
        onHide={(entry) => hidePassword(entry.id)}
        onEdit={handleEditEntry}
        onArchive={handleArchiveEntry}
      />
    </MainLayout>
  );
}

export default Passwords;
