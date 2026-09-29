import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  resolveChatPhotoFrame,
} from '../../chat/chatBubbleLayout';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatAuthenticatedImage } from './ChatAuthenticatedImage';

export function ChatBubblePhoto({
  uri,
  maxWidth,
  maxHeight,
  radius,
  children,
}: {
  uri: string;
  maxWidth: number;
  maxHeight: number;
  radius: number;
  children?: React.ReactNode;
}) {
  const { styles } = useChatStyles(createStyles);
  // Reserve the same frame before loading and after confirmation of an upload.
  // Once the real pixel size arrives the frame refits to the source aspect, so
  // `cover` fills edge-to-edge without gray letterbox bars on any orientation.
  const [sourceSize, setSourceSize] = useState<{ w: number; h: number } | null>(null);
  const frame = resolveChatPhotoFrame({
    maxWidth,
    maxHeight,
    sourceWidth: sourceSize?.w,
    sourceHeight: sourceSize?.h,
  });

  return (
    <View testID="chat-photo-frame" style={[styles.frame, { width: frame.width, height: frame.height, borderRadius: radius }]}>
      <ChatAuthenticatedImage
        uri={uri}
        style={styles.image}
        resizeMode="cover"
        accessible={false}
        onLoad={(event) => {
          const w = event.nativeEvent.source?.width;
          const h = event.nativeEvent.source?.height;
          if (w && h) setSourceSize((current) => (current?.w === w && current.h === h ? current : { w, h }));
        }}
      />
      {children}
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  image: { width: '100%', height: '100%' },
});
