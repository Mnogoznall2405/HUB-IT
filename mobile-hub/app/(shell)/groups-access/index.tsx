import { NATIVE_GROUPS_ACCESS_ENABLED } from '../../../src/groupsAccess/nativeGroupsAccessFeature';
import { NativeFeatureRoute } from '../../../src/navigation/NativeFeatureRoute';
import { NativeGroupsAccessScreen } from '../../../src/screens/groupsAccess/NativeGroupsAccessScreen';

export default function GroupsAccessRoute() {
  return (
    <NativeFeatureRoute enabled={NATIVE_GROUPS_ACCESS_ENABLED}>
      <NativeGroupsAccessScreen />
    </NativeFeatureRoute>
  );
}
