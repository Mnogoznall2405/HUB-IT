from pathlib import Path

tasks_path = Path(__file__).resolve().parents[1] / 'src' / 'pages' / 'Tasks.jsx'
out_path = Path(__file__).resolve().parents[1] / 'src' / 'components' / 'hub' / 'tasks' / 'TasksAnalyticsView.jsx'
lines = tasks_path.read_text(encoding='utf-8').splitlines()

# Inner analytics box: lines 4002-4674 (1-based)
block = '\n'.join(lines[4001:4674])

replacements = [
    ('onClick={handleExportTaskAnalytics}', 'onClick={onExport}'),
    ('onClick={toggleAnalyticsFilters}', 'onClick={onToggleFilters}'),
    ('onClick={() => selectAnalyticsParticipant(', 'onClick={() => onSelectParticipant('),
    ('{analyticsFiltersVisible ?', '{filtersVisible ?'),
    ('in={analyticsFiltersVisible}', 'in={filtersVisible}'),
]

for old, new in replacements:
    block = block.replace(old, new)

# Replace duplicated inline desktop filters with shared panel component.
start_marker = '{!isAnalyticsMobile && (\n                          <Collapse in={filtersVisible}'
end_marker = '                        )}\n                      </Stack>\n                    </Card>\n                  </Box>\n                  ) : null}'

start_idx = block.find(start_marker)
end_idx = block.find(end_marker)
if start_idx == -1 or end_idx == -1:
    raise SystemExit('Could not locate inline filters block for replacement')

replacement_filters = '''{!isAnalyticsMobile ? (
                          <Collapse in={filtersVisible} timeout="auto" unmountOnExit={false}>
                            {filtersPanel}
                          </Collapse>
                        ) : null}'''

block = block[:start_idx] + replacement_filters + block[end_idx + len(end_marker):]

header = '''import {
  Box,
  Button,
  Card,
  Chip,
  Collapse,
  Grid,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import DownloadIcon from '@mui/icons-material/Download';
import FilterListIcon from '@mui/icons-material/FilterList';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useMemo } from 'react';

import { buildAnalyticsTableColumns } from '../../../pages/tasks/taskAnalyticsModel';
import { formatPercent } from '../../../pages/tasks/taskFormatters';
import {
  getOfficeEmptyStateSx,
  getOfficeMetricBlockSx,
  getOfficePanelSx,
  getOfficeSubtlePanelSx,
} from '../../../theme/officeUiTokens';

export default function TasksAnalyticsView({
  ui,
  isAnalyticsMobile = false,
  filtersVisible = true,
  onToggleFilters,
  onExport,
  analyticsLoading = false,
  analyticsExporting = false,
  analyticsAccentColor = '#2563eb',
  analyticsGridStroke,
  analyticsFocusMeta,
  filtersPanel = null,
  analyticsKpis = [],
  analyticsPayload = null,
  analyticsProjectSectionMeta = null,
  selectedAnalyticsProjects = [],
  selectedAnalyticsObjects = [],
  onSelectParticipant,
  analyticsStatusChartData = [],
  analyticsTrendItems = [],
  analyticsParticipantSectionMeta = { title: '', subtitle: '' },
  analyticsParticipantChartData = [],
  analyticsScopeChart = { title: '', rows: [] },
  selectedAnalyticsParticipant = null,
  analyticsTableColumns: analyticsTableColumnsProp,
}) {
  const theme = useTheme();
  const analyticsTableColumns = useMemo(
    () => analyticsTableColumnsProp || buildAnalyticsTableColumns(),
    [analyticsTableColumnsProp],
  );
  const gridStroke = analyticsGridStroke || ui?.borderSoft || 'rgba(148,163,184,0.22)';

  return (
'''

footer = '''
  );
}
'''

out_path.write_text(header + block + footer, encoding='utf-8')
print(f'Wrote {out_path}')
