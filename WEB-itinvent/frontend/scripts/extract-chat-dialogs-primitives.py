from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src/components/chat"
dialogs_path = ROOT / "ChatDialogs.jsx"
src = dialogs_path.read_text(encoding="utf-8")
start = src.index("function DialogSkeletonLine")
end = src.index("export default function ChatDialogs")
block = src[start:end]

header = """import { Checkbox, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

import { PresenceAvatar } from './ChatCommon';
import { CHAT_FONT_FAMILY } from './chatUiTokens';

"""

exports = """
export {
  DialogSkeletonLine,
  DialogListSkeleton,
  SearchResultCard,
  GroupUserRow,
  GroupUserCheckboxRow,
  SelectedUserPill,
};
"""

(ROOT / "ChatDialogsPrimitives.jsx").write_text(header + block + exports, encoding="utf-8")
new_src = src[:start] + src[end:]
import_line = """import {
  DialogListSkeleton,
  DialogSkeletonLine,
  GroupUserCheckboxRow,
  GroupUserRow,
  SearchResultCard,
  SelectedUserPill,
} from './ChatDialogsPrimitives';
"""
new_src = new_src.replace(
    "import { CHAT_FONT_FAMILY } from './chatUiTokens';",
    "import { CHAT_FONT_FAMILY } from './chatUiTokens';\n" + import_line,
)
dialogs_path.write_text(new_src, encoding="utf-8")
print("done", len(block.splitlines()), "lines extracted")
