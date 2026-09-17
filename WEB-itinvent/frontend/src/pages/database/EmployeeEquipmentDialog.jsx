import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { equipmentRecordsAPI } from '../../api/equipmentRecords';
import { readFirst } from './databaseRecordModel';
import { useEquipmentActFilePreview } from './useEquipmentActFilePreview';
import { useMovementDetail } from './warehouse1cMovementDetail';
import {
  buildCompareMaps,
  isBalancesMetaIncomplete,
  normalizeCompareKey,
  resolve1cRowStatus,
  resolveHubRowStatus,
} from './employeeCompareModel';
import { filterBalancesByText, resolveWarehouseErrorMessage, sortBalancesByNomenclature } from './warehouse1cShared';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import EmployeeNameLink from './EmployeeNameLink';
import {
  COLUMN_HEADER_MIN_HEIGHT,
  HUB_SORT_GETTERS,
  WH_SORT_GETTERS,
  filterHubItemsByText,
  sortRowsBy,
  toggleSortState,
} from './employeeCompareFormat';
import HubEquipmentTable from './HubEquipmentList';
import Warehouse1CBalancesPanel from './WarehouseBalancesPanel';
import EmployeeCompareFilters from './EmployeeCompareFilters';
import EmployeeEquipmentSubDialogs from './EmployeeEquipmentSubDialogs';
import useEmployeeEquipmentData from './useEmployeeEquipmentData';
import useEmployeeWarehouseNavigation from './useEmployeeWarehouseNavigation';
import useEmployeeEquipmentExport from './useEmployeeEquipmentExport';
import useDiscrepanciesCopy from './useDiscrepanciesCopy';

