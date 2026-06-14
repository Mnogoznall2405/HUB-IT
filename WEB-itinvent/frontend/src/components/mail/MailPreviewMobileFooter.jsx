import { Box } from '@mui/material';
import MailPreviewMobileActionBar from './MailPreviewMobileActionBar';

export default function MailPreviewMobileFooter({
  actionBarProps = {},
}) {
  return (
    <Box data-testid="mail-preview-mobile-footer">
      <MailPreviewMobileActionBar {...actionBarProps} />
    </Box>
  );
}
