import { useCallback, useEffect, useMemo, useState } from 'react';
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
  IconButton,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { equipmentRecordsAPI } from '../../api/equipmentRecords';
import { equipmentComputersAPI } from '../../api/equipmentComputers';
import { readFirst } from './databaseRecordModel';
import { useEquipmentActFilePreview } from './useEquipmentActFilePreview';
import { useMovementDetail } from './warehouse1cMovementDetail';
import {
  areBalanceQuantitiesValid,
  buildCompareMaps,
  buildEmployeeCompareSummary,
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
  HUB_SORT_GETTERS,
  WH_SORT_GETTERS,
  filterHubItemsByText,
  hubItemDatabaseMeta,
  sortRowsBy,
  toggleSortState,
} from './employeeCompareFormat';
import HubEquipmentTable from './HubEquipmentList';
import Warehouse1CBalancesPanel from './WarehouseBalancesPanel';
import EmployeeCompareFilters from './EmployeeCompareFilters';
import EmployeeEquipmentSubDialogs from './EmployeeEquipmentSubDialogs';
import useEmployeeEquipmentData from './useEmployeeEquipmentData';
import EmployeeHistoryPanel from './EmployeeHistoryPanel';
import useEmployeeWarehouseNavigation from './useEmployeeWarehouseNavigation';
import useEmployeeEquipmentExport from './useEmployeeEquipmentExport';
import useDiscrepanciesCopy from './useDiscrepanciesCopy';
import useMissingWarehouseTaskText from './useMissingWarehouseTaskText';
import { comparisonPanelSx, comparisonTabsSx } from './employeeComparisonStyles';

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
  onComparisonChange = null,
}) {
  const navigate = useNavigate();
  const theme = useTheme();
  const isNarrowMobile = useMediaQuery(theme.breakpoints.down('sm'), { defaultMatches: false });
  const isTouchMobile = useMediaQuery('(hover: none) and (pointer: coarse)', { defaultMatches: false });
  const isMobile = isNarrowMobile || isTouchMobile;
  const narrowWorkspace = useMediaQuery('(max-width: 1099px)', { defaultMatches: false });
  const singlePanel = isMobile || narrowWorkspace;
  const {
    preview: currentActPreview,
    openingDocNo: openingCurrentActDocNo,
    openActFile: openCurrentAct,
    closePreview: closeCurrentActPreview,
  } = useEquipmentActFilePreview();

  const [mobilePanel, setMobilePanel] = useState('hub');
  const [employeeTab, setEmployeeTab] = useState('equipment');
  useEffect(() => { setEmployeeTab('equipment'); }, [open, ownerNo, warehouseRef]);
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
  const [activeUseByInvNo, setActiveUseByInvNo] = useState(null);

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
    candidateBalances,
    loadCandidateBalances,
    summedCandidateBalances,
    summedCandidateMeta,
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

  // «В работе»: live agent computers matched to the employee's inventory
  // numbers (same MAC/hostname join as the Computers page). Fail-soft —
  // missing computers.read or any lookup error just hides the chips.
  useEffect(() => {
    if (!open || !Array.isArray(hubItems) || hubItems.length === 0) {
      setActiveUseByInvNo(null);
      return undefined;
    }
    const groups = new Map();
    for (const item of hubItems) {
      const invNo = String(readFirst(item, ['INV_NO', 'inv_no'], '') || '').trim();
      if (!invNo || invNo === '-') continue;
      const dbId = hubItemDatabaseMeta(item).databaseId || '';
      if (!groups.has(dbId)) groups.set(dbId, new Set());
      groups.get(dbId).add(invNo);
    }
    if (groups.size === 0) {
      setActiveUseByInvNo(null);
      return undefined;
    }
    let cancelled = false;
    Promise.all(
      [...groups.entries()].map(([dbId, invSet]) =>
        equipmentComputersAPI
          .getAgentComputersByInvNos([...invSet], dbId ? { dbId } : {})
          .then((data) => (data?.items && typeof data.items === 'object' ? data.items : {}))
          .catch(() => ({})),
      ),
    ).then((partials) => {
      if (cancelled) return;
      const merged = {};
      for (const partial of partials) {
        for (const [invNo, info] of Object.entries(partial)) {
          if (invNo && !(invNo in merged)) merged[invNo] = info;
        }
      }
      setActiveUseByInvNo(merged);
    });
    return () => { cancelled = true; };
  }, [open, hubItems]);

  const filterActive = Boolean(String(sharedFilter || '').trim())
    || Boolean(typeFilter)
    || noActFilter
    || (Boolean(statusFilter) && canViewWarehouse1C);
  // One matched warehouse, or the sum of several candidate warehouses of the same person.
  const compareBalances = warehouseStatus === 'matched' ? warehouseBalances : summedCandidateBalances;
  const compareBalancesMeta = warehouseStatus === 'matched' ? warehouseBalancesMeta : summedCandidateMeta;
  const comparisonComplete = Boolean(
    canViewWarehouse1C
    && !hubLoading
    && !hubError
    && !hubWarning
    && warehouseLoaded
    && !warehouseLoading
    && !warehouseError
    && (warehouseStatus === 'matched' || (warehouseStatus === 'ambiguous' && summedCandidateBalances))
    && !warehouseBalancesLoading
    && !isBalancesMetaIncomplete(compareBalancesMeta)
    && areBalanceQuantitiesValid(compareBalances)
  );
  const compareMaps = useMemo(
    () => (comparisonComplete ? buildCompareMaps({ hubItems, balances: compareBalances }) : null),
    [comparisonComplete, hubItems, compareBalances],
  );

  useEffect(() => {
    if (!open || allowCrossDatabase || typeof onComparisonChange !== 'function') return;
    const owner = Number(ownerNo);
    if (!Number.isInteger(owner) || owner <= 0) return;
    if (!comparisonComplete) {
      onComparisonChange({ ownerNo: owner, summary: null });
      return;
    }
    const metaAsOf = compareBalancesMeta?.as_of ?? compareBalancesMeta?.asOf;
    const asOf = Number.isFinite(Date.parse(metaAsOf)) ? metaAsOf : new Date().toISOString();
    onComparisonChange({
      ownerNo: owner,
      summary: buildEmployeeCompareSummary({
        ownerNo: owner,
        employeeName,
        warehouse: warehouseInfo,
        hubItems,
        balances: compareBalances,
        asOf,
      }),
    });
  }, [
    open,
    allowCrossDatabase,
    onComparisonChange,
    ownerNo,
    employeeName,
    comparisonComplete,
    compareBalancesMeta,
    warehouseInfo,
    hubItems,
    compareBalances,
  ]);
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
    for (const row of Array.isArray(compareBalances) ? compareBalances : []) {
      const status = resolve1cRowStatus(row?.nomenclature_code, compareMaps);
      counts[status || 'none'] += 1;
    }
    return counts;
  }, [canViewWarehouse1C, hubItems, compareBalances, compareMaps]);
  const visibleWarehouseBalances = useMemo(() => {
    let rows = filterBalancesByText(sortBalancesByNomenclature(compareBalances ?? warehouseBalances), sharedFilter);
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
  }, [compareBalances, warehouseBalances, sharedFilter, allowed1cCodes, statusFilter, statusFilterActive, compareMaps, warehouseSort]);
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
    // Summed candidates export as one combined 1C list, not as «выберите склад».
    warehouseStatus: warehouseStatus === 'ambiguous' && summedCandidateBalances ? 'matched' : warehouseStatus,
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

  const { copiedDiscrepancies, discrepanciesTaskText, handleCopyDiscrepancies } = useDiscrepanciesCopy({
    employeeName,
    comparisonComplete,
    hubItems,
    warehouseBalances: compareBalances,
    compareMaps,
  });

  const {
    taskText: missingWarehouseTaskText,
    loading: missingWarehouseHintsLoading,
  } = useMissingWarehouseTaskText({
    active: inventoryTaskOpen && canViewWarehouse1C && !comparisonComplete,
    employeeName,
    hubItems,
    warehouseCandidates,
  });

  const inventoryTaskDescription = comparisonComplete
    ? discrepanciesTaskText
    : missingWarehouseTaskText;

  return (
    <>
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      aria-labelledby="employee-equipment-title"
      fullScreen={isMobile}
      scroll="paper"
      disableEnforceFocus={disableEnforceFocus}
      sx={stackAboveParent ? {
        // Keep above EquipmentDetailDialog (and beat ModalManager inline z-index).
        zIndex: (t) => `${t.zIndex.modal + 2} !important`,
      } : undefined}
      PaperProps={{
        sx: {
          width: isMobile ? '100%' : 'min(96vw, 1600px)',
          maxWidth: isMobile ? '100%' : '96vw',
          m: isMobile ? 0 : 2,
          height: isMobile ? '100%' : 'min(94dvh, 1050px)',
          maxHeight: isMobile ? '100%' : '94dvh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
      }}
    >
      <DialogTitle
        id="employee-equipment-header"
        component="div"
        sx={{
          px: 2,
          py: 1,
          pr: 6,
          flexShrink: 0,
          pt: 1,
        }}
      >
        <Typography id="employee-equipment-title" component="h2" sx={{ fontSize: 17, fontWeight: 600, lineHeight: '24px' }}>
          Оборудование сотрудника
        </Typography>
        <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75} sx={{ fontSize: 12, color: 'text.secondary', lineHeight: '20px' }}>
          <EmployeeNameLink name={employeeName} sx={{ fontSize: 'inherit', lineHeight: 'inherit', color: 'text.primary' }} />
          <Typography component="span" sx={{ fontSize: 'inherit', lineHeight: 'inherit' }}>
            · {employeeTab === 'history'
              ? 'История ITinvent: текущая база'
              : allowCrossDatabase ? 'Оборудование Хаба: все базы' : 'Оборудование Хаба: текущая база'}
          </Typography>
        </Stack>
        <IconButton
          aria-label="Закрыть"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: isMobile ? 4 : 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        dividers
        sx={{
          px: isMobile ? 1.5 : 2,
          py: 0,
          pb: 1.5,
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <Tabs value={employeeTab} onChange={(_event, tab) => setEmployeeTab(tab)}
          aria-label="Данные сотрудника" variant="scrollable" scrollButtons="auto"
          sx={{ ...comparisonTabsSx, mb: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="equipment" label="Оборудование" />
          <Tab value="history" label="История перемещений" id="employee-history-tab" aria-controls="employee-history-panel" />
        </Tabs>
        <Box sx={{ display: employeeTab === 'history' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
          {open && <EmployeeHistoryPanel ownerNo={ownerNo} active={employeeTab === 'history'}
            isMobile={isMobile} onOpenInvNo={onOpenInvNo ? handleOpenInvNo : null} />}
        </Box>
        <Box sx={{ display: employeeTab === 'equipment' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
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

        {singlePanel && canViewWarehouse1C ? (
          <Tabs
            value={mobilePanel}
            onChange={(_event, value) => setMobilePanel(value)}
            variant="fullWidth"
            aria-label="Источник оборудования"
            sx={{
              ...comparisonTabsSx,
              mb: 1,
            }}
          >
            <Tab value="hub" label="В Хабе" />
            <Tab value="warehouse" label="Склад 1С" />
          </Tabs>
        ) : null}

        <Box
          sx={{ display: 'grid', gridTemplateColumns: canViewWarehouse1C && !singlePanel ? 'minmax(0, 48fr) minmax(0, 52fr)' : 'minmax(0, 1fr)',
            flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}
        >
          {singlePanel && canViewWarehouse1C && mobilePanel !== 'hub' ? null : (
          <Box
            data-testid="employee-hub-panel"
            sx={{ ...comparisonPanelSx, pr: canViewWarehouse1C && !singlePanel ? 1.5 : 0 }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ height: 36, flexShrink: 0 }}
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
            {canViewWarehouse1C && !singlePanel ? <Box sx={{ height: 32, flexShrink: 0 }} /> : null}
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
              activeUseByInvNo={activeUseByInvNo}
            />
          </Box>
          )}

          {canViewWarehouse1C && (!singlePanel || mobilePanel === 'warehouse') ? (
            <Box
              data-testid="employee-warehouse-panel"
              sx={{ ...comparisonPanelSx, pl: singlePanel ? 0 : 1.5,
                borderLeft: singlePanel ? 0 : 1, borderColor: 'divider' }}
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
                candidateBalances={candidateBalances}
                onLoadCandidateBalances={loadCandidateBalances}
                onOpenWarehousePage={handleOpenWarehousePage}
                onOpenBalanceRow={handleOpenBalanceRow}
                onOpenInWarehouse1C={handleOpenBalanceInWarehouse1C}
              />
            </Box>
          ) : null}
        </Box>
        </Box>
      </DialogContent>
      {employeeTab === 'equipment' && exportError ? (
        <Alert severity="error" sx={{ mx: 2, mb: 0 }}>{exportError}</Alert>
      ) : null}
      <DialogActions
        sx={{
          flexShrink: 0,
          px: 2,
          py: 0.75,
          minHeight: 48,
          boxSizing: 'border-box',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1,
          '& .MuiButton-root': { minHeight: 34, fontSize: 12, px: 1.25 },
          pb: isMobile ? 'calc(env(safe-area-inset-bottom) + 8px)' : undefined,
        }}
      >
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ display: employeeTab === 'equipment' ? 'flex' : 'none' }}>
          <Button
            variant="outlined"
            startIcon={exporting ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />}
            onClick={handleExportExcel}
            disabled={exportDisabled}
            aria-label="Выгрузить в Excel"
          >
            {exporting ? 'Готовлю…' : isMobile ? 'Excel' : 'Выгрузить в Excel'}
          </Button>
          {canViewWarehouse1C ? (
            <Button
              variant="text"
              startIcon={copiedDiscrepancies ? undefined : <ContentCopyIcon />}
              onClick={handleCopyDiscrepancies}
              disabled={!comparisonComplete || copiedDiscrepancies}
              aria-label={copiedDiscrepancies ? 'Скопировано' : 'Скопировать расхождения'}
              title="Скопировать расхождения"
            >
              {copiedDiscrepancies ? 'Скопировано' : isMobile ? null : 'Скопировать расхождения'}
            </Button>
          ) : null}
          {canViewWarehouse1C ? (
            <Button
              variant="text"
              onClick={() => setInventoryTaskOpen(true)}
              aria-label="Задача на инвентаризацию"
              title="Задача на инвентаризацию"
              disabled={!comparisonComplete && !(warehouseLoaded && warehouseStatus !== 'matched' && Array.isArray(hubItems) && hubItems.length)}
            >
              {isMobile ? 'Задача' : 'Задача на инвентаризацию'}
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
      discrepanciesText={inventoryTaskDescription}
      inventoryTaskDescriptionLoading={missingWarehouseHintsLoading && !comparisonComplete}
      onCloseInventoryTask={() => setInventoryTaskOpen(false)}
      onOpenTasks={() => {
        setInventoryTaskOpen(false);
        navigate('/tasks');
      }}
    />
    </>
  );
}
