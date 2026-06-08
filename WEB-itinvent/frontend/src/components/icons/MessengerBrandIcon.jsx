import { Box } from '@mui/material';

const BRAND_ICONS = {
  telegram: {
    src: '/icons/telegram.svg',
    alt: 'Telegram',
  },
  max: {
    src: '/icons/max.svg',
    alt: 'MAX',
  },
};

const MessengerBrandIcon = ({ brand, size = 20, sx, ...props }) => {
  const icon = BRAND_ICONS[brand];
  if (!icon) return null;

  return (
    <Box
      component="img"
      src={icon.src}
      alt=""
      aria-hidden
      {...props}
      sx={{
        width: size,
        height: size,
        display: 'block',
        flexShrink: 0,
        objectFit: 'contain',
        ...sx,
      }}
    />
  );
};

export const TelegramBrandIcon = (props) => <MessengerBrandIcon brand="telegram" {...props} />;

export const MaxBrandIcon = (props) => <MessengerBrandIcon brand="max" {...props} />;

export default MessengerBrandIcon;
