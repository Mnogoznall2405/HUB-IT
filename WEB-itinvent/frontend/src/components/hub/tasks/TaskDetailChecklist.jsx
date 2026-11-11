import TaskChecklist from '../TaskChecklist';

export default function TaskDetailChecklist({
  task,
  canUpdate = false,
  onToggle,
  ui,
}) {
  return (
    <TaskChecklist
      task={task}
      canUpdate={canUpdate}
      onToggle={onToggle}
      ui={ui}
    />
  );
}
