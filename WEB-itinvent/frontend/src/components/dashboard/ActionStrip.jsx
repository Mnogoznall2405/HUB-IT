import React from 'react';
import { Box, Card, Chip, Stack, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CampaignIcon from '@mui/icons-material/Campaign';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ModeCommentOutlinedIcon from '@mui/icons-material/ModeCommentOutlined';

const ActionStrip = React.memo(({
  actionStrip,
  onFilterClick,
  ui,
  isMobile,
}) => {
  const handleChipClick = React.useCallback((key) => {
    if (onFilterClick) {
      onFilterClick(key);
    }
  }, [onFilterClick]);

  return (
    <Card
      sx={{
        ...ui.panelSolid,
        p: isMobile ? 1.5 : 2,
        mb: 2,
      }}
    >
      <Stack
        direction="row"
        spacing={isMobile ? 1 : 1.5}
        sx={{
          overflowX: 'auto',
          '&::-webkit-scrollbar': {
            display: 'none',
          },
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
        }}
      >
        {actionStrip.map((action) => (
          <Box
            key={action.key}
            onClick={() => handleChipClick(action.key)}
            sx={{
              flex: isMobile ? '0 0 auto' : '1 1 0',
              minWidth: isMobile ? 140 : 160,
              maxWidth: isMobile ? 180 : 220,
              backgroundColor: action.bg,
              borderRadius: 2,
              p: 1.5,
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out',
              border: `1px solid ${action.color}33`,
              '&:hover': {
                transform: 'translateY(-2px)',
                boxShadow: `0 4px 12px ${action.color}33`,
                borderColor: action.color,
              },
            }}
          >
            <Stack spacing={1}>
              {/* Icon and Count */}
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
              >
                <Box
                  sx={{
                    color: action.color,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {action.icon}
                </Box>
                <Typography
                  variant={isMobile ? 'h5' : 'h4'}
                  sx={{
                    fontWeight: 800,
                    color: action.color,
                    lineHeight: 1,
                  }}
                >
                  {action.value}
                </Typography>
              </Stack>

              {/* Label */}
              <Typography
                variant="caption"
                sx={{
                  color: ui.mutedFg,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {action.label}
              </Typography>
            </Stack>
          </Box>
        ))}
      </Stack>
    </Card>
  );
});

ActionStrip.displayName = 'ActionStrip';

export default ActionStrip;
