from pathlib import Path

path = Path(r'c:\Project\Image_scan\WEB-itinvent\frontend\src\pages\Tasks.jsx')
lines = path.read_text(encoding='utf-8').splitlines(keepends=True)

def idx_contains(substr, start=0):
    for i in range(start, len(lines)):
        if substr in lines[i]:
            return i
    raise ValueError(substr)

# analyticsFiltersContent
start = idx_contains('const analyticsFiltersContent = (')
end = idx_contains('const mobileTasksCopy = {')
lines[start:end] = ["""  const analyticsFiltersContent = (
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

"""]

start = idx_contains('const mobileTasksCopy = {')
end = idx_contains('const mobileModeLabel = ')
lines[start:end] = ['  const mobileTasksCopy = TASKS_MOBILE_COPY;\n\n']

path.write_text(''.join(lines), encoding='utf-8')
print('step1 ok')
