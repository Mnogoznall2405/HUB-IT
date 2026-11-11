from pathlib import Path

path = Path(r'c:\Project\Image_scan\WEB-itinvent\frontend\src\pages\Tasks.jsx')
lines = path.read_text(encoding='utf-8').splitlines(keepends=True)

def idx_contains(substr, start=0):
    for i in range(start, len(lines)):
        if substr in lines[i]:
            return i
    raise ValueError(substr)

start = idx_contains('const mobileCardMenuItems = [')
end = start
while '].filter(Boolean);' not in lines[end]:
    end += 1
end += 1
lines[start:end] = ['    const mobileCardMenuItems = buildMobileTaskCardMenuItems({ canEdit, canDelete: canDeleteTask(task) });\n']

start = idx_contains('const renderTaskListTableRow = (task) => {')
end = idx_contains('const renderListView = () => {')
lines[start:end] = []

start = idx_contains('return isMobile ? renderMobileTaskFeedView() : (')
card_start = start + 1
end = card_start
while lines[end].strip() != ');' or 'renderListView' not in ''.join(lines[start:end+1]):
    end += 1
    if end - start > 120:
        raise RuntimeError('card block too long')
lines[card_start:end] = [
    '      <TasksDesktopListView\n',
    '        ui={ui}\n',
    '        alpha={alpha}\n',
    '        loading={loading}\n',
    '        visibleTaskItems={visibleTaskItems}\n',
    '        taskListSections={taskListSections}\n',
    '        completedTasksOpen={completedTasksOpen}\n',
    '        onToggleCompletedTasks={() => setCompletedTasksOpen((current) => !current)}\n',
    '        taskDiscussionChatEnabled={taskDiscussionChatEnabled}\n',
    '        activeTaskProjects={activeTaskProjects}\n',
    '        onOpenTask={openTaskDetails}\n',
    '      />\n',
]

path.write_text(''.join(lines), encoding='utf-8')
print('step2 ok')
