import { useEffect, useState } from 'react';
import { StyleSheet, View, type ImageLoadEventData, type NativeSyntheticEvent } from 'react-native';
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
  const [frame, setFrame] = useState(() => resolveChatPhotoFrame({ maxWidth, maxHeight }));

  useEffect(() => {
    setFrame(resolveChatPhotoFrame({ maxWidth, maxHeight }));
  }, [maxHeight, maxWidth, uri]);

  const handleLoad = (event: NativeSyntheticEvent<ImageLoadEventData>) => {
    const source = event.nativeEvent?.source;
    setFrame(resolveChatPhotoFrame({
      maxWidth,
      maxHeight,
      sourceWidth: source?.width,
      sourceHeight: source?.height,
    }));
  };

  return (
    <View style={[styles.frame, { width: frame.width, height: frame.height, borderRadius: radius }]}>
      <ChatAuthenticatedImage
        uri={uri}
        style={styles.image}
        resizeMode="cover"
        onLoad={handleLoad}
        accessible={false}
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
