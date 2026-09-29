import { lazy, Suspense } from 'react';
import { Box } from '@mui/material';

import DatabaseDesktopToolbar from './DatabaseDesktopToolbar';
import DatabaseMobileControlStrip from './DatabaseMobileControlStrip';
import DatabaseRecentCards from './DatabaseRecentCards';
import DatabaseRecentCardsStrip from './DatabaseRecentCardsStrip';
import DatabaseRecentActs from './DatabaseRecentActs';
import DatabaseRecentActsStrip from './DatabaseRecentActsStrip';

const DatabaseActSearchResults = lazy(() => import('./DatabaseActSearchResults'));
const DatabaseMobileActionSheet = lazy(() => import('./DatabaseMobileActionSheet'));
const DatabaseBulkActionBar = lazy(() => import('./DatabaseBulkActionBar'));

// Chrome around the list: mobile control strip, recent cards/acts strips,
// desktop toolbar, FAB action sheet, selection action bar and the acts-scope
// results block. The list itself is passed as children.
export default function DatabaseScopeContent({
  theme,
  ui,
  isMobile,
  isActsScope,
  isConsumablesMode,
  canDatabaseWrite,
  canAdSync = false,
  onOpenAdSync,
  branches,
  selectedBranch,
  onBranchChange,
  hasExpandedVisible,
  onCollapseAll,
  onOpenQrScanner,
  onIdentifyWorkspace,
  identifyPCLoading,
  onOpenUploadAct,
  onOpenAddEquipment,
  onOpenAddConsumable,
  onOpenConsumableQrPrint = null,
  onOpenCartridgeCompatibility = null,
  onOpenMore,
  recentActs,
  recentActsLoading,
  onRecentActOpen,
  onRemoveRecentAct,
  onClearRecentActs,
  recentCards,
  recentCardsLoading,
  onRecentCardOpen,
  onRemoveRecentCard,
  onClearRecentCards,
  formatDate,
  searchQuery,
  actResults,
  seededAct,
  actSearchLoading,
  actSearchError,
  actSearchTruncated,
  actFeedMode,
  onOpenActSearchEquipment,
  onPrefetchActSearchEquipment,
  onActSearchSelect,
  onOpenActFile,
  onActSearchErrorClose,
  fabSheetOpen,
  onFabSheetClose,
  onEnterSelectionMode,
  selectedItemsCount,
  selectedVisibleCount,
  selectedHiddenCount,
  selectedItemsCapabilities,
  desktopQuickPrintAvailable,
  printing,
  onClearSelection,
  onQuickPrint,
  onPrintWithDialog,
  onOpenLocationTransfer,
  onOpenTransfer,
  onOpenTransferAct,
  onOpenDbTransfer,
  onOpenCartridge,
  onOpenBattery,
  onOpenComponent,
  children,
}) {
  return (
    <>
      {isMobile && !isActsScope && (
        <DatabaseMobileControlStrip
          theme={theme}
          ui={ui}
          isConsumablesMode={isConsumablesMode}
          canDatabaseWrite={canDatabaseWrite}
          branches={branches}
          selectedBranch={selectedBranch}
          onBranchChange={onBranchChange}
          hasExpandedVisible={hasExpandedVisible}
          onCollapseAll={onCollapseAll}
          onOpenQrScanner={onOpenQrScanner}
          onOpenUploadAct={onOpenUploadAct}
          onOpenAddEquipment={onOpenAddEquipment}
          onOpenAddConsumable={onOpenAddConsumable}
          onOpenConsumableQrPrint={onOpenConsumableQrPrint}
          onOpenCartridgeCompatibility={onOpenCartridgeCompatibility}
          onOpenMore={onOpenMore}
        />
      )}

      {isActsScope ? (
        <>
          {isMobile ? (
            <DatabaseRecentActsStrip
              items={recentActs}
              loading={recentActsLoading}
              theme={theme}
              onOpen={onRecentActOpen}
              onClear={onClearRecentActs}
            />
          ) : (
            <Box sx={{ mb: 1.25 }}>
              <DatabaseRecentActs
                items={recentActs}
                loading={recentActsLoading}
                theme={theme}
                formatDate={formatDate}
                onOpen={onRecentActOpen}
                onRemove={onRemoveRecentAct}
                onClear={onClearRecentActs}
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
            onOpenEquipment={onOpenActSearchEquipment}
            onPrefetchEquipment={onPrefetchActSearchEquipment}
            onSelectAct={onActSearchSelect}
            onOpenActFile={onOpenActFile}
            onErrorClose={onActSearchErrorClose}
          />
          </Suspense>
        </>
      ) : (
        <>
          {!isMobile && (
            <Box sx={{ mb: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <DatabaseDesktopToolbar
                theme={theme}
                ui={ui}
                isConsumablesMode={isConsumablesMode}
                canDatabaseWrite={canDatabaseWrite}
                canAdSync={canAdSync}
                onOpenAdSync={onOpenAdSync}
                identifyPCLoading={identifyPCLoading}
                onOpenQrScanner={onOpenQrScanner}
                onIdentifyWorkspace={onIdentifyWorkspace}
                onOpenUploadAct={onOpenUploadAct}
                onOpenAddEquipment={onOpenAddEquipment}
                onOpenAddConsumable={onOpenAddConsumable}
                onOpenConsumableQrPrint={onOpenConsumableQrPrint}
                onOpenCartridgeCompatibility={onOpenCartridgeCompatibility}
                branches={branches}
                selectedBranch={selectedBranch}
                onBranchChange={onBranchChange}
                hasExpandedVisible={hasExpandedVisible}
                onCollapseAll={onCollapseAll}
              />
              {!isConsumablesMode && (
                <DatabaseRecentCards
                  items={recentCards}
                  loading={recentCardsLoading}
                  theme={theme}
                  onOpen={onRecentCardOpen}
                  onRemove={onRemoveRecentCard}
                  onClear={onClearRecentCards}
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
              onOpen={onRecentCardOpen}
              onClear={onClearRecentCards}
            />
          )}

          {isMobile && fabSheetOpen && (
            <Suspense fallback={null}>
            <DatabaseMobileActionSheet
              theme={theme}
              open={fabSheetOpen}
              onClose={onFabSheetClose}
              isConsumablesMode={isConsumablesMode}
              canAdSync={canAdSync}
              onOpenAdSync={onOpenAdSync}
              identifyWorkspaceLoading={identifyPCLoading}
              hasExpandedVisible={hasExpandedVisible}
              onIdentifyWorkspace={onIdentifyWorkspace}
              onCollapseAll={onCollapseAll}
              onEnterSelectionMode={onEnterSelectionMode}
            />
            </Suspense>
          )}

          {!isConsumablesMode && selectedItemsCount > 0 && (
            <Suspense fallback={null}>
            <DatabaseBulkActionBar
              theme={theme}
              ui={ui}
              variant={isMobile ? 'mobile' : 'desktop'}
              selectedItemsCount={selectedItemsCount}
              selectedVisibleCount={selectedVisibleCount}
              selectedHiddenCount={selectedHiddenCount}
              selectedItemsCapabilities={selectedItemsCapabilities}
              canWrite={canDatabaseWrite}
              desktopQuickPrintAvailable={desktopQuickPrintAvailable}
              printing={printing}
              onClearSelection={onClearSelection}
              onQuickPrint={onQuickPrint}
              onPrintWithDialog={onPrintWithDialog}
              onOpenLocationTransfer={onOpenLocationTransfer}
              onOpenTransfer={onOpenTransfer}
              onOpenTransferAct={onOpenTransferAct}
              onOpenDbTransfer={onOpenDbTransfer}
              onOpenCartridge={onOpenCartridge}
              onOpenBattery={onOpenBattery}
              onOpenComponent={onOpenComponent}
            />
            </Suspense>
          )}

          {children}
        </>
      )}
    </>
  );
}
