from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src/components/chat"
sidebar_path = ROOT / "ChatSidebar.jsx"
src = sidebar_path.read_text(encoding="utf-8")
start = src.index("function SidebarSkeletonRow")
end = src.index("function ChatSidebar(")
block = src[start:end]

header = """import { useRef } from 'react';
import { Checkbox, CircularProgress, Menu, MenuItem, Skeleton, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import ExitToAppRoundedIcon from '@mui/icons-material/ExitToAppRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import NotificationsOffOutlinedIcon from '@mui/icons-material/NotificationsOffOutlined';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { motion } from 'framer-motion';

import { AiConversationAvatar, ConversationAvatar, PresenceAvatar } from './ChatCommon';
import { getConversationFolderIds } from './chatFolderUtils';
import {
  formatShortTime,
  getConversationDisplayTitle,
  getConversationStatusLine,
  getPersonStatusLine,
  getStatusMeta,
  getTaskConversationMetaLine,
  isCompletedTaskConversation,
  isTaskConversation,
} from './chatHelpers';

const joinClasses = (...values) => values.filter(Boolean).join(' ');
const FALLBACK_DENSITY = {
  touchTarget: 44,
  sidebarAvatar: 52,
  sidebarAvatarMobile: 54,
  sidebarActionButton: 36,
  sidebarActionButtonMobile: 44,
  sidebarHeaderIcon: 42,
  sidebarSearchHeight: 48,
  sidebarSearchFontSize: '16px',
  sidebarRowMinHeight: 66,
  sidebarRowPx: 12,
  sidebarRowPy: 10,
  sidebarRowMx: 6,
  sidebarRowMy: 2,
  sidebarRowRadius: 12,
  sidebarResultRowPx: 14,
  sidebarResultRowPy: 12,
  sidebarTitleFontSize: '15px',
  sidebarResultTitleFontSize: '16px',
  sidebarPreviewFontSize: '12.5px',
  sidebarSectionFontSize: '11px',
};
const getDensity = (ui) => ui?.density || FALLBACK_DENSITY;
const getSidebarAvatarSize = (density, compactMobile = false) => (
  compactMobile ? (density.sidebarAvatarMobile || 54) : (density.sidebarAvatar || 52)
);
const getSidebarRowStyle = (density, compactMobile = false) => {
  if (compactMobile) return {};
  return {
    minHeight: density.sidebarRowMinHeight,
    padding: `${density.sidebarRowPy}px ${density.sidebarRowPx}px`,
    margin: `${density.sidebarRowMy}px ${density.sidebarRowMx}px`,
    borderRadius: density.sidebarRowRadius,
  };
};

"""

exports = """
export {
  SidebarSkeletonRow,
  SidebarLoadingSkeleton,
  SearchSectionHeader,
  TaskSectionHeader,
  SidebarActionButton,
  ConversationRow,
  PersonSearchRow,
  AiBotRow,
  AiConversationRow,
  InfoCard,
};
"""

(ROOT / "ChatSidebarRows.jsx").write_text(header + block + exports, encoding="utf-8")
new_src = src[:start] + src[end:]
import_line = """import {
  AiBotRow,
  AiConversationRow,
  ConversationRow,
  InfoCard,
  PersonSearchRow,
  SearchSectionHeader,
  SidebarActionButton,
  SidebarLoadingSkeleton,
  SidebarSkeletonRow,
  TaskSectionHeader,
} from './ChatSidebarRows';
"""
new_src = new_src.replace(
    "import { useMainLayoutShell } from '../layout/MainLayoutShellContext';",
    import_line + "import { useMainLayoutShell } from '../layout/MainLayoutShellContext';",
)
sidebar_path.write_text(new_src, encoding="utf-8")
print("done", len(block.splitlines()), "lines extracted")
