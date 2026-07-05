import { alpha } from '@mui/material/styles';

export const TELEGRAM_LIGHT_THREAD_PATTERN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160' fill='none' stroke='%2389a36a' stroke-opacity='0.22' stroke-width='1.35' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 29c7-7 16-7 23 0 7 7 16 7 23 0'/%3E%3Cpath d='M111 20c5 0 9 4 9 9s-4 9-9 9-9-4-9-9 4-9 9-9Z'/%3E%3Cpath d='M118 70c10-8 20-8 30 0'/%3E%3Cpath d='M19 95h18l7 12 8-24 8 17h18'/%3E%3Cpath d='M103 111c4-8 12-13 21-13 5 0 10 2 14 5-4 8-12 13-21 13-5 0-10-2-14-5Z'/%3E%3Cpath d='M53 133c0-6 5-11 11-11s11 5 11 11-5 11-11 11-11-5-11-11Z'/%3E%3Cpath d='M128 134l8-8m0 8-8-8'/%3E%3Cpath d='M76 42l5 10 11 2-8 8 2 11-10-6-10 6 2-11-8-8 11-2 5-10Z'/%3E%3C/svg%3E\")";

export const TELEGRAM_DARK_THREAD_PATTERN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160' fill='none' stroke='%23788fa3' stroke-opacity='0.18' stroke-width='1.25' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 29c7-7 16-7 23 0 7 7 16 7 23 0'/%3E%3Cpath d='M111 20c5 0 9 4 9 9s-4 9-9 9-9-4-9-9 4-9 9-9Z'/%3E%3Cpath d='M118 70c10-8 20-8 30 0'/%3E%3Cpath d='M19 95h18l7 12 8-24 8 17h18'/%3E%3Cpath d='M103 111c4-8 12-13 21-13 5 0 10 2 14 5-4 8-12 13-21 13-5 0-10-2-14-5Z'/%3E%3Cpath d='M53 133c0-6 5-11 11-11s11 5 11 11-5 11-11 11-11-5-11-11Z'/%3E%3Cpath d='M128 134l8-8m0 8-8-8'/%3E%3Cpath d='M76 42l5 10 11 2-8 8 2 11-10-6-10 6 2-11-8-8 11-2 5-10Z'/%3E%3C/svg%3E\")";

export function buildChatThreadWallpaperSx(theme, ui) {
  if (theme.palette.mode === 'dark') {
    return {
      backgroundColor: ui.threadBg,
      backgroundImage: `
        radial-gradient(circle at 0% 0%, ${alpha(theme.palette.primary.main, 0.1)} 0%, transparent 34%),
        radial-gradient(circle at 100% 100%, ${alpha('#78a7c6', 0.08)} 0%, transparent 32%),
        linear-gradient(180deg, ${alpha('#17212b', 0.64)} 0%, ${alpha(ui.threadBg, 0.96)} 100%),
        ${TELEGRAM_DARK_THREAD_PATTERN}
      `,
      backgroundSize: 'auto, auto, auto, 160px 160px',
      backgroundPosition: '0 0, 100% 100%, 0 0, 0 0',
    };
  }
  return {
    backgroundColor: ui.threadBg,
    backgroundImage: `
      radial-gradient(circle at 0% 0%, rgba(246, 234, 161, 0.82) 0%, rgba(246, 234, 161, 0) 33%),
      radial-gradient(circle at 100% 100%, rgba(243, 233, 171, 0.62) 0%, rgba(243, 233, 171, 0) 32%),
      linear-gradient(135deg, rgba(229, 239, 181, 0.82) 0%, rgba(191, 219, 151, 0.9) 44%, rgba(168, 208, 151, 0.94) 100%),
      ${TELEGRAM_LIGHT_THREAD_PATTERN}
    `,
    backgroundSize: 'auto, auto, auto, 160px 160px',
    backgroundPosition: '0 0, 100% 100%, 0 0, 0 0',
  };
}
