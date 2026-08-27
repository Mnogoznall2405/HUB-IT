import { useLocalSearchParams } from 'expo-router';
import { NativeDocflowDetailScreen } from '../../../src/screens/docflow/NativeDocflowDetailScreen';

export default function NativeDocflowTaskRoute() {
  const params = useLocalSearchParams<{ taskRef?: string | string[] }>();
  const taskRef = String(Array.isArray(params.taskRef) ? params.taskRef[0] : params.taskRef || '').trim();
  return <NativeDocflowDetailScreen taskRef={taskRef} />;
}

