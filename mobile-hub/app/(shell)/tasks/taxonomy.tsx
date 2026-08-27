import { Redirect } from 'expo-router';
import { NativeTaskTaxonomyScreen } from '../../../src/screens/tasks/NativeTaskTaxonomyScreen';
import { NATIVE_TASKS_ENABLED } from '../../../src/tasks/nativeTasksFeature';

export default function NativeTaskTaxonomyRoute() {
  if (!NATIVE_TASKS_ENABLED) {
    return <Redirect href="/(shell)/menu" />;
  }
  return <NativeTaskTaxonomyScreen />;
}
