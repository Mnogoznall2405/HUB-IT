import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import MainLayout from '../../components/layout/MainLayout';
import PageShell from '../../components/layout/PageShell';
import { LoadingSpinner } from '../../components/common';
import DatabaseAdSyncDialog from './DatabaseAdSyncDialog';
import DatabaseDbTransferDialog from './DatabaseDbTransferDialog';
import DatabaseDataSections from './DatabaseDataSections';
import { EmployeeCompareProvider } from './employeeCompareContext';
import { buildOneCStats, filterGroupedByOneC } from './databaseListModel';
import {
  ONE_C_MISMATCH_ACTION,
  OneCMarksProvider,
  getOneCMark,
  isOneCMarkAction,
  normalizeOneCMarkKey,
  useEquipmentOneCMarks,
} from './oneCMarksContext';
import OneCMismatchDialog from './OneCMismatchDialog';
import { useMissingPartNos } from './partNoCheck';
import { toInvNo } from './equipmentModel';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import DatabaseDialogsLayer from './DatabaseDialogsLayer';
import DatabaseMobileHeader from './DatabaseMobileHeader';
import DatabasePageHeader from './DatabasePageHeader';
import DatabaseScopeContent from './DatabaseScopeContent';
import DatabaseListSection from './DatabaseListSection';
import ListFilterBar from './ListFilterBar';
import useEquipmentPhotoReviewSummary from './useEquipmentPhotoReviewSummary';
import { normalizeDbId } from './databaseRecordModel';
import { MOBILE_BAR_GAP, MOBILE_BAR_HEIGHT } from './databaseMobileLayout';
import { formatDetailDate as formatDate } from './detailModel';
import { buildDialogsLayerProps } from './dialogsLayerProps';

