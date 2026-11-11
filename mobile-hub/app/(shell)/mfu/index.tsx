import { NATIVE_MFU_ENABLED } from '../../../src/mfu/nativeMfuFeature';
import { NativeFeatureRoute } from '../../../src/navigation/NativeFeatureRoute';
import { NativeMfuScreen } from '../../../src/screens/mfu/NativeMfuScreen';

export default function MfuRoute() {
  return (
    <NativeFeatureRoute enabled={NATIVE_MFU_ENABLED}>
      <NativeMfuScreen />
    </NativeFeatureRoute>
  );
}
