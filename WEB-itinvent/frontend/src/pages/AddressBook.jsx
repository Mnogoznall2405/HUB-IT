import useRequestGuard from '../lib/useRequestGuard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  InputAdornment,
  Paper,
  Popover,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate } from 'react-router-dom';
import AddressBookEntryDetail from '../components/addressBook/AddressBookEntryDetail';
import AddressBookEntryDrawer from '../components/addressBook/AddressBookEntryDrawer';
import AddressBookEntryList from '../components/addressBook/AddressBookEntryList';
import AddressBookEntrySheet from '../components/addressBook/AddressBookEntrySheet';
import AddressBookListModes from '../components/addressBook/AddressBookListModes';
import AddressBookFilters from '../components/addressBook/AddressBookFilters';
import AddressBookMobileToolbar from '../components/addressBook/AddressBookMobileToolbar';
import {
  addressBookScrollbarSx,
  dedupeNamedOptions,
  formatDateTime,
  getEntryIdentity,
  getEntryKey,
  normalizeText,
} from '../components/addressBook/addressBookUtils';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { isValidEmailRecipient } from '../components/mail/mailComposeState';
import { copyTextToClipboard } from '../lib/clipboard';
import { addressBookAPI } from '../api/addressBook';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { openAddressBookChat } from '../lib/addressBookChat';
import { CHAT_FEATURE_ENABLED } from '../lib/chatFeature';
import { isPhoneDeepLinkReady, openTelegramChat } from '../lib/messengerLinks';
import {
  clearRecentEmployees,
  getFavoriteEmployeeCodes,
  getRecentEmployeeCodes,
  pushRecentEmployee,
  toggleFavoriteEmployee,
} from '../lib/addressBookFavorites';
import { downloadVCard } from '../lib/vcard';
import { buildOfficeUiTokens, getOfficePanelSx } from '../theme/officeUiTokens';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 50;

function AddressBookDetailEmptyState({
  query,
  dismissed,
  error,
  loading,
  isAdmin,
  onClearQuery,
  onSync,
}) {
  if (loading) {
    return (
      <Box
        sx={{ minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}
        data-testid="address-book-detail-loading"
      >
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">Загружаем адресную книгу…</Typography>
      </Box>
    );
  }
  const message = error
    ? 'Детали появятся после повторной загрузки списка.'
    : query.trim()
      ? `Нет совпадений по запросу «${query.trim()}». Попробуйте изменить поиск.`
      : dismissed
        ? 'Список уволенных пуст. Попробуйте изменить поиск.'
        : 'Список пуст. Попробуйте обновить адресную книгу.';

  return (
    <Box
      sx={{
        minHeight: 180,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        p: 3,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        textAlign: 'center',
      }}
      data-testid="address-book-detail-empty-state"
    >
      <Typography variant="body2" color="text.secondary">{message}</Typography>
      {query.trim() ? (
        <Button size="small" variant="outlined" onClick={onClearQuery}>
          Сбросить поиск
        </Button>
      ) : !error && isAdmin ? (
        <Button size="small" variant="outlined" onClick={onSync}>
          Обновить из 1С
        </Button>
      ) : null}
    </Box>
  );
}

const useDebouncedValue = (value, delayMs = SEARCH_DEBOUNCE_MS) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
};

