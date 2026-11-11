import { hideMobileScrollbarSx } from './taskFormatters';

export const buildMobileTaskScrollSx = () => ({
  height: '100%',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  px: 0,
  pb: 'calc(58px + 16px + 8px)',
  ...hideMobileScrollbarSx,
});
