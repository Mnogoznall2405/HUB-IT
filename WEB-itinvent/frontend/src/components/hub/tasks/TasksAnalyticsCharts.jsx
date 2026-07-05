import {
  Box,
  Card,
  Grid,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
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

import {
  getOfficeEmptyStateSx,
  getOfficePanelSx,
} from '../../../theme/officeUiTokens';

export default function TasksAnalyticsCharts({
  ui,
  analyticsGridStroke,
  analyticsStatusChartData = [],
  analyticsTrendItems = [],
  analyticsPayload = null,
  analyticsParticipantSectionMeta = { title: '', subtitle: '' },
  analyticsParticipantChartData = [],
  analyticsScopeChart = { title: '', rows: [] },
}) {
  const gridStroke = analyticsGridStroke || ui?.borderSoft || 'rgba(148,163,184,0.22)';

  return (
    <Grid container spacing={1.2} sx={{ width: '100%' }}>
      <Grid item xs={12} lg={4}>
        <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }), height: '100%' }}>
          <Typography sx={{ fontWeight: 900, mb: 1 }}>Статусы</Typography>
          {analyticsStatusChartData.some((item) => Number(item?.value || 0) > 0) ? (
            <Box sx={{ width: '100%', height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={analyticsStatusChartData} dataKey="value" nameKey="label" innerRadius={56} outerRadius={88} paddingAngle={2}>
                    {analyticsStatusChartData.map((item) => <Cell key={item.status} fill={item.color} />)}
                  </Pie>
                  <RechartsTooltip formatter={(value, name) => [Number(value || 0), name]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Box>
          ) : (
            <Box sx={getOfficeEmptyStateSx(ui, { p: 2, minHeight: 220 })}>
              <Typography sx={{ fontWeight: 800 }}>Нет данных для диаграммы.</Typography>
            </Box>
          )}
        </Card>
      </Grid>

      <Grid item xs={12} lg={8}>
        <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }), height: '100%' }}>
          <Typography sx={{ fontWeight: 900, mb: 0.8 }}>Постановка и выполнение по времени</Typography>
          <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mb: 0.8 }}>
            Гранулярность: {analyticsPayload?.trend?.granularity || 'day'}
          </Typography>
          {analyticsTrendItems.length > 0 ? (
            <Box sx={{ width: '100%', height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analyticsTrendItems}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(gridStroke, 0.7)} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <RechartsTooltip />
                  <Legend />
                  <Line type="monotone" dataKey="created" name="По протоколу" stroke="#2563eb" strokeWidth={3} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="completed" name="Выполнено" stroke="#059669" strokeWidth={3} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="completed_on_time" name="В срок" stroke="#7c3aed" strokeWidth={2} dot={{ r: 1.5 }} activeDot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          ) : (
            <Box sx={getOfficeEmptyStateSx(ui, { p: 2, minHeight: 220 })}>
              <Typography sx={{ fontWeight: 800 }}>Нет временного ряда по выбранным фильтрам.</Typography>
            </Box>
          )}
        </Card>
      </Grid>

      <Grid item xs={12} lg={6}>
        <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }), height: '100%' }}>
          <Typography sx={{ fontWeight: 900, mb: 0.2 }}>{analyticsParticipantSectionMeta.title}</Typography>
          {analyticsParticipantSectionMeta.subtitle ? (
            <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mb: 0.9 }}>
              {analyticsParticipantSectionMeta.subtitle}
            </Typography>
          ) : <Box sx={{ mb: 0.9 }} />}
          {analyticsParticipantChartData.length > 0 ? (
            <Box sx={{ width: '100%', height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analyticsParticipantChartData} layout="vertical" margin={{ left: 16, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(gridStroke, 0.7)} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
                  <RechartsTooltip />
                  <Legend />
                  <Bar dataKey="open" name="Открыто" stackId="participant" fill="#2563eb" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="done" name="Выполнено" stackId="participant" fill="#059669" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="overdue" name="Просрочено" stackId="participant" fill="#dc2626" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          ) : (
            <Box sx={getOfficeEmptyStateSx(ui, { p: 2, minHeight: 240 })}>
              <Typography sx={{ fontWeight: 800 }}>Нет участников по текущим фильтрам.</Typography>
            </Box>
          )}
        </Card>
      </Grid>

      <Grid item xs={12} lg={6}>
        <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }), height: '100%' }}>
          <Typography sx={{ fontWeight: 900, mb: 1 }}>{analyticsScopeChart.title}</Typography>
          {analyticsScopeChart.rows.length > 0 ? (
            <Box sx={{ width: '100%', height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analyticsScopeChart.rows}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(gridStroke, 0.7)} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-18} textAnchor="end" height={70} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <RechartsTooltip />
                  <Legend />
                  <Bar dataKey="open" name="Открыто" stackId="scope" fill="#2563eb" />
                  <Bar dataKey="done" name="Выполнено" stackId="scope" fill="#059669" />
                  <Bar dataKey="overdue" name="Просрочено" stackId="scope" fill="#dc2626" />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          ) : (
            <Box sx={getOfficeEmptyStateSx(ui, { p: 2, minHeight: 240 })}>
              <Typography sx={{ fontWeight: 800 }}>Нет данных для сравнения проектов и объектов.</Typography>
            </Box>
          )}
        </Card>
      </Grid>
    </Grid>
  );
}
