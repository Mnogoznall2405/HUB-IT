import { alpha } from '@mui/material/styles';
import { Box, Drawer, Popover } from '@mui/material';
import CreateDuePickerPanel from '../../components/hub/CreateDuePickerPanel';
import { TaskReopenDialog, TaskReviewDialog, TaskSubmitDialog } from '../../components/hub/TaskActionDialogs';
import TasksCreateDialog from '../../components/hub/tasks/TasksCreateDialog';
import TasksTaxonomyDialog from '../../components/hub/tasks/TasksTaxonomyDialog';
import TasksCreateMobileSheet from '../../components/hub/tasks/TasksCreateMobileSheet';
import TasksEditDialog from '../../components/hub/tasks/TasksEditDialog';
import {
  useTasksCreateSlice,
  useTasksFiltersSlice,
  useTasksListSlice,
  useTasksUiSlice,
} from './TasksPageContext';

export default function TasksDialogsLayer() {
  const ui = useTasksUiSlice();
  const list = useTasksListSlice();
  const filters = useTasksFiltersSlice();
  const create = useTasksCreateSlice();

  return (
    <>
      {create.createOpen ? (
        <TasksCreateDialog
          open={create.createOpen}
          onClose={create.handleCloseCreateDialog}
          isMobile={ui.isMobile}
          ui={ui.ui}
          createData={create.createData}
          setCreateData={create.setCreateData}
          createSaving={create.createSaving}
          onCreate={create.handleCreateTask}
          onCreateDescriptionDraftChange={create.handleCreateDescriptionDraftChange}
          onOpenOptionalSection={create.handleOpenCreateMobileSheet}
          createDescriptionSummary={create.createDescriptionSummary}
          createAssigneeSummary={create.createAssigneeSummary}
          createEmailRemindSummary={create.createEmailRemindSummary}
          createDueLabel={create.createDueLabel}
          createDueAnchorRef={create.createDueAnchorRef}
          onOpenDuePicker={() => create.setCreateDuePickerOpen(true)}
          selectedCreateAssignees={create.selectedCreateAssignees}
          selectedCreateController={create.selectedCreateController}
          selectedCreateObservers={create.selectedCreateObservers}
          selectedCreateDepartment={create.selectedCreateDepartment}
          getAssigneePickerOptions={list.getAssigneePickerOptions}
          onChangeAssigneeIds={create.handleChangeCreateAssigneeIds}
          onChangeObserverIds={create.handleChangeCreateObserverIds}
          renderTaskUserOption={ui.renderTaskUserOption}
          renderTaskUserOptionMultiple={ui.renderTaskUserOptionMultiple}
          renderTaskUserTags={ui.renderTaskUserTags}
          renderTaskObserverTags={ui.renderTaskObserverTags}
          taskUserAutocompleteSlotProps={ui.taskUserAutocompleteSlotProps}
          assigneeAutocompleteProps={ui.assigneeAutocompleteProps}
          controllers={list.controllers}
          departments={list.departments}
          activeTaskProjects={list.activeTaskProjects}
          effectiveCreateProjectId={create.effectiveCreateProjectId}
          effectiveCreateProject={create.effectiveCreateProject}
          createOptionalSections={create.createOptionalSections}
          createFiles={create.createFiles}
          createChecklistItems={create.createChecklistItems}
          createProjectName={create.createProjectName}
          setCreateProjectName={create.setCreateProjectName}
          onCreateProject={create.handleCreateProjectFromTaskDialog}
          createProjectSaving={create.createProjectSaving}
          onAddChecklistItem={create.handleAddChecklistItem}
          onUpdateChecklistItem={create.handleUpdateChecklistItem}
          onRemoveChecklistItem={create.handleRemoveChecklistItem}
          onAddCreateFiles={create.handleAddCreateFiles}
          onRemoveCreateFile={create.handleRemoveCreateFile}
          taskUsersLoading={list.taskUsersLoading}
          taskUsersLoadError={list.taskUsersLoadError}
          taskEmailDeadlineDefaultHours={list.taskEmailDeadlineDefaultHours}
        />
      ) : null}

      <Popover
        data-testid="create-due-desktop-popover"
        open={Boolean(!ui.isMobile && create.createDuePickerOpen)}
        anchorEl={create.createDueAnchorRef.current}
        onClose={create.handleCloseCreateDuePicker}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        sx={{ zIndex: ui.theme.zIndex.modal + 2 }}
        PaperProps={{
          sx: {
            width: 380,
            maxWidth: '92vw',
            borderRadius: '16px',
            bgcolor: ui.ui.panelSolid,
            color: ui.ui.text,
            border: '1px solid',
            borderColor: ui.ui.borderSoft,
            boxShadow: ui.ui.dialogShadow,
            mt: 0.6,
          },
        }}
      >
        <CreateDuePickerPanel
          presets={create.createDuePresets}
          dueAt={create.createData.due_at}
          customOpen={create.createDueCustomOpen}
          onCustomOpenChange={create.setCreateDueCustomOpen}
          onSelectPreset={create.handleSelectCreateDuePreset}
          onDueAtChange={create.handleCreateDueAtChange}
          onClose={create.handleCloseCreateDuePicker}
          testIdPrefix="create-due-desktop"
        />
      </Popover>

      <Drawer
        data-testid="create-due-mobile-drawer"
        anchor="bottom"
        open={Boolean(ui.isMobile && create.createDuePickerOpen)}
        onClose={create.handleCloseCreateDuePicker}
        sx={{ zIndex: ui.theme.zIndex.modal + 2 }}
        ModalProps={{ disableScrollLock: true }}
        PaperProps={{
          style: { zIndex: ui.theme.zIndex.modal + 3 },
          sx: {
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            bgcolor: ui.ui.panelSolid,
            color: ui.ui.text,
            borderTop: '1px solid',
            borderColor: ui.ui.borderSoft,
            boxShadow: ui.ui.dialogShadow,
            maxHeight: '82dvh',
            overflow: 'hidden',
          },
        }}
      >
        <Box sx={{
          pb: 'calc(1.4rem + env(safe-area-inset-bottom, 0px))',
          maxHeight: '82dvh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
        >
          <Box sx={{ width: 54, height: 5, borderRadius: 999, bgcolor: alpha(ui.ui.mutedText, 0.35), mx: 'auto', mt: 1.1, mb: 0.4 }} />
          <CreateDuePickerPanel
            presets={create.createDuePresets}
            dueAt={create.createData.due_at}
            customOpen={create.createDueCustomOpen}
            onCustomOpenChange={create.setCreateDueCustomOpen}
            onSelectPreset={create.handleSelectCreateDuePreset}
            onDueAtChange={create.handleCreateDueAtChange}
            onClose={create.handleCloseCreateDuePicker}
            testIdPrefix="create-due-mobile"
          />
        </Box>
      </Drawer>

      <TasksCreateMobileSheet
        open={Boolean(ui.isMobile && create.createMobileSheet)}
        sheet={create.createMobileSheet}
        onClose={create.handleCloseCreateMobileSheet}
        ui={ui.ui}
        theme={ui.theme}
        bodyProps={{
          createOpen: create.createOpen,
          ui: ui.ui,
          theme: ui.theme,
          createDescriptionRef: create.createDescriptionRef,
          createDescriptionPreview: create.createDescriptionPreview,
          createData: create.createData,
          handleCreateDescriptionDraftChange: create.handleCreateDescriptionDraftChange,
          handleCloseCreateMobileSheet: create.handleCloseCreateMobileSheet,
          handleAddCreateFiles: create.handleAddCreateFiles,
          handleChangeCreateAssigneeIds: create.handleChangeCreateAssigneeIds,
          handleClearCreateAssignees: create.handleClearCreateAssignees,
          searchCreateAssignees: create.searchCreateAssignees,
          resolveCreateAssignees: create.resolveCreateAssignees,
          setCreateData: create.setCreateData,
          setCreateOptionalSections: create.setCreateOptionalSections,
          setCreateMobileSheet: create.setCreateMobileSheet,
          createSaving: create.createSaving,
          createFiles: create.createFiles,
          handleRemoveCreateFile: create.handleRemoveCreateFile,
          createChecklistItems: create.createChecklistItems,
          handleAddChecklistItem: create.handleAddChecklistItem,
          handleUpdateChecklistItem: create.handleUpdateChecklistItem,
          handleRemoveChecklistItem: create.handleRemoveChecklistItem,
          effectiveCreateProjectId: create.effectiveCreateProjectId,
          activeTaskProjects: list.activeTaskProjects,
          createProjectName: create.createProjectName,
          setCreateProjectName: create.setCreateProjectName,
          handleCreateProjectFromTaskDialog: create.handleCreateProjectFromTaskDialog,
          createProjectSaving: create.createProjectSaving,
          controllers: list.controllers,
          handleChangeCreateControllerId: create.handleChangeCreateControllerId,
          handleClearCreateController: create.handleClearCreateController,
          taskUsersLoading: list.taskUsersLoading,
          taskUsersLoadError: list.taskUsersLoadError,
          loadTaskUserDirectories: create.loadTaskUserDirectories,
          handleChangeCreateObserverIds: create.handleChangeCreateObserverIds,
          handleClearCreateObservers: create.handleClearCreateObservers,
          selectedCreateController: create.selectedCreateController,
          renderTaskUserOption: ui.renderTaskUserOption,
          taskUserAutocompleteSlotProps: ui.taskUserAutocompleteSlotProps,
          departments: list.departments,
          selectedCreateDepartment: create.selectedCreateDepartment,
        }}
      />

      {create.editOpen ? (
        <TasksEditDialog
          open={create.editOpen}
          onClose={() => create.setEditOpen(false)}
          isMobile={ui.isMobile}
          ui={ui.ui}
          editData={create.editData}
          setEditData={create.setEditData}
          editSaving={create.editSaving}
          onSave={create.handleSaveEdit}
          onEditDescriptionDraftChange={create.handleEditDescriptionDraftChange}
          onAiTransform={create.transformTaskMarkdown}
          selectedEditAssignee={create.selectedEditAssignee}
          selectedEditController={create.selectedEditController}
          selectedEditObservers={create.selectedEditObservers}
          selectedEditDepartment={create.selectedEditDepartment}
          getAssigneePickerOptions={list.getAssigneePickerOptions}
          controllers={list.controllers}
          departments={list.departments}
          activeTaskProjects={list.activeTaskProjects}
          editProjectObjects={create.editProjectObjects}
          onSingleAssigneeAutocompleteChange={filters.handleSingleAssigneeAutocompleteChange}
          renderTaskUserOption={ui.renderTaskUserOption}
          renderTaskUserOptionMultiple={ui.renderTaskUserOptionMultiple}
          renderTaskObserverTags={ui.renderTaskObserverTags}
          taskUserAutocompleteSlotProps={ui.taskUserAutocompleteSlotProps}
          assigneeAutocompleteProps={ui.assigneeAutocompleteProps}
          getAssigneeAutocompleteInputValue={filters.getAssigneeAutocompleteInputValue}
          createDuePresets={create.createDuePresets}
          editDueLabel={create.editDueLabel}
          editDueCustomOpen={create.editDueCustomOpen}
          onEditDueCustomOpenChange={create.setEditDueCustomOpen}
          onSelectEditDuePreset={create.handleSelectEditDuePreset}
          onEditDueAtChange={create.handleEditDueAtChange}
          taskEmailDeadlineDefaultHours={list.taskEmailDeadlineDefaultHours}
        />
      ) : null}

      <TasksTaxonomyDialog
        open={create.taxonomyOpen}
        onClose={() => create.setTaxonomyOpen(false)}
        isMobile={ui.isMobile}
        ui={ui.ui}
        taxonomySaving={create.taxonomySaving}
        projectDraft={create.projectDraft}
        setProjectDraft={create.setProjectDraft}
        objectDraft={create.objectDraft}
        setObjectDraft={create.setObjectDraft}
        editingProjectId={create.editingProjectId}
        editingObjectId={create.editingObjectId}
        onSaveProject={create.handleCreateProject}
        onSaveObject={create.handleCreateObject}
        onEditProject={create.handleEditProject}
        onEditObject={create.handleEditObject}
        onResetProjectDraft={create.resetProjectDraft}
        onResetObjectDraft={create.resetObjectDraft}
        taskProjects={list.taskProjects}
        taskObjects={list.activeTaskObjects}
        activeTaskProjects={list.activeTaskProjects}
      />

      <TaskReviewDialog
        open={Boolean(create.reviewTask)}
        task={create.reviewTask}
        saving={create.reviewSaving}
        onClose={() => { if (!create.reviewSaving) create.setReviewTask(null); }}
        onSubmit={(decision, comment) => void create.handleReviewTask(decision, comment)}
        ui={ui.ui}
      />

      <TaskReopenDialog
        open={Boolean(create.reopenTargetTask)}
        task={create.reopenTargetTask}
        saving={Boolean(create.reopeningTaskId)}
        onClose={() => { if (!create.reopeningTaskId) create.setReopenTargetTask(null); }}
        onSubmit={(payload) => void create.handleConfirmReopenTask(payload)}
        ui={ui.ui}
      />

      <TaskSubmitDialog
        open={Boolean(create.submitTask)}
        task={create.submitTask}
        saving={create.submitSaving}
        onClose={() => { if (!create.submitSaving) create.setSubmitTask(null); }}
        onSubmit={(payload) => void create.handleSubmitTask(payload)}
        ui={ui.ui}
      />
    </>
  );
}
