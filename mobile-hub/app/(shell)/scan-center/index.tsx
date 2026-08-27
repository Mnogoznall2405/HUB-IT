import { NATIVE_SCAN_CENTER_ENABLED } from '../../../src/scanCenter/nativeScanCenterFeature';
import { NativeFeatureRoute } from '../../../src/navigation/NativeFeatureRoute';
import { NativeScanCenterScreen } from '../../../src/screens/scanCenter/NativeScanCenterScreen';

export default function ScanCenterRoute() {
  return (
    <NativeFeatureRoute enabled={NATIVE_SCAN_CENTER_ENABLED}>
      <NativeScanCenterScreen />
    </NativeFeatureRoute>
  );
}
