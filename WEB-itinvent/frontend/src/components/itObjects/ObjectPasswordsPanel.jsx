import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { passwordsAPI } from '../../api/passwords';
import PasswordEntryDetail from '../passwords/PasswordEntryDetail';
import PasswordEntryList from '../passwords/PasswordEntryList';
import PasswordEntryMobileSheet from '../passwords/PasswordEntryMobileSheet';
import PasswordUnlockBanner from '../passwords/PasswordUnlockBanner';
import PasswordUnlockDialog from '../passwords/PasswordUnlockDialog';
import VaultPrivacyCover from '../passwords/VaultPrivacyCover';
import usePasswordVaultAccess from '../passwords/usePasswordVaultAccess';
import { normalizeEntry } from '../passwords/passwordVaultUtils';
import { getItObjectsErrorMessage } from './itObjectsShared';

const ENTRIES_LIMIT = 100;

/**
 * Пароли одного объекта ИТ: список записей, просмотр, «Показать» и копирование с подтверждением 2FA.
 * Создание, правка, группы и теги остаются в разделе «Пароли» — туда ведёт кнопка с фильтром по объекту.
 */
export default function ObjectPasswordsPanel({ objectRef, level, onActivity = null }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const vault = usePasswordVaultAccess({ onActivity });
  const [state, setState] = useState({ loading: true, entries: [], error: '' });
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const gridRef = useRef(null);
  const [gridHeight, setGridHeight] = useState(0);

  // Список и карточка занимают всё место до низа окна и прокручиваются внутри, как в разделе «Пароли».
  const measureGrid = useCallback(() => {
    const node = gridRef.current;
    if (!node || isMobile) {
      setGridHeight(0);
      return;
    }
    setGridHeight(Math.max(360, Math.floor(window.innerHeight - node.getBoundingClientRect().top - 16)));
  }, [isMobile]);

  useLayoutEffect(() => {
    measureGrid();
    window.addEventListener('resize', measureGrid);
    return () => window.removeEventListener('resize', measureGrid);
  }, [measureGrid, state.loading, state.error]);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, entries: [], error: '' });
    passwordsAPI.getEntries({ object_ref: objectRef, limit: ENTRIES_LIMIT })
      .then((payload) => {
        if (cancelled) return;
        const entries = (Array.isArray(payload?.items) ? payload.items : []).map(normalizeEntry);
        setState({ loading: false, entries, error: '' });
        setSelectedEntryId((current) => (entries.some((entry) => entry.id === current) ? current : (entries[0]?.id || '')));
      })
      .catch((requestError) => {
        if (!cancelled) {
          setState({ loading: false, entries: [], error: getItObjectsErrorMessage(requestError, 'Не удалось загрузить пароли объекта') });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [objectRef]);

  const selectedEntry = useMemo(
    () => state.entries.find((entry) => entry.id === selectedEntryId) || null,
    [state.entries, selectedEntryId],
  );
  const revealRemainingMs = selectedEntry ? Math.max(0, (vault.revealExpiresAt[selectedEntry.id] || 0) - vault.nowTs) : 0;
  const detailProps = {
    entry: selectedEntry,
    revealed: selectedEntry ? vault.revealedPasswords[selectedEntry.id] : '',
    revealBusy: Boolean(selectedEntry && vault.revealBusyId.startsWith(`${selectedEntry.id}:`)),
    watermark: vault.secretWatermark,
    revealRemainingMs,
    canWrite: false,
    onCopyPassword: (entry) => vault.requestReveal(entry, 'copy'),
    onCopyLogin: vault.handleCopyLogin,
    onShow: (entry) => vault.requestReveal(entry, 'show'),
    onHide: (entry) => vault.hidePassword(entry.id),
  };

  return (
    <Stack spacing={1.5}>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={800}>
            Пароли объекта · {level === 'manage' ? 'управление' : 'просмотр'}
          </Typography>
          <Button component={RouterLink} to={`/passwords?object=${encodeURIComponent(objectRef)}`} size="small" variant="outlined">
            Открыть в разделе «Пароли»
          </Button>
        </Stack>
        <PasswordUnlockBanner
          isUnlocked={vault.isUnlocked}
          isUnlockExpiringSoon={vault.isUnlockExpiringSoon}
          unlockedRemainingMs={vault.unlockedRemainingMs}
          unlockedUntil={vault.unlockedUntil}
          onUnlockClick={vault.openUnlockDialog}
          requiresSetup={!vault.user?.is_2fa_enabled}
          compact
        />
        {state.error ? <Alert severity="warning" sx={{ mt: 1.5 }}>{state.error}</Alert> : null}
        {!state.error ? (
          <Box
            ref={gridRef}
            sx={{
              mt: 1.5,
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns: isMobile ? '1fr' : 'minmax(240px, 5fr) minmax(0, 7fr)',
              alignItems: 'start',
              ...(gridHeight ? { height: gridHeight } : {}),
            }}
          >
            <Box sx={gridHeight ? { height: '100%', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pr: 0.5 } : undefined} data-testid="object-password-list-scroll">
              <PasswordEntryList
                entries={state.entries}
                selectedEntryId={selectedEntryId}
                loading={state.loading}
                compact={isMobile}
                onSelect={(entry) => {
                  setSelectedEntryId(entry.id);
                  if (isMobile) setSheetOpen(true);
                }}
              />
            </Box>
            {!isMobile ? (
              <Box sx={gridHeight ? { height: '100%', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' } : undefined} data-testid="object-password-detail-scroll">
                <PasswordEntryDetail {...detailProps} />
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Paper>
      {isMobile ? (
        <PasswordEntryMobileSheet open={sheetOpen && Boolean(selectedEntry)} onClose={() => setSheetOpen(false)} {...detailProps} />
      ) : null}
      <PasswordUnlockDialog isMobile={isMobile} {...vault.unlockDialogProps} />
      <VaultPrivacyCover active={vault.privacyCoverActive} />
    </Stack>
  );
}