const AddressBook = () => {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isWide = useMediaQuery(theme.breakpoints.up('lg'));
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const { notifySuccess, notifyWarning, notifyApiError } = useNotification();
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';
  const canComposeEmail = hasPermission('mail.access');
  const canUseChat = CHAT_FEATURE_ENABLED && hasPermission('chat.read') && hasPermission('chat.write');
  const canViewDismissed = hasPermission('address_book.dismissed.read');
  const searchInputRef = useRef(null);
  const pageShellRef = useRef(null);
  const selectedIdentityRef = useRef('');

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('active');
  const dismissed = tab === 'dismissed' && canViewDismissed;
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [filterOptions, setFilterOptions] = useState({ departments: [], cities: [] });
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [filtersDialogOpen, setFiltersDialogOpen] = useState(false);
  const filtersCacheRef = useRef({ active: null, dismissed: null });
  const userKey = String(user?.id || user?.username || 'anon');
  const [favoriteCodes, setFavoriteCodes] = useState(() => getFavoriteEmployeeCodes(userKey));
  const [recentCodes, setRecentCodes] = useState(() => getRecentEmployeeCodes(userKey));
  // P1–P3: favorites/recents are list modes, not a strip. The code set is
  // frozen on mode entry so clicks (e.g. pushRecentEmployee) never refetch.
  const [listMode, setListMode] = useState('all');
  const [modeCodes, setModeCodes] = useState([]);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedEntryKey, setSelectedEntryKey] = useState('');
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [tabletDrawerOpen, setTabletDrawerOpen] = useState(false);
  const [sheetItem, setSheetItem] = useState(null);
  const [maxHelpAnchorEl, setMaxHelpAnchorEl] = useState(null);
  const [maxHelpPhone, setMaxHelpPhone] = useState('');
  const [chatBusyEntryKey, setChatBusyEntryKey] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const debouncedQuery = useDebouncedValue(query);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      setStatus(await addressBookAPI.getStatus());
    } catch (err) {
      console.error('Failed to load address book status:', err);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  // C2: filters are part of the request-guard scope — a stale response can
  // never overwrite a newer filter/query/tab context.
  const beginSearch = useRequestGuard(
    `${debouncedQuery}\u0000${dismissed ? 1 : 0}\u0000${departmentFilter}\u0000${cityFilter}${listMode}${modeCodes.join(',')}`,
  );

  const loadItems = useCallback(async (
    nextQuery,
    isDismissed = false,
    nextOffset = 0,
    nextLimit = SEARCH_LIMIT,
    nextDepartment = '',
    nextCity = '',
  ) => {
    const append = nextOffset > 0;
    const isCurrent = beginSearch();
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await addressBookAPI.search({
        q: nextQuery,
        limit: nextLimit,
        offset: nextOffset,
        dismissed: isDismissed,
        // Optional filters are only sent when set — older call shape preserved.
        ...(nextDepartment ? { department: nextDepartment } : {}),
        ...(nextCity ? { city: nextCity } : {}),
        // T1: a list mode searches inside its frozen employee-code set.
        ...(listMode !== 'all' && modeCodes.length ? { employeeCodes: modeCodes } : {}),
      });
      if (!isCurrent()) return;
      let nextItems = Array.isArray(data?.items) ? data.items : [];
      // T1: "Недавние" без запроса — по давности открытия (порядок modeCodes).
      if (listMode === 'recent' && !String(nextQuery || '').trim()) {
        const order = new Map(modeCodes.map((code, index) => [code, index]));
        const rank = (entry) => {
          const position = order.get(normalizeText(entry?.employee_code));
          return position === undefined ? Number.MAX_SAFE_INTEGER : position;
        };
        nextItems = [...nextItems].sort((a, b) => rank(a) - rank(b));
      }
      setItems((prev) => (append ? [...prev, ...nextItems] : nextItems));
      setTotal(Number(data?.total || 0));
      setHasMore(Boolean(data?.has_more));
      const identity = selectedIdentityRef.current;
      const nextIndex = identity
        ? nextItems.findIndex((item) => getEntryIdentity(item) === identity)
        : -1;
      if (!append) {
        setSelectedEntryKey(nextIndex >= 0 ? getEntryKey(nextItems[nextIndex], nextIndex) : '');
      }
      setStatus((prev) => ({
        ...(prev || {}),
        updated_at: data?.updated_at || prev?.updated_at || '',
        last_error: data?.last_error || prev?.last_error || '',
        last_sync_failed: data?.last_sync_failed ?? prev?.last_sync_failed ?? false,
      }));
    } catch (err) {
      if (!isCurrent()) return;
      console.error('Failed to search address book:', err);
      setError({
        source: 'search',
        message: isDismissed ? 'Не удалось загрузить список уволенных.' : 'Не удалось загрузить адресную книгу.',
      });
    } finally {
      if (isCurrent()) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [beginSearch, listMode, modeCodes]);

  useEffect(() => {
    void loadItems(debouncedQuery, dismissed, 0, SEARCH_LIMIT, departmentFilter, cityFilter);
  }, [debouncedQuery, dismissed, departmentFilter, cityFilter, loadItems]);

  const handleLoadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    void loadItems(debouncedQuery, dismissed, items.length, SEARCH_LIMIT, departmentFilter, cityFilter);
  }, [cityFilter, debouncedQuery, departmentFilter, dismissed, hasMore, items.length, loadItems, loadingMore]);

  useEffect(() => {
    if (!canViewDismissed && tab === 'dismissed') {
      setTab('active');
    }
  }, [canViewDismissed, tab]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!isWide || items.length === 0) return;
    const keys = items.map((item, index) => getEntryKey(item, index));
    if (!keys.includes(selectedEntryKey)) {
      setSelectedEntryKey(keys[0]);
    }
  }, [isWide, items, selectedEntryKey]);

  useEffect(() => {
    if (isMobile) return;
    setMobileSheetOpen(false);
    setSheetItem(null);
  }, [isMobile]);

  const selectedItem = useMemo(() => {
    const index = items.findIndex((item, idx) => getEntryKey(item, idx) === selectedEntryKey);
    return index >= 0 ? items[index] : null;
  }, [items, selectedEntryKey]);

  useEffect(() => {
    selectedIdentityRef.current = selectedItem ? getEntryIdentity(selectedItem) : '';
  }, [selectedItem]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const nextStatus = await addressBookAPI.sync();
      setStatus(nextStatus);
      // Keep already loaded pages: refetch as many items as were shown (API caps limit at 200).
      const restoreLimit = Math.min(Math.max(items.length, SEARCH_LIMIT), 200);
      await loadItems(debouncedQuery, dismissed, 0, restoreLimit, departmentFilter, cityFilter);
    } catch (err) {
      console.error('Failed to sync address book:', err);
      setError({ source: 'sync', message: 'Не удалось обновить адресную книгу из 1С.' });
      await loadStatus();
    } finally {
      setSyncing(false);
    }
  }, [cityFilter, debouncedQuery, departmentFilter, dismissed, items.length, loadItems, loadStatus]);

  const handleRetrySearch = useCallback(() => {
    void loadItems(debouncedQuery, dismissed, 0, SEARCH_LIMIT, departmentFilter, cityFilter);
  }, [cityFilter, debouncedQuery, departmentFilter, dismissed, loadItems]);

  const handleClearQuery = useCallback(() => {
    setQuery('');
  }, []);

  // C2: filter options are loaded lazily (first open) and cached per tab.
  // R1: concurrent opens share one in-flight request; failures leave the cache
  // empty so the next open retries; a response arriving after a tab switch is
  // still cached but not applied to the now-foreign bucket.
  const dismissedRef = useRef(dismissed);
  dismissedRef.current = dismissed;
  const filtersInflightRef = useRef({ bucket: '', promise: null });

  const ensureFilterOptions = useCallback(() => {
    const bucket = dismissed ? 'dismissed' : 'active';
    const cached = filtersCacheRef.current[bucket];
    if (cached) {
      setFilterOptions(cached);
      return Promise.resolve();
    }
    const inflight = filtersInflightRef.current;
    if (inflight.bucket === bucket && inflight.promise) {
      return inflight.promise;
    }
    setFiltersLoading(true);
    const promise = (async () => {
      try {
        const data = await addressBookAPI.getFilters({ dismissed });
        const options = {
          departments: dedupeNamedOptions(data?.departments),
          cities: dedupeNamedOptions(data?.cities),
        };
        filtersCacheRef.current[bucket] = options;
        if (dismissedRef.current === dismissed) {
          setFilterOptions(options);
        }
      } catch (err) {
        // Filters are optional: on directory errors the page keeps working and
        // the next open retries the request.
        console.error('Failed to load address book filters:', err);
      } finally {
        // Only the request that still owns the inflight slot may clear the
        // spinner — a stale tab-scoped request must not hide a newer one.
        if (filtersInflightRef.current.promise === promise) {
          filtersInflightRef.current = { bucket: '', promise: null };
          setFiltersLoading(false);
        }
      }
    })();
    filtersInflightRef.current = { bucket, promise };
    return promise;
  }, [dismissed]);

  const handleDepartmentFilterChange = useCallback((value) => {
    setDepartmentFilter(value || '');
  }, []);

  const handleCityFilterChange = useCallback((value) => {
    setCityFilter(value || '');
  }, []);

  const handleClearFilters = useCallback(() => {
    setDepartmentFilter('');
    setCityFilter('');
  }, []);

  // C4: favorites/recents — employee codes only, per user.
  const handleToggleFavorite = useCallback((item) => {
    const code = normalizeText(item?.employee_code);
    if (!code) return;
    const { codes } = toggleFavoriteEmployee(userKey, code);
    setFavoriteCodes(codes);
  }, [userKey]);

  const handleClearRecent = useCallback(() => {
    setRecentCodes(clearRecentEmployees(userKey));
    setListMode('all');
    setModeCodes([]);
  }, [userKey]);

  // T1: entering a mode freezes its code set — pushRecentEmployee must not
  // re-request or reshuffle the visible "Недавние" list on the fly.
  const handleListModeChange = useCallback((nextMode) => {
    if (nextMode === 'favorites') {
      setModeCodes([...favoriteCodes]);
    } else if (nextMode === 'recent') {
      setModeCodes([...recentCodes]);
    } else {
      setModeCodes([]);
    }
    setListMode(nextMode);
  }, [favoriteCodes, recentCodes]);

  // T1: a mode whose code set became empty falls back to "Все" — its segment
  // is hidden, so the active mode must not stay selected.
  useEffect(() => {
    if (listMode === 'favorites' && favoriteCodes.length === 0) {
      setListMode('all');
      setModeCodes([]);
    } else if (listMode === 'recent' && recentCodes.length === 0) {
      setListMode('all');
      setModeCodes([]);
    }
  }, [favoriteCodes.length, listMode, recentCodes.length]);

  const handleSaveContact = useCallback((item) => {
    if (downloadVCard(item)) {
      notifySuccess('Контакт сохранён в файл .vcf', {
        source: 'address-book-vcard',
        dedupeMode: 'none',
        durationMs: 1800,
      });
    }
  }, [notifySuccess]);

  const handleCopy = useCallback(async (value) => {
    const text = normalizeText(value);
    if (!text) return;
    const isEmail = isValidEmailRecipient(text);
    try {
      await copyTextToClipboard(text);
      notifySuccess(isEmail ? 'E-mail скопирован' : 'Номер скопирован', {
        source: 'address-book-copy',
        dedupeMode: 'none',
        durationMs: 1800,
      });
    } catch {
      notifyWarning(isEmail ? 'Не удалось скопировать e-mail' : 'Не удалось скопировать номер', {
        source: 'address-book-copy',
        dedupeMode: 'none',
      });
    }
  }, [notifySuccess, notifyWarning]);

  const handleOpenTelegram = useCallback((phoneDigits) => {
    const opened = openTelegramChat(phoneDigits);
    if (!opened) {
      notifyWarning('Номер не подходит для Telegram', { source: 'address-book-telegram', dedupeMode: 'none' });
    }
  }, [notifyWarning]);

  const handleOpenMax = useCallback(async (phoneDigits, anchorEl) => {
    const digits = normalizeText(phoneDigits);
    if (!isPhoneDeepLinkReady(digits)) {
      notifyWarning('Номер не подходит для MAX', { source: 'address-book-max', dedupeMode: 'none' });
      return;
    }
    const formatted = `+${digits}`;
    try {
      await copyTextToClipboard(formatted);
      setMaxHelpPhone(formatted);
      setMaxHelpAnchorEl(anchorEl || null);
    } catch {
      notifyWarning('Не удалось скопировать номер', { source: 'address-book-max', dedupeMode: 'none' });
    }
  }, [notifyWarning]);

  const handleOpenChat = useCallback(async (item, index = 0) => {
    const entryKey = getEntryKey(item, index);
    setChatBusyEntryKey(entryKey);
    try {
      await openAddressBookChat({ entry: item, navigate });
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if (status === 404) {
        notifyWarning(
          error?.response?.data?.detail || 'Сотрудник не найден в HUB-чате. Возможно, у него нет учётной записи.',
          { source: 'address-book-chat', dedupeMode: 'none' },
        );
      } else {
        notifyApiError(error, 'Не удалось открыть корпоративный чат.', { dedupeMode: 'none' });
      }
    } finally {
      setChatBusyEntryKey('');
    }
  }, [navigate, notifyApiError, notifyWarning]);

  const handleComposeEmail = useCallback((email) => {
    const recipient = normalizeText(email);
    if (!isValidEmailRecipient(recipient)) {
      notifyWarning('Некорректный e-mail', { source: 'address-book-email', dedupeMode: 'none' });
      return;
    }
    navigate(`/mail?folder=inbox&compose_to=${encodeURIComponent(recipient)}`);
  }, [navigate, notifyWarning]);

  const handleSelectEntry = useCallback((item, index) => {
    const key = getEntryKey(item, index);
    selectedIdentityRef.current = getEntryIdentity(item);
    setSelectedEntryKey(key);
    const code = normalizeText(item?.employee_code);
    if (code && !dismissed) {
      setRecentCodes(pushRecentEmployee(userKey, code));
    }
    if (isMobile) {
      setSheetItem(item);
      setMobileSheetOpen(true);
    } else if (!isWide) {
      setTabletDrawerOpen(true);
    }
  }, [dismissed, isMobile, isWide, userKey]);

  const handleListSelect = useCallback((item, index) => {
    handleSelectEntry(item, index);
  }, [handleSelectEntry]);

  const filterCount = (departmentFilter ? 1 : 0) + (cityFilter ? 1 : 0);
  const hasActiveFilters = filterCount > 0;
  const selectedIsFavorite = Boolean(normalizeText(selectedItem?.employee_code))
    && favoriteCodes.includes(normalizeText(selectedItem?.employee_code));
  const sheetIsFavorite = Boolean(normalizeText(sheetItem?.employee_code))
    && favoriteCodes.includes(normalizeText(sheetItem?.employee_code));

  // C5: Esc in search clears the query; with an empty field it blurs.
  const handleSearchKeyDown = useCallback((event) => {
    if (event.key !== 'Escape') return;
    if (query) {
      event.stopPropagation();
      setQuery('');
    } else {
      event.currentTarget.blur();
    }
  }, [query]);

  // C5: '/' focuses search — unless typing, holding modifiers or inside a dialog.
  useEffect(() => {
    const handleGlobalKeyDown = (event) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (mobileSheetOpen || tabletDrawerOpen || filtersDialogOpen || maxHelpAnchorEl) return;
      const target = event.target;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [filtersDialogOpen, maxHelpAnchorEl, mobileSheetOpen, tabletDrawerOpen]);

  const panelSx = useMemo(() => getOfficePanelSx(ui), [ui]);
  const countLabel = total > items.length
    ? `Найдено ${total}, показано ${items.length}`
    : `Найдено ${total}`;
  const statusDate = dismissed ? (status?.dismissed_updated_at || status?.updated_at) : status?.updated_at;
  const searchError = error?.source === 'search' ? error.message : '';
  const showSearchErrorPanel = Boolean(searchError) && items.length === 0;
  const showErrorAlert = Boolean(error) && !showSearchErrorPanel;
  // T1: the mode row exists only on the "Сотрудники" tab and when at least
  // one saved code set is non-empty.
  const showModesRow = !dismissed && (favoriteCodes.length > 0 || recentCodes.length > 0);

  const handleTabChange = useCallback((event, nextValue) => {
    setTab(nextValue);
    selectedIdentityRef.current = '';
    setSelectedEntryKey('');
    setMobileSheetOpen(false);
    setSheetItem(null);
    setTabletDrawerOpen(false);
    // Filters belong to the tab context — reset them on tab switch.
    setDepartmentFilter('');
    setCityFilter('');
    setFiltersDialogOpen(false);
    // T1: list modes exist only on the "Сотрудники" tab.
    setListMode('all');
    setModeCodes([]);
  }, []);

  return (
    <MainLayout showDatabaseSelector={false}>
      <PageShell
        ref={pageShellRef}
        fullHeight
        sx={{ gap: { xs: 0.75, sm: 1 } }}
      >
        {isMobile ? (
          <>
            <AddressBookMobileToolbar
              total={total}
              shownCount={items.length}
              query={query}
              searchInputRef={searchInputRef}
              onQueryChange={(event) => setQuery(event.target.value)}
              onQueryKeyDown={handleSearchKeyDown}
              onClearQuery={handleClearQuery}
              filterCount={filterCount}
              onOpenFilters={() => {
                setFiltersDialogOpen(true);
                void ensureFilterOptions();
              }}
              isAdmin={isAdmin}
              syncing={syncing}
              statusUpdatedAt={statusDate}
              statusLoading={statusLoading}
              syncInProgress={syncing || Boolean(status?.sync_in_progress)}
              syncFailed={Boolean(status?.last_sync_failed)}
              syncError={status?.last_error || ''}
              onSync={handleSync}
            />
            {canViewDismissed ? (
              <Tabs
                value={tab}
                onChange={handleTabChange}
                variant="fullWidth"
                sx={{ flexShrink: 0, minHeight: 44 }}
                data-testid="address-book-tabs"
              >
                <Tab value="active" label="Сотрудники" data-testid="address-book-tab-active" sx={{ minHeight: 44 }} />
                <Tab value="dismissed" label="Уволенные" data-testid="address-book-tab-dismissed" sx={{ minHeight: 44 }} />
              </Tabs>
            ) : null}
            {hasActiveFilters ? (
              <Stack
                direction="row"
                spacing={0.75}
                useFlexGap
                flexWrap="wrap"
                alignItems="center"
                sx={{ flexShrink: 0 }}
                data-testid="address-book-active-filters"
              >
                {departmentFilter ? (
                  <Chip
                    size="small"
                    label={`Подразделение: ${departmentFilter}`}
                    title={`Подразделение: ${departmentFilter}`}
                    onDelete={() => setDepartmentFilter('')}
                    aria-label={`Убрать фильтр по подразделению ${departmentFilter}`}
                    sx={{ maxWidth: 320, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                  />
                ) : null}
                {cityFilter ? (
                  <Chip
                    size="small"
                    label={`Город: ${cityFilter}`}
                    title={`Город: ${cityFilter}`}
                    onDelete={() => setCityFilter('')}
                    aria-label={`Убрать фильтр по городу ${cityFilter}`}
                    sx={{ maxWidth: 320, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                  />
                ) : null}
                <Button
                  size="small"
                  onClick={handleClearFilters}
                  sx={{ textTransform: 'none', minHeight: 32 }}
                  data-testid="address-book-clear-filters"
                >
                  Сбросить фильтры
                </Button>
              </Stack>
            ) : null}
          </>
        ) : (
          <>
            {/* T2: header row 1 — title, tabs, count; right: status chips, sync */}
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              useFlexGap
              flexWrap="wrap"
              sx={{ flexShrink: 0 }}
              data-testid="address-book-header-row1"
            >
              <Typography variant="h5" sx={{ fontWeight: 600 }}>
                Адресная книга
              </Typography>
              {canViewDismissed ? (
                <Tabs
                  value={tab}
                  onChange={handleTabChange}
                  sx={{ flexShrink: 0, minHeight: 36 }}
                  data-testid="address-book-tabs"
                >
                  <Tab value="active" label="Сотрудники" data-testid="address-book-tab-active" sx={{ minHeight: 36, py: 0.5 }} />
                  <Tab value="dismissed" label="Уволенные" data-testid="address-book-tab-dismissed" sx={{ minHeight: 36, py: 0.5 }} />
                </Tabs>
              ) : null}
              <Typography variant="body2" color="text.secondary">
                {countLabel}
              </Typography>
              <Box sx={{ flexGrow: 1 }} />
              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
                <Chip
                  label={`Обновлено: ${formatDateTime(statusDate)}`}
                  size="small"
                  variant="outlined"
                />
                {statusLoading ? <Chip label="Проверяем статус…" size="small" variant="outlined" /> : null}
                {syncing || status?.sync_in_progress ? (
                  <Chip label="Идёт обновление" size="small" color="info" variant="outlined" />
                ) : null}
                {status?.last_sync_failed ? (
                  <Tooltip title={isAdmin ? status?.last_error || 'Последняя синхронизация завершилась ошибкой' : ''}>
                    <Chip
                      label={isAdmin ? 'Ошибка синхронизации' : 'Данные могут быть неактуальны'}
                      aria-label={isAdmin && status?.last_error
                        ? `Ошибка синхронизации: ${status.last_error}`
                        : undefined}
                      size="small"
                      color="warning"
                      variant="outlined"
                      data-testid="address-book-sync-status"
                    />
                  </Tooltip>
                ) : null}
              </Stack>
              {isAdmin ? (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
                  onClick={handleSync}
                  disabled={syncing || status?.sync_in_progress}
                >
                  Обновить
                </Button>
              ) : null}
            </Stack>

            {/* T2: header row 2 — search and filters on one wrapped line */}
            <Paper sx={{ ...panelSx, px: 1, py: 0.75, flexShrink: 0 }}>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                <TextField
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="ФИО, должность, подразделение, город, телефон или e-mail"
                  size="small"
                  inputRef={searchInputRef}
                  sx={{ flex: '1 1 260px', minWidth: 200 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  endAdornment: query ? (
                    <InputAdornment position="end">
                      <Tooltip title="Очистить поиск">
                        <IconButton
                          aria-label="Очистить поиск"
                          edge="end"
                          size="small"
                          onClick={handleClearQuery}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ) : null,
                }}
                  inputProps={{
                    'data-testid': 'address-book-search-input',
                    'aria-label': 'Поиск по адресной книге',
                    'aria-keyshortcuts': '/',
                    // inputProps lands on the real <input> — needed for blur().
                    onKeyDown: handleSearchKeyDown,
                  }}
                />
                <AddressBookFilters
                  inline
                  departments={filterOptions.departments}
                  cities={filterOptions.cities}
                  department={departmentFilter}
                  city={cityFilter}
                  loading={filtersLoading}
                  onDepartmentChange={handleDepartmentFilterChange}
                  onCityChange={handleCityFilterChange}
                  onOpen={ensureFilterOptions}
                />
              </Stack>
            </Paper>
            {hasActiveFilters ? (
              <Stack
                direction="row"
                spacing={0.75}
                useFlexGap
                flexWrap="wrap"
                alignItems="center"
                sx={{ flexShrink: 0 }}
                data-testid="address-book-active-filters"
              >
                {departmentFilter ? (
                  <Chip
                    size="small"
                    label={`Подразделение: ${departmentFilter}`}
                    title={`Подразделение: ${departmentFilter}`}
                    onDelete={() => setDepartmentFilter('')}
                    aria-label={`Убрать фильтр по подразделению ${departmentFilter}`}
                    sx={{ maxWidth: 320, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                  />
                ) : null}
                {cityFilter ? (
                  <Chip
                    size="small"
                    label={`Город: ${cityFilter}`}
                    title={`Город: ${cityFilter}`}
                    onDelete={() => setCityFilter('')}
                    aria-label={`Убрать фильтр по городу ${cityFilter}`}
                    sx={{ maxWidth: 320, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                  />
                ) : null}
                <Button
                  size="small"
                  onClick={handleClearFilters}
                  sx={{ textTransform: 'none', minHeight: 32 }}
                  data-testid="address-book-clear-filters"
                >
                  Сбросить фильтры
                </Button>
              </Stack>
            ) : null}
          </>
        )}

        {showErrorAlert ? (
          <Alert
            severity="error"
            onClose={() => setError(null)}
            action={(
              <Button
                color="inherit"
                size="small"
                onClick={error?.source === 'sync' ? handleSync : handleRetrySearch}
              >
                Повторить
              </Button>
            )}
          >
            {error?.message}
          </Alert>
        ) : null}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Grid
            container
            spacing={{ xs: 0, sm: 2 }}
            sx={{
              flex: 1,
              minHeight: 0,
              height: '100%',
            }}
          >
            <Grid
              item
              xs={12}
              lg={4}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                height: '100%',
              }}
            >
              {/* T1: list-mode switcher sits outside the scroll area,
                  in the list column (desktop) / under the header (phone, tablet). */}
              {!dismissed ? (
                <AddressBookListModes
                  mode={listMode}
                  favoritesCount={favoriteCodes.length}
                  recentsCount={recentCodes.length}
                  onChange={handleListModeChange}
                  onClearRecent={handleClearRecent}
                />
              ) : null}
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  WebkitOverflowScrolling: 'touch',
                  mt: showModesRow ? 0.75 : 0,
                  ...addressBookScrollbarSx(theme),
                }}
                data-testid="address-book-entry-list-scroll"
              >
                <AddressBookEntryList
                  items={items}
                  selectedEntryKey={selectedEntryKey}
                  loading={loading}
                  hasActiveFilters={hasActiveFilters}
                  onClearFilters={handleClearFilters}
                  query={query}
                  enableTelLinks={isMobile}
                  showOnlyPrimaryAction
                  hasMore={hasMore}
                  loadingMore={loadingMore}
                  error={searchError}
                  isAdmin={isAdmin}
                  dismissed={dismissed}
                  listMode={listMode}
                  syncing={syncing}
                  onRetry={handleRetrySearch}
                  onClearQuery={handleClearQuery}
                  onSync={handleSync}
                  onLoadMore={handleLoadMore}
                  selectionFollowsFocus={isWide}
                  onSelect={handleListSelect}
                  onOpenTelegram={handleOpenTelegram}
                  onComposeEmail={handleComposeEmail}
                  canComposeEmail={canComposeEmail}
                  onOpenChat={handleOpenChat}
                  showChatAction={canUseChat && !dismissed}
                  chatBusyEntryKey={chatBusyEntryKey}
                />
              </Box>
            </Grid>

            {isWide ? (
              <Grid
                item
                lg={8}
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
                    ...addressBookScrollbarSx(theme),
                  }}
                  data-testid="address-book-entry-detail-scroll"
                >
                  {selectedItem ? (
                    <AddressBookEntryDetail
                      item={selectedItem}
                      query={query}
                      enableTelLinks={false}
                      dismissed={dismissed}
                      canComposeEmail={canComposeEmail}
                      onCopy={handleCopy}
                      onOpenTelegram={handleOpenTelegram}
                      onOpenMax={handleOpenMax}
                      onComposeEmail={handleComposeEmail}
                      onOpenChat={(item) => handleOpenChat(item, items.findIndex((entry, idx) => getEntryKey(entry, idx) === selectedEntryKey))}
                      showChatAction={canUseChat && !dismissed}
                      chatBusy={Boolean(chatBusyEntryKey)}
                      isFavorite={selectedIsFavorite}
                      onToggleFavorite={dismissed ? undefined : handleToggleFavorite}
                      onSaveContact={handleSaveContact}
                    />
                  ) : (
                    <AddressBookDetailEmptyState
                      query={query}
                      dismissed={dismissed}
                      error={Boolean(error)}
                      loading={loading}
                      isAdmin={isAdmin}
                      onClearQuery={handleClearQuery}
                      onSync={handleSync}
                    />
                  )}
                </Box>
              </Grid>
            ) : null}
          </Grid>
        </Box>

        {!isMobile && !isWide ? (
          <AddressBookEntryDrawer
            open={tabletDrawerOpen && Boolean(selectedItem)}
            item={selectedItem}
            query={query}
            enableTelLinks={false}
            dismissed={dismissed}
            canComposeEmail={canComposeEmail}
            onClose={() => setTabletDrawerOpen(false)}
            onCopy={handleCopy}
            onOpenTelegram={handleOpenTelegram}
            onOpenMax={handleOpenMax}
            onComposeEmail={handleComposeEmail}
            onOpenChat={(item) => {
              const index = items.findIndex((entry) => getEntryIdentity(entry) === getEntryIdentity(item));
              handleOpenChat(item, index >= 0 ? index : 0);
            }}
            showChatAction={canUseChat && !dismissed}
            chatBusy={Boolean(chatBusyEntryKey)}
            isFavorite={selectedIsFavorite}
            onToggleFavorite={dismissed ? undefined : handleToggleFavorite}
            onSaveContact={handleSaveContact}
          />
        ) : null}

        <AddressBookEntrySheet
          open={mobileSheetOpen && Boolean(sheetItem)}
          item={sheetItem}
          query={query}
          enableTelLinks={isMobile}
          dismissed={dismissed}
          canComposeEmail={canComposeEmail}
          onClose={() => {
            setMobileSheetOpen(false);
            setSheetItem(null);
          }}
          onCopy={handleCopy}
          onOpenTelegram={handleOpenTelegram}
          onOpenMax={handleOpenMax}
          onComposeEmail={handleComposeEmail}
          onOpenChat={(item) => {
            const index = items.findIndex((entry) => getEntryIdentity(entry) === getEntryIdentity(item));
            handleOpenChat(item, index >= 0 ? index : 0);
          }}
          showChatAction={canUseChat && !dismissed}
          chatBusy={Boolean(chatBusyEntryKey)}
          isFavorite={sheetIsFavorite}
          onToggleFavorite={dismissed ? undefined : handleToggleFavorite}
          onSaveContact={handleSaveContact}
        />

        <Dialog
          open={filtersDialogOpen}
          onClose={() => setFiltersDialogOpen(false)}
          fullWidth
          maxWidth="xs"
          data-testid="address-book-filters-dialog"
        >
          <DialogTitle sx={{ fontWeight: 700 }}>Фильтры</DialogTitle>
          <DialogContent sx={{ pt: 1 }}>
            <AddressBookFilters
              departments={filterOptions.departments}
              cities={filterOptions.cities}
              department={departmentFilter}
              city={cityFilter}
              loading={filtersLoading}
              direction="column"
              onDepartmentChange={handleDepartmentFilterChange}
              onCityChange={handleCityFilterChange}
              onOpen={ensureFilterOptions}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={handleClearFilters} disabled={!hasActiveFilters}>
              Сбросить
            </Button>
            <Button variant="contained" onClick={() => setFiltersDialogOpen(false)}>
              Готово
            </Button>
          </DialogActions>
        </Dialog>

        <Popover
          open={Boolean(maxHelpAnchorEl)}
          anchorEl={maxHelpAnchorEl}
          onClose={() => setMaxHelpAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
          <Box sx={{ p: 2, maxWidth: 280 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              Как найти контакт в MAX
            </Typography>
            <Stack component="ol" spacing={0.75} sx={{ m: 0, pl: 2.25 }}>
              <Typography component="li" variant="body2">Откройте приложение MAX</Typography>
              <Typography component="li" variant="body2">Нажмите поиск</Typography>
              <Typography component="li" variant="body2">
                Вставьте скопированный номер{maxHelpPhone ? `: ${maxHelpPhone}` : ''}
              </Typography>
            </Stack>
          </Box>
        </Popover>
      </PageShell>
    </MainLayout>
  );
};

export default AddressBook;