export default function EmployeeEquipmentDialog({
  open,
  ownerNo,
  employeeName,
  warehouseRef = '',
  canViewWarehouse1C = false,
  allowCrossDatabase = false,
  stackAboveParent = false,
  disableEnforceFocus = false,
  onClose,
  onOpenInvNo = null,
  buildWarehouseReturnContext = null,
}) {
  const navigate = useNavigate();
  const theme = useTheme();
  const isNarrowMobile = useMediaQuery(theme.breakpoints.down('sm'), { defaultMatches: false });
  const isTouchMobile = useMediaQuery('(hover: none) and (pointer: coarse)', { defaultMatches: false });
  const isMobile = isNarrowMobile || isTouchMobile;
  const {
    preview: currentActPreview,
    openingDocNo: openingCurrentActDocNo,
    openActFile: openCurrentAct,
    closePreview: closeCurrentActPreview,
  } = useEquipmentActFilePreview();

  const [mobilePanel, setMobilePanel] = useState('hub');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [hubMatchOpen, setHubMatchOpen] = useState(false);
  const [hubMatchRow, setHubMatchRow] = useState(null);
  const [hubMatchWarehouse, setHubMatchWarehouse] = useState(null);
  const [sharedFilter, setSharedFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [noActFilter, setNoActFilter] = useState(false);
  const [groupByType, setGroupByType] = useState(false);
  const [hubSort, setHubSort] = useState({ key: '', dir: 'asc' });
  const [warehouseSort, setWarehouseSort] = useState({ key: '', dir: 'asc' });
  const [historyState, setHistoryState] = useState({
    open: false,
    invNo: '',
    loading: false,
    error: '',
    rows: [],
  });
  const movementDetail = useMovementDetail();
  const [inventoryTaskOpen, setInventoryTaskOpen] = useState(false);

  const resetView = useCallback(() => {
    setSharedFilter('');
    setStatusFilter('');
    setTypeFilter('');
    setNoActFilter(false);
  }, []);

  const {
    hubItems,
    hubLoading,
    hubError,
    hubWarning,
    warehouseLoading,
    warehouseBalancesLoading,
    warehouseError,
    warehouseStatus,
    warehouseInfo,
    warehouseCandidates,
    warehouseBalances,
    warehouseBalancesMeta,
    warehouseTab,
    setWarehouseTab,
    warehouseMovements,
    warehouseMovementsMeta,
    movementsLoading,
    movementsError,
    movementsLoaded,
    movementsDateFrom,
    movementsDateTo,
    warehouseLoaded,
    employmentStatus,
    employmentLabel,
    handleSelectCandidate,
    handleMovementsDatesChange,
    handleLoadMoreMovements,
  } = useEmployeeEquipmentData({
    open,
    ownerNo,
    employeeName,
    warehouseRef,
    canViewWarehouse1C,
    allowCrossDatabase,
    resetView,
  });

  const filterActive = Boolean(String(sharedFilter || '').trim())
    || Boolean(typeFilter)
    || noActFilter
    || (Boolean(statusFilter) && canViewWarehouse1C);
  const comparisonComplete = Boolean(
    canViewWarehouse1C
    && warehouseLoaded
    && warehouseStatus === 'matched'
    && !warehouseBalancesLoading
    && !isBalancesMetaIncomplete(warehouseBalancesMeta)
  );
  const compareMaps = useMemo(
    () => (comparisonComplete ? buildCompareMaps({ hubItems, balances: warehouseBalances }) : null),
    [comparisonComplete, hubItems, warehouseBalances],
  );
  const statusFilterActive = Boolean(statusFilter) && comparisonComplete;
  const equipmentTypes = useMemo(() => {
    const seen = new Map();
    for (const item of Array.isArray(hubItems) ? hubItems : []) {
      const type = String(readFirst(item, ['TYPE_NAME', 'type_name'], '') || '').trim();
      if (type) seen.set(type.toLowerCase(), type);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [hubItems]);
  // Тип — атрибут Хаба: на стороне 1С оставляем только позиции, чей код
  // встречается среди парт. № отфильтрованного по типу оборудования.
  const allowed1cCodes = useMemo(() => {
    if (!typeFilter) return null;
    const codes = new Set();
    for (const item of Array.isArray(hubItems) ? hubItems : []) {
      const type = String(readFirst(item, ['TYPE_NAME', 'type_name'], '') || '').trim();
      if (type !== typeFilter) continue;
      const key = normalizeCompareKey(readFirst(item, ['PART_NO', 'part_no'], ''));
      if (key) codes.add(key);
    }
    return codes;
  }, [hubItems, typeFilter]);
  const noActCount = useMemo(
    () => (Array.isArray(hubItems) ? hubItems : []).filter(
      (item) => !readFirst(item, ['current_act_available', 'CURRENT_ACT_AVAILABLE'], false),
    ).length,
    [hubItems],
  );
  const typeByPartKey = useMemo(() => {
    const map = new Map();
    for (const item of Array.isArray(hubItems) ? hubItems : []) {
      const key = normalizeCompareKey(readFirst(item, ['PART_NO', 'part_no'], ''));
      const type = String(readFirst(item, ['TYPE_NAME', 'type_name'], '') || '').trim();
      if (key && type && !map.has(key)) map.set(key, type);
    }
    return map;
  }, [hubItems]);
  const visibleHubItems = useMemo(() => {
    let items = filterHubItemsByText(hubItems, sharedFilter);
    if (typeFilter) {
      items = items.filter(
        (item) => String(readFirst(item, ['TYPE_NAME', 'type_name'], '') || '').trim() === typeFilter,
      );
    }
    if (noActFilter) {
      items = items.filter(
        (item) => !readFirst(item, ['current_act_available', 'CURRENT_ACT_AVAILABLE'], false),
      );
    }
    if (statusFilterActive) {
      items = items.filter((item) => {
        const status = resolveHubRowStatus(readFirst(item, ['PART_NO', 'part_no'], ''), compareMaps);
        return statusFilter === 'none' ? !status : status === statusFilter;
      });
    }
    return sortRowsBy(items, HUB_SORT_GETTERS, hubSort.key, hubSort.dir);
  }, [hubItems, sharedFilter, typeFilter, noActFilter, statusFilter, statusFilterActive, compareMaps, hubSort]);
  const statusCounts = useMemo(() => {
    if (!canViewWarehouse1C || !compareMaps) return null;
    const counts = { match: 0, diff: 0, only_hub: 0, only_1c: 0, none: 0 };
    for (const item of Array.isArray(hubItems) ? hubItems : []) {
      const status = resolveHubRowStatus(readFirst(item, ['PART_NO', 'part_no'], ''), compareMaps);
      counts[status || 'none'] += 1;
    }
    for (const row of Array.isArray(warehouseBalances) ? warehouseBalances : []) {
      const status = resolve1cRowStatus(row?.nomenclature_code, compareMaps);
      counts[status || 'none'] += 1;
    }
    return counts;
  }, [canViewWarehouse1C, hubItems, warehouseBalances, compareMaps]);
  const visibleWarehouseBalances = useMemo(() => {
    let rows = filterBalancesByText(sortBalancesByNomenclature(warehouseBalances), sharedFilter);
    if (allowed1cCodes) {
      rows = rows.filter((row) => allowed1cCodes.has(normalizeCompareKey(row?.nomenclature_code)));
    }
    if (statusFilterActive) {
      rows = rows.filter((row) => {
        const status = resolve1cRowStatus(row?.nomenclature_code, compareMaps);
        return statusFilter === 'none' ? !status : status === statusFilter;
      });
    }
    return sortRowsBy(rows, WH_SORT_GETTERS, warehouseSort.key, warehouseSort.dir);
  }, [warehouseBalances, sharedFilter, allowed1cCodes, statusFilter, statusFilterActive, compareMaps, warehouseSort]);
  const { handleOpenWarehousePage, handleOpenBalanceInWarehouse1C } = useEmployeeWarehouseNavigation({
    ownerNo,
    employeeName,
    warehouseRef,
    warehouseInfo,
    buildWarehouseReturnContext,
  });

  const { exporting, exportError, exportDisabled, handleExportExcel } = useEmployeeEquipmentExport({
    canViewWarehouse1C,
    compareMaps,
    employeeName,
    hubLoading,
    movementsDateFrom,
    movementsDateTo,
    movementsLoaded,
    sharedFilter,
    statusFilter,
    statusFilterActive,
    typeFilter,
    visibleHubItems,
    visibleWarehouseBalances,
    warehouseBalancesLoading,
    warehouseInfo,
    warehouseLoaded,
    warehouseLoading,
    warehouseMovements,
    warehouseStatus,
  });

  const handleOpenBalanceRow = useCallback((row, warehouse) => {
    if (!row?.nomenclature_ref && !row?.nomenclature_code && !row?.nomenclature_name) return;
    setHubMatchRow(row);
    setHubMatchWarehouse(warehouse || null);
    setHubMatchOpen(true);
  }, []);

  const handleCloseHubMatch = useCallback(() => {
    setHubMatchOpen(false);
    setHubMatchRow(null);
    setHubMatchWarehouse(null);
  }, []);

  const handleOpenInvNo = useCallback((invNo, meta = {}) => {
    onOpenInvNo?.(invNo, meta);
  }, [onOpenInvNo]);

  const handleOpenHistory = useCallback((item) => {
    const invNo = String(readFirst(item, ['INV_NO', 'inv_no'], '') || '').trim();
    if (!invNo || invNo === '-') return;
    setHistoryState({ open: true, invNo, loading: true, error: '', rows: [] });
    equipmentRecordsAPI.getEquipmentHistory(invNo)
      .then((data) => {
        setHistoryState((prev) => (prev.open && prev.invNo === invNo
          ? { ...prev, loading: false, rows: Array.isArray(data?.history) ? data.history : [] }
          : prev));
      })
      .catch((err) => {
        console.error('Failed to load equipment history:', err);
        setHistoryState((prev) => (prev.open && prev.invNo === invNo
          ? {
            ...prev,
            loading: false,
            error: resolveWarehouseErrorMessage(err, 'Не удалось загрузить историю передач.'),
          }
          : prev));
      });
  }, []);

  const handleCloseHistory = useCallback(() => {
    setHistoryState((prev) => ({ ...prev, open: false }));
  }, []);

  const { copiedDiscrepancies, discrepanciesText, handleCopyDiscrepancies } = useDiscrepanciesCopy({
    employeeName,
    comparisonComplete,
    hubItems,
    warehouseBalances,
    compareMaps,
  });

  return (
    <>
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      fullScreen={isMobile}
      scroll="paper"
      disableEnforceFocus={disableEnforceFocus}
      sx={stackAboveParent ? {
        // Keep above EquipmentDetailDialog (and beat ModalManager inline z-index).
        zIndex: (t) => `${t.zIndex.modal + 2} !important`,
      } : undefined}
      PaperProps={{
        sx: {
          height: isMobile ? '100%' : 'min(90vh, 920px)',
          maxHeight: isMobile ? '100%' : '90vh',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <DialogTitle
        sx={{
          pr: 6,
          flexShrink: 0,
          pt: isMobile ? 'calc(env(safe-area-inset-top) + 12px)' : undefined,
        }}
      >
        Оборудование сотрудника
        <IconButton
          aria-label="Закрыть"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: isMobile ? 'calc(env(safe-area-inset-top) + 4px)' : 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        dividers
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <Typography variant="h6" sx={{ mb: 1.5, flexShrink: 0 }}>
          <EmployeeNameLink name={employeeName} />
        </Typography>

        <EmployeeCompareFilters
          isMobile={isMobile}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((prev) => !prev)}
          canViewWarehouse1C={canViewWarehouse1C}
          sharedFilter={sharedFilter}
          onSharedFilterChange={setSharedFilter}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          equipmentTypes={equipmentTypes}
          statusCounts={statusCounts}
          noActFilter={noActFilter}
          onToggleNoAct={() => setNoActFilter((prev) => !prev)}
          noActCount={noActCount}
          hasHubItems={hubItems.length > 0}
          groupByType={groupByType}
          onToggleGroupByType={() => setGroupByType((prev) => !prev)}
        />

        {isMobile && canViewWarehouse1C ? (
          <Tabs
            value={mobilePanel}
            onChange={(_event, value) => setMobilePanel(value)}
            variant="fullWidth"
            sx={{
              flexShrink: 0,
              minHeight: 44,
              mb: 1,
              '& .MuiTab-root': { minHeight: 44, textTransform: 'none', fontWeight: 600 },
            }}
          >
            <Tab value="hub" label="В Хабе" />
            <Tab value="warehouse" label="Склад 1С" />
          </Tabs>
        ) : null}

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          alignItems="stretch"
          divider={canViewWarehouse1C && !isMobile ? <Divider flexItem orientation="vertical" /> : null}
          sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        >
          {isMobile && mobilePanel !== 'hub' ? null : (
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <Stack
              direction="row"
              alignItems="flex-start"
              sx={{ minHeight: COLUMN_HEADER_MIN_HEIGHT, mb: 1, pt: 0.5, flexShrink: 0 }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                В Хабе
                {!hubLoading && hubItems.length > 0 ? (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    {filterActive ? `${visibleHubItems.length} из ${hubItems.length}` : hubItems.length}
                  </Typography>
                ) : null}
              </Typography>
            </Stack>
            {hubWarning ? (
              <Alert severity="warning" sx={{ mb: 1 }}>{hubWarning}</Alert>
            ) : null}
            <HubEquipmentTable
              items={visibleHubItems}
              loading={hubLoading}
              error={hubError}
              isMobile={isMobile}
              filterActive={filterActive}
              emptyMessage={!ownerNo ? 'Сотрудник не найден в справочнике Хаба.' : ''}
              onOpenInvNo={onOpenInvNo ? handleOpenInvNo : null}
              onOpenCurrentAct={openCurrentAct}
              openingCurrentActDocNo={openingCurrentActDocNo}
              compareMaps={canViewWarehouse1C ? compareMaps : null}
              sortKey={hubSort.key}
              sortDir={hubSort.dir}
              onSort={(key) => setHubSort((prev) => toggleSortState(prev, key))}
              onOpenHistory={handleOpenHistory}
              groupByType={groupByType}
            />
          </Box>
          )}

          {canViewWarehouse1C && (!isMobile || mobilePanel === 'warehouse') ? (
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <Warehouse1CBalancesPanel
                visible
                loading={warehouseLoading}
                balancesLoading={warehouseBalancesLoading}
                error={warehouseError}
                status={warehouseLoaded ? warehouseStatus : ''}
                warehouse={warehouseInfo}
                candidates={warehouseCandidates}
                balances={warehouseBalances}
                balancesMeta={warehouseBalancesMeta}
                compareMaps={compareMaps}
                filterText={sharedFilter}
                statusFilter={statusFilterActive ? statusFilter : ''}
                allowedCodes={allowed1cCodes}
                typeFilterName={typeFilter}
                whSortKey={warehouseSort.key}
                whSortDir={warehouseSort.dir}
                onSortWarehouse={(key) => setWarehouseSort((prev) => toggleSortState(prev, key))}
                groupByType={groupByType}
                typeByPartKey={typeByPartKey}
                employmentStatus={employmentStatus}
                employmentLabel={employmentLabel}
                isMobile={isMobile}
                activeTab={warehouseTab}
                onTabChange={setWarehouseTab}
                movements={warehouseMovements}
                movementsLoading={movementsLoading}
                movementsError={movementsError}
                movementsMeta={warehouseMovementsMeta}
                movementsDateFrom={movementsDateFrom}
                movementsDateTo={movementsDateTo}
                onMovementsDatesChange={handleMovementsDatesChange}
                onLoadMoreMovements={handleLoadMoreMovements}
                onOpenMovement={movementDetail.openMovement}
                onSelectCandidate={handleSelectCandidate}
                onOpenWarehousePage={handleOpenWarehousePage}
                onOpenBalanceRow={handleOpenBalanceRow}
                onOpenInWarehouse1C={handleOpenBalanceInWarehouse1C}
              />
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      {exportError ? (
        <Alert severity="error" sx={{ mx: 2, mb: 0 }}>{exportError}</Alert>
      ) : null}
      <DialogActions
        sx={{
          flexShrink: 0,
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1,
          pb: isMobile ? 'calc(env(safe-area-inset-bottom) + 8px)' : undefined,
        }}
      >
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Button
            variant="outlined"
            startIcon={exporting ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />}
            onClick={handleExportExcel}
            disabled={exportDisabled}
            aria-label="Выгрузить в Excel"
          >
            {exporting ? 'Готовлю…' : 'Выгрузить в Excel'}
          </Button>
          {canViewWarehouse1C ? (
            <Button
              variant="text"
              startIcon={copiedDiscrepancies ? undefined : <ContentCopyIcon />}
              onClick={handleCopyDiscrepancies}
              disabled={!comparisonComplete || copiedDiscrepancies}
            >
              {copiedDiscrepancies ? 'Скопировано' : 'Скопировать расхождения'}
            </Button>
          ) : null}
          {canViewWarehouse1C ? (
            <Button
              variant="text"
              onClick={() => setInventoryTaskOpen(true)}
              disabled={!comparisonComplete}
            >
              Задача на инвентаризацию
            </Button>
          ) : null}
        </Stack>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>

    <EmployeeEquipmentSubDialogs
      isMobile={isMobile}
      stackAboveParent={stackAboveParent}
      ownerNo={ownerNo}
      employeeName={employeeName}
      currentActPreview={currentActPreview}
      closeCurrentActPreview={closeCurrentActPreview}
      hubMatchOpen={hubMatchOpen}
      hubMatchRow={hubMatchRow}
      hubMatchWarehouse={hubMatchWarehouse}
      onCloseHubMatch={handleCloseHubMatch}
      onOpenInvNo={onOpenInvNo ? handleOpenInvNo : null}
      onOpenInWarehouse1C={handleOpenBalanceInWarehouse1C}
      movementDetail={movementDetail}
      historyState={historyState}
      onCloseHistory={handleCloseHistory}
      inventoryTaskOpen={inventoryTaskOpen}
      discrepanciesText={discrepanciesText}
      onCloseInventoryTask={() => setInventoryTaskOpen(false)}
      onOpenTasks={() => {
        setInventoryTaskOpen(false);
        navigate('/tasks');
      }}
    />
    </>
  );
}
