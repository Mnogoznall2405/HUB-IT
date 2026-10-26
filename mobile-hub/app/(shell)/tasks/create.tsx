import { Redirect, useLocalSearchParams } from 'expo-router';
import { NATIVE_TASKS_ENABLED } from '../../../src/tasks/nativeTasksFeature';
import { NativeTaskCreateScreen } from '../../../src/screens/tasks/NativeTaskCreateScreen';

const firstParam = (value: string | string[] | undefined) => String(Array.isArray(value) ? value[0] : value || '').trim();

export default function NativeTaskCreateRoute() {
  const params = useLocalSearchParams<{ parentTaskId?: string | string[]; parentTitle?: string | string[] }>();
  if (!NATIVE_TASKS_ENABLED) {
    return <Redirect href="/(shell)/menu" />;
  }
  return <NativeTaskCreateScreen parentTaskId={firstParam(params.parentTaskId)} parentTitle={firstParam(params.parentTitle)} />;
}
