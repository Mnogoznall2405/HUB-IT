import { NATIVE_COMPUTERS_ENABLED } from '../../../src/computers/nativeComputersFeature';
import { NativeFeatureRoute } from '../../../src/navigation/NativeFeatureRoute';
import { NativeComputersScreen } from '../../../src/screens/computers/NativeComputersScreen';

export default function ComputersRoute() {
  return (
    <NativeFeatureRoute enabled={NATIVE_COMPUTERS_ENABLED}>
      <NativeComputersScreen />
    </NativeFeatureRoute>
  );
}
