import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import AnnouncementCard from './AnnouncementCard';

const AnnouncementList = React.memo(({
  sections,
  onAnnouncementClick,
  onAcknowledge,
  ui,
  isMobile,
}) => {
  if (!sections || sections.length === 0) {
    return (
      <Box
        sx={{
          ...ui.emptyState,
          py: 4,
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Нет заметок для отображения
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={3}>
      {sections.map((section) => {
        // Skip empty sections except 'all'
        if (section.key !== 'all' && section.items.length === 0) {
          return null;
        }

        return (
          <Box key={section.key}>
            {/* Section Header */}
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{
                mb: 2,
                pb: 1,
                borderBottom: `1px solid ${ui.borderSoft}`,
              }}
            >
              <Typography
                variant={isMobile ? 'subtitle1' : 'h6'}
                sx={{
                  fontWeight: 700,
                  color: ui.panelFg,
                }}
              >
                {section.title}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {section.items.length}
              </Typography>
            </Stack>

            {/* Section Items */}
            {section.items.length > 0 ? (
              <Stack spacing={1.5}>
                {section.items.map((item) => (
                  <AnnouncementCard
                    key={item?.id}
                    item={item}
                    onClick={onAnnouncementClick}
                    onAcknowledge={onAcknowledge}
                    ui={ui}
                    isMobile={isMobile}
                  />
                ))}
              </Stack>
            ) : (
              <Box
                sx={{
                  ...ui.emptyState,
                  py: 3,
                  px: 2,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  {section.empty}
                </Typography>
              </Box>
            )}
          </Box>
        );
      })}
    </Stack>
  );
});

AnnouncementList.displayName = 'AnnouncementList';

export default AnnouncementList;
