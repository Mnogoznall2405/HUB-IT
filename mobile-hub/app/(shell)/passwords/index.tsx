import { NATIVE_PASSWORDS_ENABLED } from '../../../src/passwords/nativePasswordsFeature';
import { NativeFeatureRoute } from '../../../src/navigation/NativeFeatureRoute';
import { NativePasswordsScreen } from '../../../src/screens/passwords/NativePasswordsScreen';

export default function PasswordsRoute() {
  return (
    <NativeFeatureRoute enabled={NATIVE_PASSWORDS_ENABLED}>
      <NativePasswordsScreen />
    </NativeFeatureRoute>
  );
}
