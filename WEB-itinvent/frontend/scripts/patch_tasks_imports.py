from pathlib import Path

path = Path(r'c:\Project\Image_scan\WEB-itinvent\frontend\src\pages\Tasks.jsx')
lines = path.read_text(encoding='utf-8').splitlines(keepends=True)

def find_line(prefix, start=0):
    for i in range(start, len(lines)):
        if lines[i].startswith(prefix):
            return i
    raise ValueError(f'not found: {prefix!r}')

# 1) add imports after taskUrlSync block
import_anchor = find_line("} from './tasks/taskUrlSync';\n")
extra_imports = (
    "import { TASKS_MOBILE_COPY } from './tasks/tasksMobileCopy';\n"
    "import { buildMobileTaskCardMenuItems } from './tasks/taskCardModel';\n"
)
if "tasksMobileCopy" not in ''.join(lines):
    lines.insert(import_anchor + 1, extra_imports)

hub_anchor = find_line("  TaskTagsRow,\n")
extra_hub = (
    "  TasksAnalyticsFiltersPanel,\n"
    "  TasksCreateMobileSheet,\n"
    "  TasksDesktopListView,\n"
)
if "TasksCreateMobileSheet" not in ''.join(lines):
    lines.insert(hub_anchor, extra_hub)

text = ''.join(lines)
path.write_text(text, encoding='utf-8')
print('imports ok')
