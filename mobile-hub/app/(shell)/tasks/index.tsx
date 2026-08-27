import { Redirect } from 'expo-router';
import { NATIVE_TASKS_ENABLED } from '../../../src/tasks/nativeTasksFeature';
import { NativeTasksInboxScreen } from '../../../src/screens/tasks/NativeTasksInboxScreen';

export default function NativeTasksIndexRoute() {
  if (!NATIVE_TASKS_ENABLED) {
    return <Redirect href="/(shell)/menu" />;
  }
  return <NativeTasksInboxScreen />;
}
