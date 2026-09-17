import { Box, CircularProgress, Typography } from '@mui/material';

import { countGroupedItems } from './databaseListModel';

// The keyed list region: remounts on dataMode switch (single CSS animation
// gated by prefers-reduced-motion), renders sections/empty states and the
// infinite-scroll sentinel with the live-region counter.
export default function DatabaseListSection({
  dataMode,
  modeLoading,
  dataSections,
  employeeFallbackActive,
  selectedBranch,
  canAutoLoadMoreEquipment,
  loadMoreSentinelRef,
  isServerSearchActive,
  searchLoadingMore,
  loadingMoreEquipment,
  displayData,
  searchTotal,
  loadedCount,
  serverTotal,
  nextEquipmentPage,
  equipmentPagesTotal,
}) {
  return (
    <Box
      key={dataMode}
      sx={{
        '@media (prefers-reduced-motion: no-preference)': {
          animation: 'database-tab-slide 320ms ease',
          '@keyframes database-tab-slide': {
            from: { opacity: 0, transform: 'translateY(8px)' },
            to: { opacity: 1, transform: 'translateY(0)' },
          },
        },
      }}
    >
      {modeLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240, py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {dataSections || (
            employeeFallbackActive ? null :
            !selectedBranch ? (
              <Box sx={{ textAlign: 'center', py: 8 }}>
                <Typography color="text.secondary">Выберите филиал</Typography>
              </Box>
            ) : (
              <Box sx={{ textAlign: 'center', py: 8 }}>
                <Typography color="text.secondary">Нет данных</Typography>
              </Box>
            )
          )}
          {canAutoLoadMoreEquipment && (
            <Box
              ref={loadMoreSentinelRef}
              data-testid="equipment-load-more-sentinel"
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                py: 3,
                minHeight: 56,
              }}
            >
              {(isServerSearchActive ? searchLoadingMore : loadingMoreEquipment) ? (
                <CircularProgress size={24} />
              ) : (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {isServerSearchActive
                    ? `Найдено ${countGroupedItems(displayData)} из ${searchTotal ?? countGroupedItems(displayData)}`
                    : `Загружено ${loadedCount} из ${serverTotal || loadedCount}`}
                  {!isServerSearchActive && nextEquipmentPage && equipmentPagesTotal > 1
                    ? ` · стр. ${Math.max(1, nextEquipmentPage - 1)}/${equipmentPagesTotal}`
                    : ''}
                </Typography>
              )}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
