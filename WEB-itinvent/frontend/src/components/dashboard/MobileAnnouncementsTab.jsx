import React from 'react';
import { Box, Stack, Tab, Tabs, Typography } from '@mui/material';
import AnnouncementList from './AnnouncementList';

const DASHBOARD_MOBILE_ANNOUNCEMENT_SEGMENTS = [
  { key: 'all', label: 'Все' },
  { key: 'ack', label: 'Подтвердить' },
  { key: 'new', label: 'Новые' },
  { key: 'pinned', label: 'Закрепленные' },
];

const MobileAnnouncementsTab = React.memo(({
  announcementSections,
  selectedSegment,
  onSegmentChange,
  onAnnouncementClick,
  onAcknowledge,
  ui,
}) => {
  const handleSegmentChange = React.useCallback((event, newValue) => {
    if (onSegmentChange) {
      onSegmentChange(newValue);
    }
  }, [onSegmentChange]);

  const currentSection = React.useMemo(() => {
    return announcementSections.find(s => s.key === selectedSegment) || announcementSections[0];
  }, [announcementSections, selectedSegment]);

  return (
    <Stack spacing={2}>
      {/* Segment Tabs */}
      <Box
        sx={{
          ...ui.panelSolid,
          p: 1,
        }}
      >
        <Tabs
          value={selectedSegment}
          onChange={handleSegmentChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 40,
            '& .MuiTab-root': {
              minHeight: 36,
              fontSize: '0.85rem',
              fontWeight: 600,
              textTransform: 'none',
              px: 2,
            },
          }}
        >
          {DASHBOARD_MOBILE_ANNOUNCEMENT_SEGMENTS.map((segment) => (
            <Tab
              key={segment.key}
              value={segment.key}
              label={segment.label}
            />
          ))}
        </Tabs>
      </Box>

      {/* Section Content */}
      {currentSection && (
        <Box>
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 700,
              mb: 1.5,
              color: ui.panelFg,
            }}
          >
            {currentSection.title}
          </Typography>

          <AnnouncementList
            sections={[currentSection]}
            onAnnouncementClick={onAnnouncementClick}
            onAcknowledge={onAcknowledge}
            ui={ui}
            isMobile
          />
        </Box>
      )}
    </Stack>
  );
});

MobileAnnouncementsTab.displayName = 'MobileAnnouncementsTab';

export default MobileAnnouncementsTab;
