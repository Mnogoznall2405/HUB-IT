import { memo } from 'react';
import { motion } from 'framer-motion';
import { Box, Stack, Typography } from '@mui/material';
import { AiConversationAvatar } from './ChatCommon';

const TELEGRAM_CHAT_FONT_FAMILY = '"Segoe UI", system-ui, -apple-system, sans-serif';

export function TypingDots({ color }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', height: 20 }}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          animate={{
            opacity: [0.4, 1, 0.4],
            scale: [0.8, 1, 0.8],
          }}
          transition={{
            duration: 1.4,
            repeat: Infinity,
            delay: i * 0.2,
            ease: 'easeInOut',
          }}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: color,
            display: 'inline-block',
          }}
        />
      ))}
    </Box>
  );
}

function ChatTypingIndicator({
  botName = 'HUB Ассистент',
  theme,
  ui,
  compactMobile = false,
}) {
  const dotColor = ui?.accentText || theme?.palette?.primary?.main || '#1976d2';
  const textColor = ui?.textSecondary || theme?.palette?.text?.secondary || '#666';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: compactMobile ? 1 : 1.5,
        px: compactMobile ? 1.5 : 2,
        py: 1,
      }}
    >
      <AiConversationAvatar size={compactMobile ? 32 : 36} thinking />

      <Stack spacing={0.3}>
        <Typography
          sx={{
            fontSize: compactMobile ? 12.5 : 13,
            fontWeight: 600,
            color: ui?.textPrimary || '#000',
            fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
          }}
        >
          {botName}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <TypingDots color={dotColor} />
          <Typography
            sx={{
              fontSize: compactMobile ? 12 : 12.5,
              color: textColor,
              fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
              fontStyle: 'italic',
            }}
          >
            печатает
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}

export default memo(ChatTypingIndicator);
