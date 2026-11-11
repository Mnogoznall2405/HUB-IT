import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Skeleton, Stack, Typography, useMediaQuery } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddressBookEntryRow from './AddressBookEntryRow';
import { getEntryKey } from './addressBookUtils';

const SKELETON_ROWS = 6;

const SkeletonRow = () => (
  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 1.25, py: 1, minHeight: 72 }}>
    <Skeleton variant="circular" width={40} height={40} />
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Skeleton variant="text" width="55%" sx={{ fontSize: '0.875rem' }} />
      <Skeleton variant="text" width="75%" sx={{ fontSize: '0.75rem' }} />
      <Skeleton variant="text" width="40%" sx={{ fontSize: '0.75rem' }} />
    </Box>
    <Skeleton variant="rounded" width={36} height={36} />
    <Skeleton variant="rounded" width={36} height={36} sx={{ display: { xs: 'none', sm: 'block' } }} />
  </Stack>
);

export default function AddressBookEntryList({
  items = [],
  selectedEntryKey = '',
  loading = false,
  query = '',
  enableTelLinks = false,
  error = '',
  isAdmin = false,
  dismissed = false,
  listMode = 'all',
  showOnlyPrimaryAction = false,
  hasMore = false,
  loadingMore = false,
  syncing = false,
  selectionFollowsFocus = false,
  hasActiveFilters = false,
  onSelect,
  onClearFilters,
  onRetry,
  onClearQuery,
  onSync,
  onLoadMore,
  onOpenTelegram,
  onComposeEmail,
  canComposeEmail = true,
  onOpenChat,
  showChatAction = false,
  chatBusyEntryKey = '',
}) {
  const theme = useTheme();
  // A22: a single media-query subscription for all rows instead of one per row.
  const compactActions = useMediaQuery(theme.breakpoints.down('sm'));
  const rowRefs = useRef([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const keys = useMemo(() => items.map((item, index) => getEntryKey(item, index)), [items]);
  const selectedIndex = keys.indexOf(selectedEntryKey);

  useEffect(() => {
    if (selectedIndex >= 0) {
      setActiveIndex(selectedIndex);
      return;
    }
    setActiveIndex((prev) => {
      if (!items.length) return 0;
      return Math.min(Math.max(prev, 0), items.length - 1);
    });
  }, [selectedIndex, items.length]);

  const handleNavigate = useCallback((index, direction) => {
    const lastIndex = items.length - 1;
    if (lastIndex < 0) return;
    let nextIndex = index;
    if (direction === 'next') nextIndex = Math.min(index + 1, lastIndex);
    else if (direction === 'prev') nextIndex = Math.max(index - 1, 0);
    else if (direction === 'first') nextIndex = 0;
    else if (direction === 'last') nextIndex = lastIndex;
    if (nextIndex === index) return;
    setActiveIndex(nextIndex);
    rowRefs.current[nextIndex]?.focus();
    if (selectionFollowsFocus) onSelect?.(items[nextIndex], nextIndex);
  }, [items, onSelect, selectionFollowsFocus]);

  // Stable index-based registration so memoized rows keep stable props.
  const registerRowRef = useCallback((index, node) => {
    rowRefs.current[index] = node;
  }, []);

  if (loading && items.length === 0) {
    return (
      <Box
        data-testid="address-book-entry-list-skeleton"
        aria-busy="true"
        aria-label="Загружаем адресную книгу"
        sx={{
          border: `1px solid ${theme.palette.divider}`,
          overflow: 'hidden',
          bgcolor: alpha(theme.palette.background.paper, 0.72),
        }}
      >
        {Array.from({ length: SKELETON_ROWS }, (_, i) => <SkeletonRow key={i} />)}
      </Box>
    );
  }

  if (!items.length) {
    if (error) {
      return (
        <Box
          sx={{
            py: 6,
            px: 2,
            textAlign: 'center',
            border: `1px dashed ${theme.palette.error.main}`,
            bgcolor: alpha(theme.palette.error.main, 0.04),
          }}
          data-testid="address-book-entry-list-error"
        >
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {error}
          </Typography>
          <Button size="small" variant="outlined" onClick={onRetry}>
            Повторить
          </Button>
        </Box>
      );
    }
    const searchTerm = query.trim();
    const scopedMode = listMode !== 'all';
    let emptyMessage;
    let emptyHint = '';
    if (scopedMode && (searchTerm || hasActiveFilters)) {
      emptyMessage = 'В сохранённых по текущему запросу и фильтрам никого не найдено.';
    } else if (scopedMode) {
      emptyMessage = listMode === 'favorites'
        ? 'В избранном пока никого нет.'
        : 'Недавних пока нет.';
      emptyHint = listMode === 'favorites'
        ? 'Нажмите ★ у сотрудника в списке или в карточке — он появится здесь.'
        : 'Откройте карточку сотрудника — она появится здесь.';
    } else {
      emptyMessage = searchTerm && hasActiveFilters
        ? `По запросу «${searchTerm}» и выбранным фильтрам ничего не найдено.`
        : searchTerm
          ? `По запросу «${searchTerm}» ничего не найдено.`
          : hasActiveFilters
            ? 'По выбранным фильтрам ничего не найдено.'
            : dismissed
              ? 'В списке уволенных пока нет сотрудников.'
              : 'В адресной книге пока нет сотрудников.';
    }
    return (
      <Box
        sx={{
          py: 6,
          px: 2,
          textAlign: 'center',
          border: `1px dashed ${theme.palette.divider}`,
          bgcolor: alpha(theme.palette.background.paper, 0.6),
        }}
        data-testid="address-book-entry-list-empty"
      >
        <Typography variant="body2" color="text.secondary">
          {emptyMessage}
        </Typography>
        {emptyHint ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {emptyHint}
          </Typography>
        ) : null}
        {searchTerm ? (
          <Button size="small" variant="outlined" onClick={onClearQuery} sx={{ mt: 1.5 }}>
            Сбросить поиск
          </Button>
        ) : null}
        {hasActiveFilters ? (
          <Button
            size="small"
            variant="outlined"
            onClick={onClearFilters}
            sx={{ mt: 1.5, ml: searchTerm ? 1 : 0 }}
            data-testid="address-book-empty-clear-filters"
          >
            Сбросить фильтры
          </Button>
        ) : null}
        {!searchTerm && !hasActiveFilters && isAdmin ? (
          <Button size="small" variant="outlined" onClick={onSync} disabled={syncing} sx={{ mt: 1.5 }}>
            Обновить из 1С
          </Button>
        ) : null}
      </Box>
    );
  }

  return (
    <Box data-testid="address-book-entry-list-wrapper">
      <Box
        role="list"
        aria-label="Сотрудники"
        data-testid="address-book-entry-list"
        sx={{
          border: `1px solid ${theme.palette.divider}`,
          overflow: 'hidden',
          bgcolor: alpha(theme.palette.background.paper, 0.72),
        }}
      >
      {items.map((item, index) => {
        const entryKey = keys[index];
        return (
          <AddressBookEntryRow
            key={entryKey}
            item={item}
            index={index}
            entryKey={entryKey}
            selected={entryKey === selectedEntryKey}
            active={index === activeIndex}
            dismissed={dismissed}
            showOnlyPrimaryAction={showOnlyPrimaryAction}
            compactActions={compactActions}
            query={query}
            enableTelLinks={enableTelLinks}
            rowRef={registerRowRef}
            onSelect={onSelect}
            onNavigate={handleNavigate}
            onOpenTelegram={onOpenTelegram}
            onComposeEmail={onComposeEmail}
            canComposeEmail={canComposeEmail}
            onOpenChat={onOpenChat}
            showChatAction={showChatAction}
            chatBusy={chatBusyEntryKey === entryKey}
          />
        );
      })}
      </Box>
      {hasMore ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={onLoadMore}
            disabled={loadingMore}
            data-testid="address-book-load-more"
          >
            {loadingMore ? 'Загружаем…' : 'Показать ещё'}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
