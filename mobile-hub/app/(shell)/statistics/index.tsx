import { NATIVE_STATISTICS_ENABLED } from '../../../src/statistics/nativeStatisticsFeature';
import { NativeFeatureRoute } from '../../../src/navigation/NativeFeatureRoute';
import { NativeStatisticsScreen } from '../../../src/screens/statistics/NativeStatisticsScreen';

export default function StatisticsRoute() {
  return (
    <NativeFeatureRoute enabled={NATIVE_STATISTICS_ENABLED}>
      <NativeStatisticsScreen />
    </NativeFeatureRoute>
  );
}
