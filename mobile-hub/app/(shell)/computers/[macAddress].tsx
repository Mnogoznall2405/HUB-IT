import { NATIVE_COMPUTERS_ENABLED } from '../../../src/computers/nativeComputersFeature';
import { NativeFeatureRoute } from '../../../src/navigation/NativeFeatureRoute';
import { NativeComputerDetailScreen } from '../../../src/screens/computers/NativeComputerDetailScreen';

export default function ComputerDetailRoute() {
  return (
    <NativeFeatureRoute enabled={NATIVE_COMPUTERS_ENABLED}>
      <NativeComputerDetailScreen />
    </NativeFeatureRoute>
  );
}
