import TaskChecklist from '../TaskChecklist';

export default function TaskDetailChecklist({
  task,
  canUpdate = false,
  updatingItemId = '',
  onToggle,
  ui,
}) {
  return (
    <TaskChecklist
      task={task}
      canUpdate={canUpdate}
      updatingItemId={updatingItemId}
      onToggle={onToggle}
      ui={ui}
    />
  );
}
