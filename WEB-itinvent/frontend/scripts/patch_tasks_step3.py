from pathlib import Path

path = Path(r'c:\Project\Image_scan\WEB-itinvent\frontend\src\pages\Tasks.jsx')
lines = path.read_text(encoding='utf-8').splitlines(keepends=True)

def idx_contains(substr, start=0):
    for i in range(start, len(lines)):
        if substr in lines[i]:
            return i
    raise ValueError(substr)

start = idx_contains('const createMobileSheetTitle = ({')
end = idx_contains('const mobileTasksHeaderInline = useMemo(() => {')
lines[start:end] = []

start = idx_contains('data-testid="create-mobile-sheet-drawer"')
# back up to Drawer line
while not lines[start].lstrip().startswith('<Drawer'):
    start -= 1
end = idx_contains('open={editOpen}', start)
while not lines[end].lstrip().startswith('<Dialog'):
    end -= 1

component = '''        <TasksCreateMobileSheet
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
lines[start:end] = [component]
path.write_text(''.join(lines), encoding='utf-8')
print('step3 ok', start, end)