const DatabaseEmployeeSearchFallback = lazy(() => import('./DatabaseEmployeeSearchFallback'));
const DatabaseEmployeeSearchResults = lazy(() => import('./DatabaseEmployeeSearchResults'));
const EquipmentPhotoReviewDialog = lazy(() => import('./EquipmentPhotoReviewDialog'));
const EquipmentQualityDialog = lazy(() => import('./EquipmentQualityDialog'));


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
    adSyncError,
    adSyncOpen,
    adSyncResult,
    adSyncRunning,
    dbTransferError,
    dbTransferOpen,
    dbTransferResult,
    dbTransferRunning,
    batteryHistory,
    branchOptions,
    branches,
    buildWarehouseReturnContext,
    canAdSync,
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
    closeAdSync,
    closeDbTransfer,
    closeActionModal,
    closeAddConsumableModal,
    closeAddEquipmentModal,
    closeDeleteConsumableModal,
    closeDeleteEquipmentDialog,
    closeEditConsumableQtyModal,
    closeUploadActModal,
    componentHistory,
    componentType,
    confirmAdSync,
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
    consumableQr,
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
    displayData: listDisplayData,
    loadMoreNow,
    photoFilter,
    listFilterActive,
    photoStats,
    setPhotoFilter,
    actFilter,
    actStats,
    oneCFilter,
    setOneCFilter,
    baseDisplayData,
    setActFilter,
    editConsumableQtyError,
    editConsumableQtyLoading,
    editConsumableQtyModal,
    editConsumableQtyValue,
    employeeCompareSummaries,
    employeeEquipmentDialog,
    employeeFallback,
    employeeSearch,
    equipment,
    equipmentLoadMoreSentinelRef,
    equipmentPagesTotal,
    equipmentTypeOptions,
    expandedBranches,
    expandedCards,
    expandedLocations,
    fabSheetOpen,
    findEquipmentByInvNo,
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
    handleExpandAll,
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
    hasCollapsedVisible,
    identifyPCLoading,
    initialLoading,
    isActsScope,
    canDeleteEquipment,
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
    openCartridgeCompatibilityDialog,
    openAdSync,
    openDbTransfer,
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
    searchTypeNo,
    searchField,
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
    submitDbTransfer,
    setDetailSuccess,
    setDetailTab,
    setEditConsumableQtyInput,
    setFabSheetOpen,
    setMobileSelectionMode,
    setSearchTypeNo,
    setSearchField,
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
    canPhotoVerify,
    handleOpenEquipmentFromPhotoReview,
  } = vm;

  const [photoReviewOpen, setPhotoReviewOpen] = useState(false);
  const photoReviewDbId = normalizeDbId(
    typeof window !== 'undefined' ? window.localStorage.getItem('selected_database') : '',
  );
  const photoReviewEnabled = Boolean(canPhotoVerify) && !isConsumablesMode;

  const { hasPermission } = useAuth();
  const { notifySuccess, notifyError } = useNotification();
  const oneCMarks = useEquipmentOneCMarks({
    dbKey: photoReviewDbId,
    enabled: !isConsumablesMode,
    canMark: hasPermission('database.one_c_mark'),
    notifySuccess,
    notifyError,
  });
  const applyOneCMarkAction = oneCMarks.applyAction;
  // Проверка PART_NO по номенклатуре 1С (локальный снимок): строки с несуществующим кодом подсвечиваются.
  const missingPartNos = useMissingPartNos({
    dbKey: photoReviewDbId,
    enabled: !isConsumablesMode,
    groupedData: baseDisplayData,
  });
  const oneCValue = useMemo(
    () => ({ ...oneCMarks.value, missingPartNos }),
    [oneCMarks.value, missingPartNos],
  );
  const [mismatchTarget, setMismatchTarget] = useState(null);

  // Фильтр «1С»: значок в таблице считается из сводки сверки и ручных отметок, поэтому
  // применяется здесь, а не в контроллере списка. Счётчики — по всем загруженным строкам.
  const oneCContext = useMemo(() => {
    const summaryByOwner = new Map();
    for (const entry of Array.isArray(employeeCompareSummaries) ? employeeCompareSummaries : []) {
      const ownerNo = Number(entry?.owner_no);
      if (Number.isInteger(ownerNo) && ownerNo > 0) summaryByOwner.set(ownerNo, entry);
    }
    return { summaryByOwner, marks: oneCMarks.value.marks, missingPartNos };
  }, [employeeCompareSummaries, oneCMarks.value.marks, missingPartNos]);
  const oneCStats = useMemo(
    () => (isConsumablesMode ? null : buildOneCStats(baseDisplayData, oneCContext)),
    [baseDisplayData, isConsumablesMode, oneCContext],
  );
  const displayData = useMemo(
    () => (isConsumablesMode ? listDisplayData : filterGroupedByOneC(listDisplayData, oneCFilter, oneCContext)),
    [isConsumablesMode, listDisplayData, oneCContext, oneCFilter],
  );
  const handleRowAction = useCallback((actionType, itemOrInvNo) => {
    if (actionType === ONE_C_MISMATCH_ACTION) {
      const invNo = normalizeOneCMarkKey(
        typeof itemOrInvNo === 'object' && itemOrInvNo ? toInvNo(itemOrInvNo) : itemOrInvNo,
      );
      if (invNo) setMismatchTarget({ invNo, note: getOneCMark(oneCMarks.value, invNo)?.note || '' });
      return;
    }
    if (isOneCMarkAction(actionType)) {
      void applyOneCMarkAction(actionType, itemOrInvNo);
      return;
    }
    handleAction(actionType, itemOrInvNo);
  }, [applyOneCMarkAction, handleAction, oneCMarks.value]);
  const { summary: photoReviewSummary, refresh: refreshPhotoReviewSummary } = useEquipmentPhotoReviewSummary({
    enabled: photoReviewEnabled,
    dbId: photoReviewDbId,
  });

  // Карточка, открытая из списка («Качество данных», очередь проверки фото), ложится поверх него:
  // список остаётся открытым со своим фильтром, поиском и прокруткой, «Назад» возвращает к нему.
  const [openedFromList, setOpenedFromList] = useState(false);
  const [listReloadToken, setListReloadToken] = useState(0);

  const [qualityOpen, setQualityOpen] = useState(false);
  const handleOpenQuality = useCallback(() => setQualityOpen(true), []);
  const handleCloseQuality = useCallback(() => setQualityOpen(false), []);
  const handleOpenEquipmentFromQuality = useCallback((invNo, options) => {
    setOpenedFromList(true);
    handleOpenEquipmentFromPhotoReview?.(invNo, options);
  }, [handleOpenEquipmentFromPhotoReview]);

  const handleOpenPhotoReview = useCallback(() => setPhotoReviewOpen(true), []);
  const handleClosePhotoReview = useCallback(() => {
    setPhotoReviewOpen(false);
    void refreshPhotoReviewSummary({ force: true });
  }, [refreshPhotoReviewSummary]);
  const handleOpenEquipmentFromReview = useCallback((invNo) => {
    setOpenedFromList(true);
    handleOpenEquipmentFromPhotoReview?.(invNo);
  }, [handleOpenEquipmentFromPhotoReview]);

  const handleBackToList = useCallback(() => {
    setOpenedFromList(false);
    vm.handleDetailClose?.();
    setListReloadToken((token) => token + 1);
  }, [vm.handleDetailClose]);

  // Карточку закрыли иным путём (удаление и т. п.): список обновляем, режим «поверх списка» снимаем.
  const detailIsOpen = Boolean(detailModal?.open);
  useEffect(() => {
    if (!detailIsOpen && openedFromList) {
      setOpenedFromList(false);
      setListReloadToken((token) => token + 1);
    }
  }, [detailIsOpen, openedFromList]);

  const dialogsLayerProps = buildDialogsLayerProps(
    openedFromList
      ? {
        ...vm,
        detailOpenedFromEmployee: true,
        handleBackToEmployeeEquipment: handleBackToList,
        handleCloseEquipmentDetail: handleBackToList,
      }
      : vm,
    { isMobile, theme, ui },
  );

  const dbTransferItems = useMemo(
    () => (Array.isArray(selectedItems) ? selectedItems : [])
      .map((invNo) => findEquipmentByInvNo?.(invNo) || { inv_no: invNo }),
    [selectedItems, findEquipmentByInvNo],
  );

  const handleDbTransferDataChanged = () => {
    handleClearSelection?.();
    void refreshCurrentDbData?.({ force: true });
  };

  const dataSections = useMemo(() => {
    if (Object.keys(displayData).length === 0) return null;
    return (
      <DatabaseDataSections
        displayData={displayData}
        photoStats={photoStats}
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
        onAction={handleRowAction}
        onOpenEmployee={handleOpenEmployee}
        onOpenCurrentAct={handleOpenEquipmentActFile}
        openingCurrentActDocNo={detailActOpeningDocNo}
        onEditConsumableQty={canDatabaseWrite ? openEditConsumableQtyModal : null}
        onDeleteConsumable={canDatabaseDelete ? openDeleteConsumableModal : null}
        onShowConsumableQr={consumableQr?.openConsumableQr}
        dataMode={dataMode}
        canWrite={canDatabaseWrite}
        canDelete={canDatabaseDelete}
        canDeleteEquipment={canDeleteEquipment}
        mobileSelectionMode={mobileSelectionMode}
        onMobileCardSelect={handleMobileCardSelect}
        onToggleBranch={toggleBranch}
        onToggleLocation={toggleLocation}
      />
    );
  }, [
    canDatabaseWrite,
    canDatabaseDelete,
    consumableQr,
    dataMode,
    displayData,
    expandedBranches,
    expandedCards,
    expandedLocations,
    handleRowAction,
    handleOpenEquipmentActFile,
    handleOpenEmployee,
    handleCheckboxChange,
    handleMobileCardSelect,
    handleSelectAll,
    handleTableSort,
    canDeleteEquipment,
    isMobile,
    detailActOpeningDocNo,
    mobileSelectionMode,
    photoStats,
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
      <MainLayout headerMode={isMobile ? 'hidden' : 'integrated'} showDatabaseSelector={isMobile}>
        <PageShell>
          <LoadingSpinner message="Загрузка данных..." />
        </PageShell>
      </MainLayout>
    );
  }

  return (
    <MainLayout
      headerMode={isMobile ? 'hidden' : 'integrated'}
      showDatabaseSelector={isMobile}
    >
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
          searchLoading={searchLoading || employeeSearch.loading}
          serverSearchDegraded={searchScope === 'equipment' && serverSearchDegraded}
          searchTypeNo={searchTypeNo}
          onSearchTypeChange={setSearchTypeNo}
          typeOptions={equipmentTypeOptions}
          searchField={searchField}
          onSearchFieldChange={setSearchField}
          dataVersionStale={dataVersionStale}
          onRefreshData={() => void refreshCurrentDbData({ force: true })}
          databases={databases}
          currentDb={currentDb}
          dbName={db_name}
          selectedDatabaseName={selectedDatabaseName}
          onDatabaseSelectChange={handleDatabaseSelectChange}
        />

        <EmployeeCompareProvider summaries={employeeCompareSummaries}>
        <OneCMarksProvider value={oneCValue}>
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

        {employeeSearch.active && !employeeFallback.active && (
          <Suspense fallback={null}>
            <DatabaseEmployeeSearchResults search={employeeSearch} onOpenEmployee={handleOpenEmployee} />
          </Suspense>
        )}
        <DatabaseScopeContent
          theme={theme}
          ui={ui}
          isMobile={isMobile}
          isActsScope={isActsScope}
          isConsumablesMode={isConsumablesMode}
          canDatabaseWrite={canDatabaseWrite}
          canAdSync={canAdSync}
          onOpenAdSync={openAdSync}
          branches={branches}
          selectedBranch={selectedBranch}
          onBranchChange={handleBranchChange}
          hasExpandedVisible={hasExpandedVisible}
          hasCollapsedVisible={hasCollapsedVisible}
          onCollapseAll={handleCollapseAll}
          onExpandAll={handleExpandAll}
          onOpenQrScanner={handleQrScannerOpen}
          onIdentifyWorkspace={handleIdentifyWorkspace}
          identifyPCLoading={identifyPCLoading}
          onOpenUploadAct={openUploadActModal}
          onOpenAddEquipment={openAddEquipmentModal}
          onOpenAddConsumable={openAddConsumableModal}
          onOpenConsumableQrPrint={consumableQr?.openConsumableQrPrintBatch}
          onOpenCartridgeCompatibility={openCartridgeCompatibilityDialog}
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
          onPrintWithDialog={qrBatchPrint.openPrintOptions}
          onOpenLocationTransfer={handleOpenLocationTransferForSelection}
          onOpenTransfer={handleOpenTransferForSelection}
          onOpenDbTransfer={openDbTransfer}
          onOpenTransferAct={handleOpenTransferActForSelection}
          onOpenCartridge={handleOpenCartridgeForSelection}
          onOpenBattery={handleOpenBatteryForSelection}
          onOpenComponent={handleOpenComponentForSelection}
        >
          {!isConsumablesMode && !employeeFallback.active && (
            <ListFilterBar
              photoValue={photoFilter}
              onPhotoChange={setPhotoFilter}
              photoStats={photoStats}
              actValue={actFilter}
              onActChange={setActFilter}
              actStats={actStats}
              oneCValue={oneCFilter}
              onOneCChange={setOneCFilter}
              oneCStats={oneCStats}
              isMobile={isMobile}
              onOpenReview={photoReviewEnabled ? handleOpenPhotoReview : null}
              reviewSummary={photoReviewSummary}
              onOpenQuality={handleOpenQuality}
            />
          )}
          <DatabaseListSection
            photoFilterActive={listFilterActive}
            canLoadMoreManually={canAutoLoadMoreEquipment}
            onLoadMore={loadMoreNow}
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
        </OneCMarksProvider>
        </EmployeeCompareProvider>

        <DatabaseDialogsLayer {...dialogsLayerProps} />

        <OneCMismatchDialog
          open={Boolean(mismatchTarget)}
          invNo={mismatchTarget?.invNo || ''}
          initialNote={mismatchTarget?.note || ''}
          onClose={() => setMismatchTarget(null)}
          onSave={(note) => oneCMarks.saveMismatch(mismatchTarget?.invNo, note)}
        />

        {qualityOpen ? (
          <Suspense fallback={null}>
            <EquipmentQualityDialog
              open
              dbId={photoReviewDbId}
              canWrite={canDatabaseWrite}
              canDeleteEquipment={canDeleteEquipment}
              reloadToken={listReloadToken}
              onClose={handleCloseQuality}
              onOpenEquipment={handleOpenEquipmentFromQuality}
            />
          </Suspense>
        ) : null}

        {photoReviewEnabled && photoReviewOpen ? (
          <Suspense fallback={null}>
            <EquipmentPhotoReviewDialog
              open
              dbId={photoReviewDbId}
              reloadToken={listReloadToken}
              onClose={handleClosePhotoReview}
              onOpenEquipment={handleOpenEquipmentFromReview}
              onChanged={() => { void refreshPhotoReviewSummary({ force: true }); }}
            />
          </Suspense>
        ) : null}

        <DatabaseAdSyncDialog
          open={adSyncOpen}
          running={adSyncRunning}
          result={adSyncResult}
          error={adSyncError}
          databases={databases}
          onClose={closeAdSync}
          onConfirm={confirmAdSync}
        />

        <DatabaseDbTransferDialog
          open={dbTransferOpen}
          running={dbTransferRunning}
          result={dbTransferResult}
          error={dbTransferError}
          items={dbTransferItems}
          databases={databases}
          currentDb={db_name || String(currentDb?.id || '')}
          onClose={closeDbTransfer}
          onSubmit={submitDbTransfer}
          onDataChanged={handleDbTransferDataChanged}
        />
      </PageShell>
    </MainLayout>
  );
}
