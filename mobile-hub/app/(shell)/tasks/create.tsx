import { Redirect } from 'expo-router';
import { NATIVE_TASKS_ENABLED } from '../../../src/tasks/nativeTasksFeature';
import { NativeTaskCreateScreen } from '../../../src/screens/tasks/NativeTaskCreateScreen';

export default function NativeTaskCreateRoute() {
  if (!NATIVE_TASKS_ENABLED) {
    return <Redirect href="/(shell)/menu" />;
  }
  return <NativeTaskCreateScreen />;
}
