import { NATIVE_MONITORING_ENABLED } from '../../../src/monitoring/nativeMonitoringFeature';
import { NativeFeatureRoute } from '../../../src/navigation/NativeFeatureRoute';
import { NativeMonitoringScreen } from '../../../src/screens/monitoring/NativeMonitoringScreen';

export default function MonitoringRoute() {
  return (
    <NativeFeatureRoute enabled={NATIVE_MONITORING_ENABLED}>
      <NativeMonitoringScreen />
    </NativeFeatureRoute>
  );
}
