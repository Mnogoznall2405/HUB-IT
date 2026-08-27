import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Image, StyleSheet, View } from 'react-native';

const MAX_ICON = require('../../assets/icons/max.png');

/** Official Telegram glyph from FontAwesome (already shipped with Expo vector icons). */
export function TelegramBrandIcon({
  size = 20,
  disabled = false,
}: {
  size?: number;
  disabled?: boolean;
}) {
  return (
    <FontAwesome
      name="telegram"
      size={size}
      color={disabled ? '#9bbbd0' : '#2AABEE'}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

/** MAX brand mark from assets/icons/max.png (rasterized from the web SVG). */
export function MaxBrandIcon({
  size = 20,
  disabled = false,
}: {
  size?: number;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.wrap, { width: size, height: size, opacity: disabled ? 0.35 : 1 }]}>
      <Image
        source={MAX_ICON}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
