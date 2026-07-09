import { memo, useCallback } from 'react';
import { Box, Collapse, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import EquipmentTable from './EquipmentTable';
import ModernEquipmentCard from './ModernEquipmentCard';
import ConsumableMobileList from './ConsumableMobileList';
import { DATA_MODE_CONSUMABLES, toInvNo } from './equipmentModel';
import { buildLocationKey } from './databaseListModel';

const locationNameCollator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

const DatabaseDataSections = memo(function DatabaseDataSections({
  displayData,
  expandedBranches,
  expandedLocations,
  isMobile,
  theme,
  selectedItemsSet,
  tableSort,
  onTableSort,
  onSelectAll,
  onSelect,
  onAction,
  onOpenEmployee = null,
  onEditConsumableQty,
  onDeleteConsumable,
  dataMode,
  canWrite,
  canDelete = false,
  isAdmin,
  mobileSelectionMode,
  onMobileCardSelect,
  onToggleBranch,
  onToggleLocation,
}) {
  const isConsumablesMode = dataMode === DATA_MODE_CONSUMABLES;

  const isAllSelected = useCallback((items) => {
    if (items.length === 0) return false;
    return items.every((item) => selectedItemsSet.has(toInvNo(item)));
  }, [selectedItemsSet]);

  const isSomeSelected = useCallback((items) => (
    items.some((item) => selectedItemsSet.has(toInvNo(item)))
  ), [selectedItemsSet]);

  const renderItems = useCallback((items) => {
    if (isMobile && dataMode !== DATA_MODE_CONSUMABLES) {
      return (
        <Box>
          {items.map((item, index) => {
            const invNo = toInvNo(item);
            return (
              <ModernEquipmentCard
                key={`${invNo}-${index}`}
                item={item}
                theme={theme}
                onAction={onAction}
                onOpenEmployee={onOpenEmployee}
                dataMode={dataMode}
                canWrite={canWrite}
                isAdmin={isAdmin}
                selectionMode={mobileSelectionMode || selectedItemsSet.has(invNo)}
                isSelected={selectedItemsSet.has(invNo)}
                onToggleSelect={canWrite ? () => onMobileCardSelect(invNo) : undefined}
              />
            );
          })}
        </Box>
      );
    }

    return (
      <EquipmentTable
        items={items}
        isMobile={isMobile}
        theme={theme}
        selectedItemsSet={selectedItemsSet}
        tableSort={tableSort}
        onTableSort={onTableSort}
        onSelectAll={onSelectAll}
        isAllSelected={isAllSelected}
        isSomeSelected={isSomeSelected}
        onSelect={onSelect}
        onAction={onAction}
        onOpenEmployee={onOpenEmployee}
        onEditConsumableQty={onEditConsumableQty}
        onDeleteConsumable={onDeleteConsumable}
        allowSelection={!isConsumablesMode && canWrite}
        canDelete={canDelete}
        dataMode={dataMode}
        canWrite={canWrite}
        isAdmin={isAdmin}
      />
    );
  }, [
    canWrite,
    canDelete,
    dataMode,
    isAdmin,
    isAllSelected,
    isConsumablesMode,
    isMobile,
    isSomeSelected,
    mobileSelectionMode,
    onAction,
    onOpenEmployee,
    onEditConsumableQty,
    onDeleteConsumable,
    onMobileCardSelect,
    onSelect,
    onSelectAll,
    onTableSort,
    selectedItemsSet,
    tableSort,
    theme,
  ]);

  if (Object.keys(displayData || {}).length === 0) return null;

  if (isMobile && isConsumablesMode) {
    return (
      <ConsumableMobileList
        displayData={displayData}
        showBranchHeaders={Object.keys(displayData).length > 1}
        onEditConsumableQty={onEditConsumableQty}
        onDeleteConsumable={onDeleteConsumable}
        canWrite={canWrite}
        canDelete={canDelete}
      />
    );
  }

  return Object.keys(displayData).map((branchName) => {
    const locations = displayData[branchName];
    const isBranchExpanded = expandedBranches.has(branchName);
    const branchTotal = Object.values(locations).reduce((sum, items) => sum + items.length, 0);

    return (
      <Box
        key={branchName}
        sx={{
          mb: isMobile ? 1 : 1.5,
          border: '1px solid ' + theme.palette.divider,
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
        <Box
          onClick={() => onToggleBranch(branchName)}
          sx={{
            p: isMobile ? 0.65 : 1.2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            backgroundColor: theme.palette.mode === 'dark' ? '#0f172a' : theme.palette.grey[100],
            '&:hover': {
              backgroundColor: theme.palette.mode === 'dark' ? '#1e293b' : theme.palette.grey[200],
            },
            color: theme.palette.mode === 'dark' ? '#ffffff' : 'inherit',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {isBranchExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            <Typography variant={isMobile ? 'subtitle1' : 'h6'} sx={{ fontSize: isMobile ? '0.78rem' : undefined }}>
              {branchName}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: isMobile ? '0.75rem' : undefined }}>
            ({branchTotal.toLocaleString()})
          </Typography>
        </Box>

        <Collapse in={isBranchExpanded} timeout="auto" unmountOnExit>
          {Object.keys(locations)
            .sort((a, b) => locationNameCollator.compare(String(a || ''), String(b || '')))
            .map((locationName) => {
              const locationKey = buildLocationKey(branchName, locationName);
              const locationItems = locations[locationName];
              const isLocationExpanded = expandedLocations.has(locationKey);

              return (
                <Box key={locationName} sx={{ borderTop: '1px solid ' + theme.palette.divider }}>
                  <Box
                    onClick={() => onToggleLocation(branchName, locationName)}
                    sx={{
                      p: isMobile ? 0.55 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      backgroundColor: theme.palette.mode === 'dark' ? '#111827' : 'transparent',
                      '&:hover': {
                        backgroundColor: theme.palette.mode === 'dark' ? '#1f2937' : theme.palette.action.hover,
                      },
                      color: theme.palette.mode === 'dark' ? '#e5e7eb' : 'inherit',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {isLocationExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                      <Typography variant="body2" sx={{ fontWeight: 600, fontSize: isMobile ? '0.75rem' : undefined }}>
                        {locationName}
                      </Typography>
                    </Box>
                  </Box>
                  <Collapse in={isLocationExpanded} timeout="auto" unmountOnExit>
                    <Box sx={{ p: isMobile ? 0 : 1, borderTop: '1px solid ' + theme.palette.divider }}>
                      {renderItems(locationItems)}
                    </Box>
                  </Collapse>
                </Box>
              );
            })}
        </Collapse>
      </Box>
    );
  });
});

export default DatabaseDataSections;
