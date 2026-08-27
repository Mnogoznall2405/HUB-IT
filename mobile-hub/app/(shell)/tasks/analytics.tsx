import { Redirect } from 'expo-router';
import { NativeTaskAnalyticsScreen } from '../../../src/screens/tasks/NativeTaskAnalyticsScreen';
import { NATIVE_TASKS_ENABLED } from '../../../src/tasks/nativeTasksFeature';

export default function NativeTaskAnalyticsRoute() {
  if (!NATIVE_TASKS_ENABLED) {
    return <Redirect href="/(shell)/menu" />;
  }
  return <NativeTaskAnalyticsScreen />;
}
