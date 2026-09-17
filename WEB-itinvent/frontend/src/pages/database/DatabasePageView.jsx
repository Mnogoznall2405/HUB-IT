import { useMemo, lazy, Suspense } from 'react';
import MainLayout from '../../components/layout/MainLayout';
import PageShell from '../../components/layout/PageShell';
import { LoadingSpinner } from '../../components/common';
import DatabaseDataSections from './DatabaseDataSections';
import { EmployeeCompareProvider } from './employeeCompareContext';
import DatabaseDialogsLayer from './DatabaseDialogsLayer';
import DatabaseMobileHeader from './DatabaseMobileHeader';
import DatabasePageHeader from './DatabasePageHeader';
import DatabaseScopeContent from './DatabaseScopeContent';
import DatabaseListSection from './DatabaseListSection';
import { MOBILE_BAR_GAP, MOBILE_BAR_HEIGHT } from './databaseMobileLayout';
import { formatDetailDate as formatDate } from './detailModel';
import { buildDialogsLayerProps } from './dialogsLayerProps';

const DatabaseEmployeeSearchFallback = lazy(() => import('./DatabaseEmployeeSearchFallback'));


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
    expandedCards,
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
    toggleCardExpanded,
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
        expandedCards={expandedCards}
        onToggleCardExpand={toggleCardExpanded}
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
    expandedCards,
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
    toggleCardExpanded,
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

        <DatabasePageHeader
          theme={theme}
          ui={ui}
          isMobile={isMobile}
          dataMode={dataMode}
          onDataModeChange={handleDataModeChange}
          isConsumablesMode={isConsumablesMode}
          searchScope={searchScope}
          onSearchScopeChange={handleSearchScopeChange}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onSearchKeyDown={handleCombinedSearchKeyDown}
          onSearchClear={clearSearch}
          searchLoading={searchLoading}
          serverSearchDegraded={serverSearchDegraded}
          dataVersionStale={dataVersionStale}
          onRefreshData={() => void refreshCurrentDbData({ force: true })}
        />

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

        <DatabaseScopeContent
          theme={theme}
          ui={ui}
          isMobile={isMobile}
          isActsScope={isActsScope}
          isConsumablesMode={isConsumablesMode}
          canDatabaseWrite={canDatabaseWrite}
          branches={branches}
          selectedBranch={selectedBranch}
          onBranchChange={handleBranchChange}
          hasExpandedVisible={hasExpandedVisible}
          onCollapseAll={handleCollapseAll}
          onOpenQrScanner={handleQrScannerOpen}
          onIdentifyWorkspace={handleIdentifyWorkspace}
          identifyPCLoading={identifyPCLoading}
          onOpenUploadAct={openUploadActModal}
          onOpenAddEquipment={openAddEquipmentModal}
          onOpenAddConsumable={openAddConsumableModal}
          onOpenMore={() => setFabSheetOpen(true)}
          recentActs={recentActs}
          recentActsLoading={recentActsLoading}
          onRecentActOpen={handleRecentActOpen}
          onRemoveRecentAct={removeRecentAct}
          onClearRecentActs={clearRecentActs}
          recentCards={recentCards}
          recentCardsLoading={recentCardsLoading}
          onRecentCardOpen={handleRecentCardOpen}
          onRemoveRecentCard={removeRecentCard}
          onClearRecentCards={clearRecentCards}
          formatDate={formatDate}
          searchQuery={searchQuery}
          actResults={actResults}
          seededAct={seededAct}
          actSearchLoading={actSearchLoading}
          actSearchError={actSearchError}
          actSearchTruncated={actSearchTruncated}
          actFeedMode={actFeedMode}
          onOpenActSearchEquipment={handleOpenActSearchEquipment}
          onPrefetchActSearchEquipment={prefetchActSearchEquipment}
          onActSearchSelect={handleActSearchSelect}
          onOpenActFile={handleActSearchOpenFile}
          onActSearchErrorClose={clearActSearchError}
          fabSheetOpen={fabSheetOpen}
          onFabSheetClose={() => setFabSheetOpen(false)}
          onEnterSelectionMode={() => setMobileSelectionMode(true)}
          selectedItemsCount={selectedItems.length}
          selectedVisibleCount={selectedVisibleCount}
          selectedHiddenCount={selectedHiddenCount}
          selectedItemsCapabilities={selectedItemsCapabilities}
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
        >
          <DatabaseListSection
            dataMode={dataMode}
            modeLoading={modeLoading}
            dataSections={dataSections}
            employeeFallbackActive={employeeFallback.active}
            selectedBranch={selectedBranch}
            canAutoLoadMoreEquipment={canAutoLoadMoreEquipment}
            loadMoreSentinelRef={equipmentLoadMoreSentinelRef}
            isServerSearchActive={isServerSearchActive}
            searchLoadingMore={searchLoadingMore}
            loadingMoreEquipment={loadingMoreEquipment}
            displayData={displayData}
            searchTotal={searchTotal}
            loadedCount={loadedCount}
            serverTotal={serverTotal}
            nextEquipmentPage={nextEquipmentPage}
            equipmentPagesTotal={equipmentPagesTotal}
          />
        </DatabaseScopeContent>
        </EmployeeCompareProvider>

        <DatabaseDialogsLayer {...buildDialogsLayerProps(vm, { isMobile, theme, ui })} />
      </PageShell>
    </MainLayout>
  );
}
