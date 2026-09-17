import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import {
  Alert,
  Box,
  Button,
  Typography,
  Paper,
  Tabs,
  Tab,
  Fade,
  CircularProgress,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import MainLayout from '../../components/layout/MainLayout';
import PageShell from '../../components/layout/PageShell';
import { LoadingSpinner } from '../../components/common';
import {
  buildOfficeUiTokens,
  getOfficeActionTraySx,
  getOfficeSubtlePanelSx,
} from '../../theme/officeUiTokens';
import {
  DATA_MODE_CONSUMABLES,
  DATA_MODE_EQUIPMENT,
  PC_COMPONENT_OPTIONS,
  PRINTER_COMPONENT_OPTIONS,
  TRANSFER_OPERATION_ACT_ONLY,
  TRANSFER_OPERATION_LOCATION_ONLY,
  getItemCapabilityFlags,
  toInvNo,
} from './equipmentModel';
import DatabaseDataSections from './DatabaseDataSections';
import { EmployeeCompareProvider } from './employeeCompareContext';
import DatabaseDialogsLayer from './DatabaseDialogsLayer';
import DatabaseRecentCards from './DatabaseRecentCards';
import {
  buildEquipmentIndex,
  countGroupedItems,
  getVisibleBranchNames,
  normalizeActionTargets,
} from './databaseListModel';
import {
  formatDetailDate as formatDate,
  formatDetailHistoryTransition as formatHistoryTransition,
  formatDetailHistoryValue as formatHistoryValue,
} from './detailModel';
import DatabaseSearchBar, {
  SEARCH_SCOPE_ACTS,
  SEARCH_SCOPE_EQUIPMENT,
} from './DatabaseSearchBar';
import DatabaseDesktopToolbar from './DatabaseDesktopToolbar';
import DatabaseMobileHeader from './DatabaseMobileHeader';
import DatabaseMobileControlStrip from './DatabaseMobileControlStrip';
import { MOBILE_BAR_GAP, MOBILE_BAR_HEIGHT } from './databaseMobileLayout';
import DatabaseRecentCardsStrip from './DatabaseRecentCardsStrip';
import DatabaseRecentActs from './DatabaseRecentActs';
import DatabaseRecentActsStrip from './DatabaseRecentActsStrip';

const DatabaseActSearchResults = lazy(() => import('./DatabaseActSearchResults'));
const DatabaseEmployeeSearchFallback = lazy(() => import('./DatabaseEmployeeSearchFallback'));
const DatabaseMobileActionSheet = lazy(() => import('./DatabaseMobileActionSheet'));
const DatabaseBulkActionBar = lazy(() => import('./DatabaseBulkActionBar'));
const DatabaseSelectionBar = lazy(() => import('./DatabaseSelectionBar'));



const DEFAULT_TABLE_SORT = { field: 'employee', direction: 'asc' };
const CONSUMABLES_DEFAULT_TABLE_SORT = { field: 'model', direction: 'asc' };

const createDefaultUiSnapshot = (mode) => ({
  searchQuery: '',
  searchScope: SEARCH_SCOPE_EQUIPMENT,
  filteredData: null,
  tableSort: mode === DATA_MODE_CONSUMABLES ? CONSUMABLES_DEFAULT_TABLE_SORT : DEFAULT_TABLE_SORT,
  expandedBranches: new Set(),
  expandedLocations: new Set(),
  selectedItems: [],
  mobileSelectionMode: false,
});

const cloneUiSnapshot = (snapshot) => ({
  ...snapshot,
  tableSort: { ...snapshot.tableSort },
  expandedBranches: new Set(snapshot.expandedBranches),
  expandedLocations: new Set(snapshot.expandedLocations),
  selectedItems: [...snapshot.selectedItems],
});


// Presentational layer: receives the composed view-model and renders JSX.
export default function DatabasePageView({ vm }) {
  const {
    actFeedMode,
    actFilePreview,
    actResults,
    actSearchError,
    actSearchLoading,
    actSearchTruncated,
    actionError,
    actionLoading,
    actionModal,
    actionWorkConsumableOptions,
    activeComponentOptions,
    addConsumableError,
    addConsumableForm,
    addConsumableLoading,
    addConsumableLocationOptions,
    addConsumableLocationsLoading,
    addConsumableModalOpen,
    addConsumableModelOptions,
    addConsumableModelsLoading,
    addConsumableSuccess,
    addEmployeeInput,
    addEmployeeLoading,
    addEmployeeOptions,
    addEquipmentError,
    addEquipmentForm,
    addEquipmentLoading,
    addEquipmentModalOpen,
    addEquipmentSuccess,
    addLocationOptions,
    addLocationsLoading,
    addModelOptions,
    addModelsLoading,
    addUsesManualEmployee,
    addUsesManualModel,
    batteryHistory,
    branchOptions,
    branches,
    buildWarehouseReturnContext,
    canAutoLoadMoreEquipment,
    canDatabaseDelete,
    canDatabaseWrite,
    canViewWarehouse1C,
    cartridgeHistory,
    cartridgeModel,
    cleaningHistory,
    clearActSearchError,
    clearRecentActs,
    clearRecentCards,
    clearSearch,
    closeActFilePreview,
    closeActionModal,
    closeAddConsumableModal,
    closeAddEquipmentModal,
    closeDeleteConsumableModal,
    closeDeleteEquipmentDialog,
    closeEditConsumableQtyModal,
    closeUploadActModal,
    componentHistory,
    componentType,
    confirmDeleteConsumable,
    confirmDeleteEquipment,
    consumableTypeOptions,
    currentDb,
    dataMode,
    dataVersionStale,
    databases,
    db_name,
    deleteConsumableError,
    deleteConsumableLoading,
    deleteConsumableTarget,
    deleteError,
    deleteLoading,
    deleteTarget,
    detailActFieldsOpen,
    detailActOpeningDocNo,
    detailActSelected,
    detailActSummary,
    detailActs,
    detailActsError,
    detailActsLoading,
    detailEditMode,
    detailError,
    detailForm,
    detailHasChanges,
    detailHistory,
    detailHistoryError,
    detailHistoryLoading,
    detailModal,
    detailModelsLoading,
    detailOpenedFromEmployee,
    detailQrFileName,
    detailQrOpen,
    detailQrText,
    detailQrUrl,
    detailQrUrlLoading,
    detailSaving,
    detailSuccess,
    detailTab,
    displayData,
    editConsumableQtyError,
    editConsumableQtyLoading,
    editConsumableQtyModal,
    editConsumableQtyValue,
    employeeCompareSummaries,
    employeeEquipmentDialog,
    employeeFallback,
    equipment,
    equipmentLoadMoreSentinelRef,
    equipmentPagesTotal,
    equipmentTypeOptions,
    expandedBranches,
    expandedLocations,
    fabSheetOpen,
    getUploadActEmailStatusItemSx,
    handleActSearchOpenFile,
    handleActSearchSelect,
    handleAction,
    handleActionConfirm,
    handleAddConsumableSubmit,
    handleAddEquipmentSubmit,
    handleBackToEmployeeEquipment,
    handleBranchChange,
    handleCheckboxChange,
    handleClearSelection,
    handleCloseActFields,
    handleCloseEmployeeEquipmentDialog,
    handleCloseEquipmentDetail,
    handleCollapseAll,
    handleCombinedSearchKeyDown,
    handleDataModeChange,
    handleDatabaseSelectChange,
    handleDetailCancel,
    handleDetailEditKeyDown,
    handleDetailSave,
    handleEditConsumableQtySubmit,
    handleIdentifyWorkspace,
    handleMobileCardSelect,
    handleOpenActFields,
    handleOpenActSearchEquipment,
    handleOpenBatteryForSelection,
    handleOpenCartridgeForSelection,
    handleOpenComponentForSelection,
    handleOpenEmployee,
    handleOpenEquipmentActFile,
    handleOpenEquipmentFromEmployee,
    handleOpenLocationTransferForSelection,
    handleOpenTransferActForSelection,
    handleOpenTransferForSelection,
    handleQrScannerClose,
    handleQrScannerOpen,
    handleRecentActOpen,
    handleRecentCardOpen,
    handleSearchChange,
    handleSearchScopeChange,
    handleSelectAll,
    handleTableSort,
    handleUploadActCommit,
    handleUploadActDownload,
    handleUploadActEmailSend,
    handleUploadActFileSelect,
    handleUploadActInvNosChange,
    handleUploadActParse,
    hasExpandedVisible,
    identifyPCLoading,
    initialLoading,
    isActsScope,
    isAdmin,
    isConsumablesMode,
    isMobile,
    isServerSearchActive,
    loadedCount,
    loadingMoreEquipment,
    locationOptions,
    mobileSelectionMode,
    modeLoading,
    modelOptions,
    newEmployee,
    nextEquipmentPage,
    openAddConsumableModal,
    openAddEquipmentModal,
    openDeleteConsumableModal,
    openEditConsumableQtyModal,
    openUploadActModal,
    openUploadActPreviewInNewTab,
    openUploadActReminderTask,
    patchAddConsumableForm,
    patchAddEquipmentForm,
    patchDetailForm,
    prefetchActSearchEquipment,
    qrBatchPrint,
    qrScannerError,
    qrScannerLoading,
    qrScannerOpen,
    qrScannerReady,
    qrScannerResult,
    recentActs,
    recentActsLoading,
    recentCards,
    recentCardsLoading,
    refreshCurrentDbData,
    refreshUploadActReminderStatus,
    removeRecentAct,
    removeRecentCard,
    resetAddConsumableModels,
    resetAddEquipmentModels,
    searchLoading,
    searchLoadingMore,
    searchQuery,
    searchScope,
    searchTotal,
    seededAct,
    selectedAddEmployeeOption,
    selectedBranch,
    selectedDatabaseName,
    selectedEmployeeOption,
    selectedHiddenCount,
    selectedItems,
    selectedItemsCapabilities,
    selectedItemsSet,
    selectedTransferEmployeeOption,
    selectedVisibleCount,
    selectedWorkConsumable,
    serverSearchDegraded,
    serverTotal,
    setAddConsumableError,
    setAddEmployeeInput,
    setAddEquipmentError,
    setComponentType,
    setDetailActsError,
    setDetailError,
    setDetailHistoryError,
    setDetailQrOpen,
    setDetailSuccess,
    setDetailTab,
    setEditConsumableQtyInput,
    setFabSheetOpen,
    setMobileSelectionMode,
    setSelectedWorkConsumable,
    setUploadActAutoEmail,
    setUploadActDownloadError,
    setUploadActEmailBody,
    setUploadActEmailError,
    setUploadActEmailRecipients,
    setUploadActEmailRecipientsInput,
    setUploadActEmailSubject,
    setUploadActError,
    setUploadActInvVerified,
    startDetailEdit,
    statusOptions,
    statuses,
    tableSort,
    theme,
    toggleBranch,
    toggleLocation,
    transferActionHandlers,
    transferBranchNo,
    transferDepartment,
    transferDepartmentLoading,
    transferDepartmentOptions,
    transferEmailError,
    transferEmailLoading,
    transferEmailMode,
    transferEmailStatus,
    transferEmployeeAutocompleteOptions,
    transferEmployeeInput,
    transferEmployeeInputTrimmed,
    transferEmployeeLoading,
    transferJobPolling,
    transferLocationNo,
    transferLocationOptions,
    transferLocationsLoading,
    transferManualEmail,
    transferOperationMode,
    transferRecipient,
    transferRecipientInput,
    transferRecipientLoading,
    transferRecipientOptions,
    transferResult,
    transferRetrySubmitting,
    transferSourceDefaults,
    transferUsesManualEmployee,
    typeOptions,
    ui,
    updateUploadActFormField,
    uploadActAutoEmail,
    uploadActCommitDisabled,
    uploadActCommitResult,
    uploadActCommitting,
    uploadActDownloadError,
    uploadActDownloading,
    uploadActDraft,
    uploadActEmailBody,
    uploadActEmailError,
    uploadActEmailLastRecipients,
    uploadActEmailLoading,
    uploadActEmailRecipientOptions,
    uploadActEmailRecipients,
    uploadActEmailRecipientsInput,
    uploadActEmailRecipientsLoading,
    uploadActEmailStatus,
    uploadActEmailSubject,
    uploadActEmailSummary,
    uploadActError,
    uploadActFile,
    uploadActForm,
    uploadActInvVerification,
    uploadActInvVerified,
    uploadActModalOpen,
    uploadActParsing,
    uploadActPreviewError,
    uploadActPreviewUrl,
    uploadActReminderBinding,
    uploadActReminderError,
    uploadActReminderLoading,
    uploadActStep,
    workConsumablesLoading,
  } = vm;

  const dataSections = useMemo(() => {
    if (Object.keys(displayData).length === 0) return null;
    return (
      <DatabaseDataSections
        displayData={displayData}
        expandedBranches={expandedBranches}
        expandedLocations={expandedLocations}
        isMobile={isMobile}
        theme={theme}
        selectedItemsSet={selectedItemsSet}
        tableSort={tableSort}
        onTableSort={handleTableSort}
        onSelectAll={handleSelectAll}
        onSelect={handleCheckboxChange}
        onAction={handleAction}
        onOpenEmployee={handleOpenEmployee}
        onOpenCurrentAct={handleOpenEquipmentActFile}
        openingCurrentActDocNo={detailActOpeningDocNo}
        onEditConsumableQty={canDatabaseWrite ? openEditConsumableQtyModal : null}
        onDeleteConsumable={canDatabaseDelete ? openDeleteConsumableModal : null}
        dataMode={dataMode}
        canWrite={canDatabaseWrite}
        canDelete={canDatabaseDelete}
        isAdmin={isAdmin}
        mobileSelectionMode={mobileSelectionMode}
        onMobileCardSelect={handleMobileCardSelect}
        onToggleBranch={toggleBranch}
        onToggleLocation={toggleLocation}
      />
    );
  }, [
    canDatabaseWrite,
    canDatabaseDelete,
    dataMode,
    displayData,
    expandedBranches,
    expandedLocations,
    handleAction,
    handleOpenEquipmentActFile,
    handleOpenEmployee,
    handleCheckboxChange,
    handleMobileCardSelect,
    handleSelectAll,
    handleTableSort,
    isAdmin,
    isMobile,
    detailActOpeningDocNo,
    mobileSelectionMode,
    openEditConsumableQtyModal,
    openDeleteConsumableModal,
    selectedItemsSet,
    tableSort,
    theme,
    toggleBranch,
    toggleLocation,
  ]);

  if (initialLoading) {
    return (
      <MainLayout headerMode={isMobile ? 'hidden' : 'default'} showDatabaseSelector>
        <PageShell>
          <LoadingSpinner message="Загрузка данных..." />
        </PageShell>
      </MainLayout>
    );
  }

  return (
    <MainLayout headerMode={isMobile ? 'hidden' : 'default'} showDatabaseSelector>
      <PageShell sx={{
        pb: isMobile
          ? `calc(var(--app-shell-mobile-bottom-nav-height, 64px) + ${!isConsumablesMode && selectedItems.length > 0 ? `${MOBILE_BAR_HEIGHT + MOBILE_BAR_GAP + 4}px` : '8px'})`
          : 3,
      }}>
        {isMobile && (
          <DatabaseMobileHeader
            databases={databases}
            dbName={db_name}
            currentDb={currentDb}
            selectedDatabaseName={selectedDatabaseName}
            onDatabaseSelectChange={handleDatabaseSelectChange}
          />
        )}

        <Paper
          elevation={0}
          sx={getOfficeActionTraySx(ui, {
            mb: isMobile ? 0.5 : 1.25,
            p: isMobile ? 0 : 0.25,
            borderRadius: '4px',
          })}
        >
          <Tabs
            value={dataMode}
            onChange={handleDataModeChange}
            variant="fullWidth"
            sx={{
              minHeight: isMobile ? 44 : 40,
              '& .MuiTab-root': {
                minHeight: isMobile ? 44 : 40,
                py: 0.35,
                fontSize: isMobile ? '0.78rem' : '0.875rem',
                textTransform: 'none',
                fontWeight: 500,
              },
              '& .MuiTabs-indicator': {
                height: 2,
                borderRadius: 1,
              },
            }}
          >
            <Tab value={DATA_MODE_EQUIPMENT} label="Оборудование" />
            <Tab value={DATA_MODE_CONSUMABLES} label="Расходники" />
          </Tabs>
        </Paper>

        <DatabaseSearchBar
          theme={theme}
          ui={ui}
          compact={isMobile}
          isConsumablesMode={isConsumablesMode}
          searchScope={searchScope}
          onSearchScopeChange={handleSearchScopeChange}
          value={searchQuery}
          onChange={handleSearchChange}
          onKeyDown={handleCombinedSearchKeyDown}
          onClear={clearSearch}
          loading={searchLoading}
          degraded={serverSearchDegraded}
        />

        {dataVersionStale && (
          <Alert
            severity="info"
            sx={{ mb: isMobile ? 0.5 : 1.25, borderRadius: '4px' }}
            action={(
              <Button
                color="inherit"
                size="small"
                onClick={() => void refreshCurrentDbData({ force: true })}
              >
                Обновить
              </Button>
            )}
          >
            Данные были изменены в другой сессии — список может быть неактуален.
          </Alert>
        )}

        <EmployeeCompareProvider summaries={employeeCompareSummaries}>
          {employeeFallback.active && (
            <Suspense fallback={null}>
              <DatabaseEmployeeSearchFallback
                {...employeeFallback}
                theme={theme}
                ui={ui}
                onOpenEmployee={handleOpenEmployee}
                onRetry={employeeFallback.retry}
              />
            </Suspense>
          )}
        </EmployeeCompareProvider>

        {isMobile && !isActsScope && (
          <DatabaseMobileControlStrip
            theme={theme}
            ui={ui}
            isConsumablesMode={isConsumablesMode}
            canDatabaseWrite={canDatabaseWrite}
            branches={branches}
            selectedBranch={selectedBranch}
            onBranchChange={handleBranchChange}
            hasExpandedVisible={hasExpandedVisible}
            onCollapseAll={handleCollapseAll}
            onOpenQrScanner={handleQrScannerOpen}
            onOpenUploadAct={openUploadActModal}
            onOpenAddEquipment={openAddEquipmentModal}
            onOpenAddConsumable={openAddConsumableModal}
            onOpenMore={() => setFabSheetOpen(true)}
          />
        )}

        {isActsScope ? (
          <>
            {isMobile ? (
              <DatabaseRecentActsStrip
                items={recentActs}
                loading={recentActsLoading}
                theme={theme}
                onOpen={handleRecentActOpen}
                onClear={clearRecentActs}
              />
            ) : (
              <Box sx={{ mb: 1.25 }}>
                <DatabaseRecentActs
                  items={recentActs}
                  loading={recentActsLoading}
                  theme={theme}
                  formatDate={formatDate}
                  onOpen={handleRecentActOpen}
                  onRemove={removeRecentAct}
                  onClear={clearRecentActs}
                  compact
                />
              </Box>
            )}
            <Suspense fallback={null}>
            <DatabaseActSearchResults
              theme={theme}
              ui={ui}
              query={searchQuery}
              results={actResults}
              seededAct={seededAct}
              loading={actSearchLoading}
              error={actSearchError}
              truncated={actSearchTruncated}
              feedMode={actFeedMode}
              formatDate={formatDate}
              onOpenEquipment={handleOpenActSearchEquipment}
              onPrefetchEquipment={prefetchActSearchEquipment}
              onSelectAct={handleActSearchSelect}
              onOpenActFile={handleActSearchOpenFile}
              onErrorClose={clearActSearchError}
            />
            </Suspense>
          </>
        ) : (
          <>
        {!isMobile && (
          <Box
            sx={{
              mb: 1.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
            }}
          >
            <DatabaseDesktopToolbar
              theme={theme}
              ui={ui}
              isConsumablesMode={isConsumablesMode}
              canDatabaseWrite={canDatabaseWrite}
              identifyPCLoading={identifyPCLoading}
              onOpenQrScanner={handleQrScannerOpen}
              onIdentifyWorkspace={handleIdentifyWorkspace}
              onOpenUploadAct={openUploadActModal}
              onOpenAddEquipment={openAddEquipmentModal}
              onOpenAddConsumable={openAddConsumableModal}
              branches={branches}
              selectedBranch={selectedBranch}
              onBranchChange={handleBranchChange}
              hasExpandedVisible={hasExpandedVisible}
              onCollapseAll={handleCollapseAll}
            />
            {!isConsumablesMode && (
              <DatabaseRecentCards
                items={recentCards}
                loading={recentCardsLoading}
                theme={theme}
                onOpen={handleRecentCardOpen}
                onRemove={removeRecentCard}
                onClear={clearRecentCards}
                compact
              />
            )}
          </Box>
        )}

        {isMobile && !isConsumablesMode && (
          <DatabaseRecentCardsStrip
            items={recentCards}
            loading={recentCardsLoading}
            theme={theme}
            onOpen={handleRecentCardOpen}
            onClear={clearRecentCards}
          />
        )}

        {isMobile && fabSheetOpen && (
          <Suspense fallback={null}>
          <DatabaseMobileActionSheet
            theme={theme}
            open={fabSheetOpen}
            onClose={() => setFabSheetOpen(false)}
            isConsumablesMode={isConsumablesMode}
            identifyWorkspaceLoading={identifyPCLoading}
            hasExpandedVisible={hasExpandedVisible}
            onIdentifyWorkspace={handleIdentifyWorkspace}
            onCollapseAll={handleCollapseAll}
            onEnterSelectionMode={() => setMobileSelectionMode(true)}
          />
          </Suspense>
        )}

        {isMobile && !isConsumablesMode && selectedItems.length > 0 && (
          <Suspense fallback={null}>
          <DatabaseBulkActionBar
            theme={theme}
            ui={ui}
            variant="mobile"
            selectedItemsCount={selectedItems.length}
            selectedVisibleCount={selectedVisibleCount}
            selectedHiddenCount={selectedHiddenCount}
            selectedItemsCapabilities={selectedItemsCapabilities}
            canWrite={canDatabaseWrite}
            desktopQuickPrintAvailable={qrBatchPrint.desktopQuickPrintAvailable}
            printing={qrBatchPrint.printing}
            onClearSelection={handleClearSelection}
            onQuickPrint={qrBatchPrint.printQuick}
            onPrintWithDialog={qrBatchPrint.printWithDialog}
            onOpenLocationTransfer={handleOpenLocationTransferForSelection}
            onOpenTransfer={handleOpenTransferForSelection}
            onOpenTransferAct={handleOpenTransferActForSelection}
            onOpenCartridge={handleOpenCartridgeForSelection}
            onOpenBattery={handleOpenBatteryForSelection}
            onOpenComponent={handleOpenComponentForSelection}
          />
          </Suspense>
        )}

        {!isMobile && !isConsumablesMode && selectedItems.length > 0 && (
          <Suspense fallback={null}>
          <DatabaseSelectionBar
            theme={theme}
            ui={ui}
            selectedItemsCount={selectedItems.length}
            selectedVisibleCount={selectedVisibleCount}
            selectedHiddenCount={selectedHiddenCount}
            selectedItemsCapabilities={selectedItemsCapabilities}
            canWrite={canDatabaseWrite}
            desktopQuickPrintAvailable={qrBatchPrint.desktopQuickPrintAvailable}
            printing={qrBatchPrint.printing}
            onClearSelection={handleClearSelection}
            onQuickPrint={qrBatchPrint.printQuick}
            onPrintWithDialog={qrBatchPrint.printWithDialog}
            onOpenLocationTransfer={handleOpenLocationTransferForSelection}
            onOpenTransfer={handleOpenTransferForSelection}
            onOpenTransferAct={handleOpenTransferActForSelection}
            onOpenCartridge={handleOpenCartridgeForSelection}
            onOpenBattery={handleOpenBatteryForSelection}
            onOpenComponent={handleOpenComponentForSelection}
          />
          </Suspense>
        )}

        <Fade key={dataMode} in timeout={{ enter: 320, exit: 160 }}>
          <Box
            sx={{
              animation: 'database-tab-slide 320ms ease',
              '@keyframes database-tab-slide': {
                from: { opacity: 0, transform: 'translateY(8px)' },
                to: { opacity: 1, transform: 'translateY(0)' },
              },
            }}
          >
            {modeLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240, py: 6 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
            <EmployeeCompareProvider summaries={employeeCompareSummaries}>
            {dataSections || (
              employeeFallback.active ? null :
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
            </EmployeeCompareProvider>
            {canAutoLoadMoreEquipment && (
              <Box
                ref={equipmentLoadMoreSentinelRef}
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
                  <Typography variant="caption" color="text.secondary">
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
        </Fade>
          </>
        )}

        <DatabaseDialogsLayer
          isMobile={isMobile}
          theme={theme}
          ui={ui}
          canDatabaseWrite={canDatabaseWrite}
          canViewWarehouse1C={canViewWarehouse1C}
          isAdmin={isAdmin}
          formatDate={formatDate}
          formatHistoryValue={formatHistoryValue}
          formatHistoryTransition={formatHistoryTransition}
          uploadAct={{
            modalOpen: uploadActModalOpen,
            onClose: closeUploadActModal,
            props: {
              step: uploadActStep,
              reminderBinding: uploadActReminderBinding,
              reminderLoading: uploadActReminderLoading,
              reminderError: uploadActReminderError,
              onOpenReminderTask: openUploadActReminderTask,
              onRefreshReminder: refreshUploadActReminderStatus,
              file: uploadActFile,
              previewUrl: uploadActPreviewUrl,
              previewError: uploadActPreviewError,
              onOpenPreview: openUploadActPreviewInNewTab,
              parsing: uploadActParsing,
              committing: uploadActCommitting,
              onFileSelect: handleUploadActFileSelect,
              onParse: handleUploadActParse,
              error: uploadActError,
              onErrorClear: () => setUploadActError(''),
              draft: uploadActDraft,
              form: uploadActForm,
              autoEmail: uploadActAutoEmail,
              invVerification: uploadActInvVerification,
              invVerified: uploadActInvVerified,
              onFieldChange: updateUploadActFormField,
              onInvNosChange: handleUploadActInvNosChange,
              onAutoEmailChange: setUploadActAutoEmail,
              onInvVerifiedChange: setUploadActInvVerified,
              commitResult: uploadActCommitResult,
              commitDisabled: uploadActCommitDisabled,
              onCommit: handleUploadActCommit,
              emailSubject: uploadActEmailSubject,
              emailBody: uploadActEmailBody,
              emailRecipientOptions: uploadActEmailRecipientOptions,
              emailRecipients: uploadActEmailRecipients,
              emailRecipientsInput: uploadActEmailRecipientsInput,
              emailRecipientsLoading: uploadActEmailRecipientsLoading,
              emailLoading: uploadActEmailLoading,
              emailStatus: uploadActEmailStatus,
              emailError: uploadActEmailError,
              emailLastRecipients: uploadActEmailLastRecipients,
              emailSummary: uploadActEmailSummary,
              onEmailSubjectChange: setUploadActEmailSubject,
              onEmailBodyChange: setUploadActEmailBody,
              onEmailRecipientsInputChange: setUploadActEmailRecipientsInput,
              onEmailRecipientsChange: setUploadActEmailRecipients,
              onEmailErrorClear: () => setUploadActEmailError(''),
              onEmailSend: handleUploadActEmailSend,
              getEmailStatusItemSx: getUploadActEmailStatusItemSx,
              downloading: uploadActDownloading,
              downloadError: uploadActDownloadError,
              onDownloadErrorClear: () => setUploadActDownloadError(''),
              onDownload: handleUploadActDownload,
            },
          }}
          addEquipment={{
            modalOpen: addEquipmentModalOpen,
            onClose: closeAddEquipmentModal,
            props: {
              form: addEquipmentForm,
              employeeOptions: addEmployeeOptions,
              employeeLoading: addEmployeeLoading,
              selectedEmployeeOption: selectedAddEmployeeOption,
              employeeInput: addEmployeeInput,
              branchOptions,
              locationOptions: addLocationOptions,
              locationsLoading: addLocationsLoading,
              typeOptions: equipmentTypeOptions,
              statusOptions,
              modelOptions: addModelOptions,
              modelsLoading: addModelsLoading,
              usesManualEmployee: addUsesManualEmployee,
              usesManualModel: addUsesManualModel,
              loading: addEquipmentLoading,
              error: addEquipmentError,
              success: addEquipmentSuccess,
              onEmployeeInputChange: setAddEmployeeInput,
              onEmployeeSelect: setAddEmployeeInput,
              onFormPatch: patchAddEquipmentForm,
              onErrorClear: () => setAddEquipmentError(''),
              onModelsReset: resetAddEquipmentModels,
              onSubmit: handleAddEquipmentSubmit,
            },
          }}
          addConsumable={{
            modalOpen: addConsumableModalOpen,
            onClose: closeAddConsumableModal,
            props: {
              form: addConsumableForm,
              branchOptions,
              locationOptions: addConsumableLocationOptions,
              locationsLoading: addConsumableLocationsLoading,
              typeOptions: consumableTypeOptions,
              modelOptions: addConsumableModelOptions,
              modelsLoading: addConsumableModelsLoading,
              loading: addConsumableLoading,
              error: addConsumableError,
              success: addConsumableSuccess,
              onFormPatch: patchAddConsumableForm,
              onErrorClear: () => setAddConsumableError(''),
              onModelsReset: resetAddConsumableModels,
              onSubmit: handleAddConsumableSubmit,
            },
          }}
          editConsumableQty={{
            modal: editConsumableQtyModal,
            props: {
              item: editConsumableQtyModal.item,
              value: editConsumableQtyValue,
              error: editConsumableQtyError,
              loading: editConsumableQtyLoading,
              onClose: closeEditConsumableQtyModal,
              onValueChange: setEditConsumableQtyInput,
              onSubmit: handleEditConsumableQtySubmit,
            },
          }}
          detail={{
            modal: detailModal,
            props: {
              loading: detailModal.loading,
              data: detailModal.data,
              form: detailForm,
              tab: detailTab,
              editMode: detailEditMode,
              saving: detailSaving,
              hasChanges: detailHasChanges,
              messages: {
                error: detailError,
                success: detailSuccess,
                actsError: detailActsError,
                historyError: detailHistoryError,
              },
              options: {
                statuses: statusOptions,
                types: equipmentTypeOptions,
                models: modelOptions,
                modelsLoading: detailModelsLoading,
                branches: branchOptions,
                locations: locationOptions,
              },
              acts: {
                items: detailActs,
                loading: detailActsLoading,
                openingDocNo: detailActOpeningDocNo,
              },
              history: {
                items: detailHistory,
                loading: detailHistoryLoading,
              },
              onClose: handleCloseEquipmentDetail,
              onBack: detailOpenedFromEmployee ? handleBackToEmployeeEquipment : null,
              onKeyDown: handleDetailEditKeyDown,
              onTabChange: setDetailTab,
              onFormPatch: patchDetailForm,
              onClearError: () => setDetailError(''),
              onClearSuccess: () => setDetailSuccess(''),
              onClearActsError: () => setDetailActsError(''),
              onClearHistoryError: () => setDetailHistoryError(''),
              onStartEdit: startDetailEdit,
              onCancel: handleDetailCancel,
              onSave: handleDetailSave,
              onOpenQr: () => setDetailQrOpen(true),
              onOpenActFields: handleOpenActFields,
              onOpenActFile: handleOpenEquipmentActFile,
              onOpenEmployee: handleOpenEmployee,
              buildWarehouseReturnContext,
              disableEnforceFocus: employeeEquipmentDialog.open && !detailOpenedFromEmployee,
              stackAboveParent: detailOpenedFromEmployee,
            },
          }}
          employeeDialog={{
            state: employeeEquipmentDialog,
            props: {
              disableEnforceFocus: detailOpenedFromEmployee,
              onClose: handleCloseEmployeeEquipmentDialog,
              onOpenInvNo: handleOpenEquipmentFromEmployee,
              buildWarehouseReturnContext,
            },
          }}
          actFields={{
            open: detailActFieldsOpen,
            props: {
              onClose: handleCloseActFields,
              selectedAct: detailActSelected,
              summary: detailActSummary,
              openingDocNo: detailActOpeningDocNo,
              onOpenFile: handleOpenEquipmentActFile,
            },
          }}
          actFilePreview={{
            state: actFilePreview,
            props: {
              title: actFilePreview?.title || 'Акт',
              subtitle: actFilePreview?.subtitle || '',
              kind: actFilePreview?.kind || 'pdf',
              objectUrl: actFilePreview?.objectUrl || '',
              loading: Boolean(actFilePreview?.loading),
              error: actFilePreview?.error || '',
              onClose: closeActFilePreview,
              onDownloadOriginal: actFilePreview?.previewBlob && actFilePreview?.objectUrl ? () => {
                const link = document.createElement('a');
                link.href = actFilePreview.objectUrl;
                link.download = actFilePreview.title || 'act.pdf';
                link.click();
              } : undefined,
              canDownloadOriginal: Boolean(actFilePreview?.previewBlob),
            },
          }}
          qrScanner={{
            open: qrScannerOpen,
            props: {
              onClose: handleQrScannerClose,
              loading: qrScannerLoading,
              ready: qrScannerReady,
              error: qrScannerError,
              result: qrScannerResult,
            },
          }}
          detailQr={{
            open: detailQrOpen,
            props: {
              onClose: () => setDetailQrOpen(false),
              loading: detailQrUrlLoading,
              url: detailQrUrl,
              text: detailQrText,
              fileName: detailQrFileName,
            },
          }}
          qrBatchPrint={qrBatchPrint}
          deleteEquipment={{
            target: deleteTarget,
            props: {
              error: deleteError,
              loading: deleteLoading,
              onClose: closeDeleteEquipmentDialog,
              onConfirm: () => void confirmDeleteEquipment(),
            },
          }}
          deleteConsumable={{
            target: deleteConsumableTarget,
            props: {
              error: deleteConsumableError,
              loading: deleteConsumableLoading,
              onClose: closeDeleteConsumableModal,
              onConfirm: () => void confirmDeleteConsumable(),
            },
          }}
          actionDialog={{
            open: actionModal.open,
            props: {
              actionModal,
              selectedCount: selectedItems.length,
              actionLoading,
              actionError,
              onClose: () => closeActionModal(),
              transferOperationMode,
              transferResult,
              transferContentProps: {
                isMobile,
                canDatabaseWrite,
                ui,
                theme,
                branchOptions,
                locationOptions: transferLocationOptions,
                sourceDefaults: transferSourceDefaults,
                transfer: {
                  mode: transferOperationMode,
                  result: transferResult,
                  jobPolling: transferJobPolling,
                  retrySubmitting: transferRetrySubmitting,
                  employeeInput: transferEmployeeInput,
                  employeeInputTrimmed: transferEmployeeInputTrimmed,
                  employeeOptions: transferEmployeeAutocompleteOptions,
                  employeeLoading: transferEmployeeLoading,
                  selectedEmployeeOption: selectedTransferEmployeeOption,
                  usesManualEmployee: transferUsesManualEmployee,
                  newEmployee,
                  department: transferDepartment,
                  departmentOptions: transferDepartmentOptions,
                  departmentLoading: transferDepartmentLoading,
                  branchNo: transferBranchNo,
                  locationNo: transferLocationNo,
                  locationsLoading: transferLocationsLoading,
                },
                email: {
                  mode: transferEmailMode,
                  manualEmail: transferManualEmail,
                  recipientInput: transferRecipientInput,
                  recipientOptions: transferRecipientOptions,
                  recipient: transferRecipient,
                  recipientLoading: transferRecipientLoading,
                  loading: transferEmailLoading,
                  status: transferEmailStatus,
                  error: transferEmailError,
                },
                actions: transferActionHandlers,
              },
              maintenanceContentProps: {
                ui,
                consumableOptions: actionWorkConsumableOptions,
                consumablesLoading: workConsumablesLoading,
                selectedConsumable: selectedWorkConsumable,
                onSelectedConsumableChange: setSelectedWorkConsumable,
                cartridgeModel,
                cartridgeHistory,
                batteryHistory,
                componentType,
                componentOptions: activeComponentOptions,
                onComponentTypeChange: setComponentType,
                componentHistory,
                cleaningHistory,
                formatDate,
              },
              onConfirm: () => void handleActionConfirm(),
            },
          }}
        />
      </PageShell>
    </MainLayout>
  );
}
