import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Drawer,
  Grid,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import { adUsersAPI } from '../../api/adUsers';
import useDebounce from '../../hooks/useDebounce';
import { hideScrollbarSx } from '../../lib/hideScrollbarSx';
import { useNotification } from '../../contexts/NotificationContext';
import { DEFAULT_PASSWORD_EXPIRY_OU_LABEL, findDefaultPasswordExpiryOu } from './adOuTreeUtils';
import AdOuTreePanel from './AdOuTreePanel';
import PasswordExpiryFilters from './PasswordExpiryFilters';
import PasswordExpiryTable from './PasswordExpiryTable';

const OU_PANEL_WIDTH = 196;

const ouPanelScrollbarSx = {
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(255,255,255,0.28) transparent',
  '&::-webkit-scrollbar': { width: 6 },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  '&::-webkit-scrollbar-thumb:hover': {
    backgroundColor: 'rgba(255,255,255,0.34)',
  },
};

const formatCachedAt = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function PasswordAdExpiryView() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { notifyApiError } = useNotification();

  const [selectedOuDn, setSelectedOuDn] = useState('');
  const [selectedOuLabel, setSelectedOuLabel] = useState(DEFAULT_PASSWORD_EXPIRY_OU_LABEL);
  const [rootOu, setRootOu] = useState(null);
  const [ouReady, setOuReady] = useState(false);
  const [ouInitError, setOuInitError] = useState('');
  const [mode, setMode] = useState('expiring');
  const [daysThreshold, setDaysThreshold] = useState(7);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  const [users, setUsers] = useState([]);
  const [policyDays, setPolicyDays] = useState(40);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ouDrawerOpen, setOuDrawerOpen] = useState(false);
  const [cachedAt, setCachedAt] = useState('');
  const [fromCache, setFromCache] = useState(false);

  const loadReport = useCallback(async ({ force = false } = {}) => {
    if (!ouReady || !selectedOuDn) return;
    setLoading(true);
    setError('');
    try {
      const payload = await adUsersAPI.getPasswordExpiry({
        ouDn: selectedOuDn,
        mode,
        daysThreshold,
        q: debouncedQuery,
        force,
      });
      if (payload?.status === 'error') {
        throw new Error(payload?.error || 'Не удалось загрузить отчёт по паролям AD');
      }
      setUsers(Array.isArray(payload?.users) ? payload.users : []);
      setTotal(Number(payload?.total) || 0);
      setPolicyDays(Number(payload?.policy_days) || 40);
      setCachedAt(payload?.cached_at || '');
      setFromCache(Boolean(payload?.from_cache));
    } catch (loadError) {
      const message = loadError?.response?.data?.detail || loadError?.message || 'Не удалось загрузить отчёт по паролям AD';
      setError(message);
      setUsers([]);
      setTotal(0);
      notifyApiError(loadError, 'Не удалось загрузить отчёт по паролям AD');
    } finally {
      setLoading(false);
    }
  }, [ouReady, selectedOuDn, mode, daysThreshold, debouncedQuery, notifyApiError]);

  useEffect(() => {
    let active = true;

    const initOu = async () => {
      setOuInitError('');
      try {
        const payload = await adUsersAPI.getOrganizationalUnits('');
        const defaultOu = findDefaultPasswordExpiryOu(payload?.items);
        if (!defaultOu?.dn) {
          throw new Error('OU «Users standart» не найден в Active Directory.');
        }
        if (!active) return;
        setRootOu(defaultOu);
        setSelectedOuDn(defaultOu.dn);
        setSelectedOuLabel(defaultOu.label || DEFAULT_PASSWORD_EXPIRY_OU_LABEL);
        setOuReady(true);
      } catch (initError) {
        if (!active) return;
        const message = initError?.response?.data?.detail || initError?.message || 'Не удалось загрузить OU';
        setOuInitError(message);
        setOuReady(true);
        notifyApiError(initError, 'Не удалось загрузить OU');
      }
    };

    initOu();
    return () => {
      active = false;
    };
  }, [notifyApiError]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleOuSelect = useCallback((dn, label) => {
    setSelectedOuDn(dn);
    setSelectedOuLabel(label || DEFAULT_PASSWORD_EXPIRY_OU_LABEL);
    if (isMobile) setOuDrawerOpen(false);
  }, [isMobile]);

  const handleForceRefresh = useCallback(() => {
    loadReport({ force: true });
  }, [loadReport]);

  const ouPanel = rootOu ? (
    <AdOuTreePanel
      rootItem={rootOu}
      selectedDn={selectedOuDn}
      onSelect={handleOuSelect}
    />
  ) : null;

  const showSpinner = !ouReady || loading || !selectedOuDn;

  return (
    <Stack spacing={isMobile ? 0.5 : 1.25} sx={{ flex: 1, minHeight: 0 }} data-testid="password-ad-expiry-view">
      <Paper
        elevation={0}
        sx={{
          flexShrink: 0,
          p: isMobile ? 1 : 1.25,
          border: `1px solid ${alpha(theme.palette.divider, 0.9)}`,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight={800}>
              Истечение пароля AD
            </Typography>
            <Chip
              size="small"
              variant="outlined"
              label={selectedOuLabel}
              data-testid="password-expiry-selected-ou"
            />
            <Stack direction="row" spacing={0.5} alignItems="center" data-testid="password-expiry-total">
              {showSpinner ? <CircularProgress size={14} data-testid="password-expiry-spinner" /> : null}
              <Typography variant="caption" color="text.secondary">
                Найдено: {showSpinner ? '…' : total}
              </Typography>
              {!showSpinner && cachedAt ? (
                <Typography variant="caption" color="text.secondary" data-testid="password-expiry-cached-at">
                  · данные от {formatCachedAt(cachedAt)}{fromCache ? ' (кеш)' : ''}
                </Typography>
              ) : null}
            </Stack>
          </Stack>
          {isMobile ? (
            <Stack direction="row" spacing={0.25}>
              <Tooltip title="Выбор OU">
                <IconButton
                  onClick={() => setOuDrawerOpen(true)}
                  aria-label="Выбрать OU"
                  data-testid="password-expiry-open-ou-drawer"
                  size="small"
                  sx={{ minWidth: 40, minHeight: 40 }}
                >
                  <AccountTreeOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Принудительно запросить свежие данные из AD">
                <span>
                  <IconButton
                    onClick={handleForceRefresh}
                    disabled={showSpinner}
                    aria-label="Обновить отчёт"
                    data-testid="password-expiry-mobile-refresh"
                    size="small"
                    sx={{ minWidth: 40, minHeight: 40 }}
                  >
                    <RefreshOutlinedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          ) : null}
        </Stack>
        <Box sx={{ mt: 1 }}>
          <PasswordExpiryFilters
            mode={mode}
            onModeChange={setMode}
            daysThreshold={daysThreshold}
            onDaysThresholdChange={setDaysThreshold}
            query={query}
            onQueryChange={setQuery}
            loading={showSpinner}
            onRefresh={handleForceRefresh}
            policyDays={policyDays}
            isMobile={isMobile}
            compact
          />
        </Box>
      </Paper>

      {error || ouInitError ? <Alert severity="error" sx={{ py: 0.5 }}>{error || ouInitError}</Alert> : null}

      <Grid container spacing={isMobile ? 0.5 : 1} sx={{ flex: 1, minHeight: 0, flexWrap: 'nowrap' }}>
        {!isMobile ? (
          <Grid
            item
            sx={{
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              width: OU_PANEL_WIDTH,
              maxWidth: OU_PANEL_WIDTH,
              flexShrink: 0,
            }}
          >
            <Paper
              elevation={0}
              sx={{
                flex: 1,
                minHeight: 0,
                maxHeight: '100%',
                overflowY: 'auto',
                overflowX: 'hidden',
                p: 0.5,
                border: `1px solid ${theme.palette.divider}`,
                WebkitOverflowScrolling: 'touch',
                ...ouPanelScrollbarSx,
              }}
              data-testid="password-expiry-ou-panel"
            >
              {ouPanel}
            </Paper>
          </Grid>
        ) : null}
        <Grid item xs sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
          {showSpinner ? (
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                py: 6,
              }}
              data-testid="password-expiry-loading"
            >
              <CircularProgress size={36} />
            </Box>
          ) : (
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                WebkitOverflowScrolling: 'touch',
                ...hideScrollbarSx,
              }}
            >
              <PasswordExpiryTable users={users} isMobile={isMobile} />
            </Box>
          )}
        </Grid>
      </Grid>

      <Drawer
        anchor="left"
        open={ouDrawerOpen}
        onClose={() => setOuDrawerOpen(false)}
        PaperProps={{ sx: { width: 'min(82vw, 260px)' } }}
        ModalProps={{ keepMounted: true }}
        data-testid="password-expiry-ou-drawer"
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${theme.palette.divider}` }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="subtitle2" fontWeight={800}>Users standart</Typography>
              <IconButton onClick={() => setOuDrawerOpen(false)} aria-label="Закрыть" size="small">
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto', px: 0.5, py: 0.5, WebkitOverflowScrolling: 'touch', ...ouPanelScrollbarSx }}>
            {isMobile ? ouPanel : null}
          </Box>
        </Box>
      </Drawer>
    </Stack>
  );
}
