import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FluentTokens } from '../theme/fluentTokens';
import { FEED_REACTIONS, type FeedReactionId } from './feedFormat';

export const FeedReactionBar = memo(function FeedReactionBar({
  tokens,
  selectedId,
  onSelect,
  onClose,
  testIDPrefix = 'feed-card-reaction',
  accessibilityLabel = 'Выбрать реакцию',
}: {
  tokens: FluentTokens;
  selectedId?: FeedReactionId | string | null;
  onSelect: (reactionId: FeedReactionId) => void;
  onClose: () => void;
  testIDPrefix?: string;
  accessibilityLabel?: string;
}) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        testID={`${testIDPrefix}-backdrop`}
        accessibilityRole="button"
        accessibilityLabel="Закрыть выбор реакций"
        onPress={onClose}
        style={styles.backdrop}
      />
      <View
        testID={`${testIDPrefix}-bar`}
        accessibilityViewIsModal
        accessibilityLabel={accessibilityLabel}
        style={[styles.bar, { backgroundColor: tokens.surfaceRaised, borderColor: tokens.borderSoft }]}
      >
        {FEED_REACTIONS.map((reaction) => {
          const active = String(selectedId || '') === reaction.id;
          return (
            <Pressable
              key={reaction.id}
              testID={`${testIDPrefix}-${reaction.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={reaction.label}
              onPress={() => onSelect(reaction.id)}
              style={({ pressed }) => [
                styles.item,
                active && { backgroundColor: tokens.accentSoft },
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.emoji}>{reaction.emoji}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: -48,
    bottom: -48,
    left: -48,
    right: -48,
  },
  bar: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 4,
  },
  item: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  emoji: { fontSize: 24 },
});
