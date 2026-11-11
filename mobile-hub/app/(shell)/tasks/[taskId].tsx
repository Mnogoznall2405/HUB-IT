import { Redirect, useLocalSearchParams } from 'expo-router';
import { NATIVE_TASKS_ENABLED } from '../../../src/tasks/nativeTasksFeature';
import { NativeTaskDetailScreen } from '../../../src/screens/tasks/NativeTaskDetailScreen';

export default function NativeTaskDetailRoute() {
  const params = useLocalSearchParams<{ taskId?: string | string[] }>();
  const taskId = String(Array.isArray(params.taskId) ? params.taskId[0] : params.taskId || '').trim();
  if (!NATIVE_TASKS_ENABLED) {
    return <Redirect href="/(shell)/menu" />;
  }
  return <NativeTaskDetailScreen taskId={taskId} />;
}
