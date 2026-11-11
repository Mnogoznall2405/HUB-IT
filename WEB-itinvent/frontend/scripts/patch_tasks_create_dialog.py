from pathlib import Path

path = Path(r'c:\Project\Image_scan\WEB-itinvent\frontend\src\pages\Tasks.jsx')
text = path.read_text(encoding='utf-8')
lines = text.splitlines(keepends=True)

start = None
end = None
for i, line in enumerate(lines):
    if line.startswith('        <Dialog\n') and 'open={createOpen}' in ''.join(lines[i:i+3]):
        start = i
    if start is not None and line.strip() == '</Dialog>' and i > start:
        # first closing Dialog after create - verify it's create dialog by checking nearby createSaving
        chunk = ''.join(lines[start:i+1])
        if 'handleCreateTask' in chunk or 'onClick={handleCreateTask}' in chunk:
            end = i + 1
            break

if start is None or end is None:
    raise SystemExit(f'Block not found: start={start}, end={end}')

replacement = '''        <TasksCreateDialog
          open={createOpen}
          onClose={handleCloseCreateDialog}
          isMobile={isMobile}
          ui={ui}
          createData={createData}
          setCreateData={setCreateData}
          createSaving={createSaving}
          onCreate={handleCreateTask}
          onCreateDescriptionDraftChange={handleCreateDescriptionDraftChange}
          onOpenOptionalSection={handleOpenCreateMobileSheet}
          createDescriptionSummary={createDescriptionSummary}
          createAssigneeSummary={createAssigneeSummary}
          createEmailRemindSummary={createEmailRemindSummary}
          createDueLabel={createDueLabel}
          createDueAnchorRef={createDueAnchorRef}
          onOpenDuePicker={() => setCreateDuePickerOpen(true)}
          selectedCreateAssignees={selectedCreateAssignees}
          selectedCreateController={selectedCreateController}
          selectedCreateObservers={selectedCreateObservers}
          selectedCreateDepartment={selectedCreateDepartment}
          getAssigneePickerOptions={getAssigneePickerOptions}
          onChangeAssigneeIds={handleChangeCreateAssigneeIds}
          onChangeObserverIds={handleChangeCreateObserverIds}
          renderTaskUserOption={renderTaskUserOption}
          renderTaskUserOptionMultiple={renderTaskUserOptionMultiple}
          renderTaskUserTags={renderTaskUserTags}
          renderTaskObserverTags={renderTaskObserverTags}
          taskUserAutocompleteSlotProps={taskUserAutocompleteSlotProps}
          assigneeAutocompleteProps={assigneeAutocompleteProps}
          controllers={controllers}
          departments={departments}
          activeTaskProjects={activeTaskProjects}
          effectiveCreateProjectId={effectiveCreateProjectId}
          effectiveCreateProject={effectiveCreateProject}
          createOptionalSections={createOptionalSections}
          createFiles={createFiles}
          createChecklistItems={createChecklistItems}
          createProjectName={createProjectName}
          setCreateProjectName={setCreateProjectName}
          onCreateProject={handleCreateProjectFromTaskDialog}
          createProjectSaving={createProjectSaving}
          onAddChecklistItem={handleAddChecklistItem}
          onUpdateChecklistItem={handleUpdateChecklistItem}
          onRemoveChecklistItem={handleRemoveChecklistItem}
          onAddCreateFiles={handleAddCreateFiles}
          onRemoveCreateFile={handleRemoveCreateFile}
          taskUsersLoading={taskUsersLoading}
          taskUsersLoadError={taskUsersLoadError}
          taskEmailDeadlineDefaultHours={taskEmailDeadlineDefaultHours}
        />

'''

new_lines = lines[:start] + [replacement] + lines[end:]
path.write_text(''.join(new_lines), encoding='utf-8')
print(f'Replaced lines {start+1}-{end} with TasksCreateDialog')
