import { NativeFeatureRoute } from '../../../src/navigation/NativeFeatureRoute';
import { NativeWarehouse1CScreen } from '../../../src/screens/warehouse1c/NativeWarehouse1CScreen';
import { NATIVE_WAREHOUSE_1C_ENABLED } from '../../../src/warehouse1c/nativeWarehouse1cFeature';

export default function Warehouse1CRoute() {
  return (
    <NativeFeatureRoute enabled={NATIVE_WAREHOUSE_1C_ENABLED}>
      <NativeWarehouse1CScreen />
    </NativeFeatureRoute>
  );
}
