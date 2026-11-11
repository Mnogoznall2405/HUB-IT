import { useLocalSearchParams } from 'expo-router';
import { NativeConstructionScreen } from '../../../src/screens/construction/NativeConstructionScreen';
export default function ConstructionRoute() {
  const params = useLocalSearchParams<{ objectId?: string; groupRef?: string; requestRef?: string; tab?: string }>();
  const single = (value: unknown) => typeof value === 'string' && value.length <= 256 ? value : undefined;
  return <NativeConstructionScreen objectId={single(params.objectId)} groupRef={single(params.groupRef)} requestRef={single(params.requestRef)} tab={params.tab === 'work' ? 'work' : undefined} />;
}
