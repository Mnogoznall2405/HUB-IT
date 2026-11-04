import { Avatar } from '@mui/material';
import { useTheme } from '@mui/material/styles';

// The colour is stable per name, so the same person looks the same in every list.
const HUES = [210, 145, 25, 280, 340, 175, 50, 255];
const hueFor = (name) => HUES[[...String(name || '?')].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % HUES.length];

export default function PersonAvatar({ name, size = 28 }) {
  const theme = useTheme();
  const hue = hueFor(name);
  const dark = theme.palette.mode === 'dark';
  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        fontWeight: 700,
        flexShrink: 0,
        color: `hsl(${hue} 60% ${dark ? 80 : 30}%)`,
        bgcolor: `hsl(${hue} 55% ${dark ? 28 : 88}%)`,
      }}
    >
      {String(name || '?').trim().charAt(0).toUpperCase() || '?'}
    </Avatar>
  );
}
