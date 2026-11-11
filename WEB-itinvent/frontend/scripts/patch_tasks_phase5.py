from pathlib import Path

path = Path(r'c:\Project\Image_scan\WEB-itinvent\frontend\src\pages\Tasks.jsx')
lines = path.read_text(encoding='utf-8').splitlines(keepends=True)

def idx(prefix, start=0):
    for i in range(start, len(lines)):
        if lines[i].startswith(prefix):
            return i
    raise ValueError(prefix)

# Replace analyticsFiltersContent block (3721-3933 1-based => 3720:3933)
start = idx('  const analyticsFiltersContent = (')
end = idx('  const mobileTasksCopy = {')
replacement = '''  const analyticsFiltersContent = (
    <TasksAnalyticsFiltersPanel
      ui={ui}
      analyticsAccentColor={analyticsAccentColor}
      analyticsFilters={analyticsFilters}
      onFiltersChange={setAnalyticsFilters}
      analyticsFilterFieldSx={analyticsFilterFieldSx}
      activeTaskProjects={activeTaskProjects}
      analyticsObjectOptions={analyticsObjectOptions}
      activeTaskObjects={activeTaskObjects}
      analyticsFocusMeta={analyticsFocusMeta}
      selectedAnalyticsParticipant={selectedAnalyticsParticipant}
      getAssigneePickerOptions={getAssigneePickerOptions}
      selectedAnalyticsParticipantOption={selectedAnalyticsParticipantOption}
      onParticipantChange={(participantId) => setAnalyticsFilters((prev) => ({ ...prev, participant_user_id: participantId }))}
      handleSingleAssigneeAutocompleteChange={handleSingleAssigneeAutocompleteChange}
      renderTaskUserOption={renderTaskUserOption}
      taskUserAutocompleteSlotProps={taskUserAutocompleteSlotProps}
      assigneeAutocompleteProps={assigneeAutocompleteProps}
      getAssigneeAutocompleteInputValue={getAssigneeAutocompleteInputValue}
    />
  );

'''
lines[start:end] = [replacement]

# Replace mobileTasksCopy
start = idx('  const mobileTasksCopy = {')
end = idx('  const mobileModeLabel = ')
lines[start:end] = ['  const mobileTasksCopy = TASKS_MOBILE_COPY;\n\n']

# Replace mobileCardMenuItems
start = idx('    const mobileCardMenuItems = [')
end = start + 1
while end < len(lines) and '].filter(Boolean);' not in lines[end]:
    end += 1
end += 1
lines[start:end] = [
    '    const mobileCardMenuItems = buildMobileTaskCardMenuItems({ canEdit, canDelete: canDeleteTask(task) });\n',
]

# Replace renderTaskListTableRow + simplify renderListView desktop branch
start = idx('  const renderTaskListTableRow = (task) => {')
end = idx('  const renderListView = () => {')
lines[start:end] = []

start = idx('    return isMobile ? renderMobileTaskFeedView() : (')
end = start + 1
while end < len(lines) and not lines[end].startswith('    <Card'):
    end += 1
# find closing `);` for renderListView - after Card block ends with `    );`
card_start = end
while end < len(lines) and lines[end].strip() != ');':
    end += 1
end += 1
replacement_list = '''    return isMobile ? renderMobileTaskFeedView() : (
      <TasksDesktopListView
        ui={ui}
        alpha={alpha}
        loading={loading}
        visibleTaskItems={visibleTaskItems}
        taskListSections={taskListSections}
        completedTasksOpen={completedTasksOpen}
        onToggleCompletedTasks={() => setCompletedTasksOpen((current) => !current)}
        taskDiscussionChatEnabled={taskDiscussionChatEnabled}
        activeTaskProjects={activeTaskProjects}
        onOpenTask={openTaskDetails}
      />
    );
'''
lines[card_start:end] = [replacement_list]

# Remove create mobile sheet block: title through isCreateTallMobileSheet
start = idx('  const createMobileSheetTitle = ({')
end = idx('  const mobileTasksHeaderInline = useMemo(() => {')
lines[start:end] = []

# Replace drawer block with TasksCreateMobileSheet
start = idx('        <Drawer\n', idx('        <Dialog\n', idx('          open={createOpen}')))
# find create-mobile-sheet-drawer
start = idx('        <Drawer\n', idx('          data-testid="create-mobile-sheet-drawer"'))
end = idx('        <Dialog\n', start)
create_sheet_component = '''        <TasksCreateMobileSheet
          open={Boolean(isMobile && createMobileSheet)}
          sheet={createMobileSheet}
          onClose={handleCloseCreateMobileSheet}
          ui={ui}
          theme={theme}
          bodyProps={{
            createOpen,
            ui,
            theme,
            createDescriptionRef,
            createDescriptionPreview,
            createData,
            handleCreateDescriptionDraftChange,
            handleCloseCreateMobileSheet,
            handleAddCreateFiles,
            handleChangeCreateAssigneeIds,
            handleClearCreateAssignees,
            searchCreateAssignees,
            resolveCreateAssignees,
            setCreateData,
            setCreateOptionalSections,
            setCreateMobileSheet,
            createSaving,
            createFiles,
            handleRemoveCreateFile,
            createChecklistItems,
            handleAddChecklistItem,
            handleUpdateChecklistItem,
            handleRemoveChecklistItem,
            effectiveCreateProjectId,
            activeTaskProjects,
            createProjectName,
            setCreateProjectName,
            handleCreateProjectFromTaskDialog,
            createProjectSaving,
            controllers,
            handleChangeCreateControllerId,
            handleClearCreateController,
            taskUsersLoading,
            taskUsersLoadError,
            loadTaskUserDirectories,
            handleChangeCreateObserverIds,
            handleClearCreateObservers,
            selectedCreateController,
            renderTaskUserOption,
            taskUserAutocompleteSlotProps,
            departments,
            selectedCreateDepartment,
          }}
        />

'''
lines[start:end] = [create_sheet_component]

path.write_text(''.join(lines), encoding='utf-8')
print('patched Tasks.jsx')
