from pathlib import Path

path = Path(r'c:\Project\Image_scan\WEB-itinvent\frontend\src\pages\Tasks.jsx')
lines = path.read_text(encoding='utf-8').splitlines(keepends=True)

start = None
end = None
for i, line in enumerate(lines):
    if line.strip() == "{pageMode === 'analytics' ? (":
        start = i
    if start is not None and i > start and line.strip() == ') : (':
        # next line should be renderTaskDataModeContent
        if i + 1 < len(lines) and 'renderTaskDataModeContent' in lines[i + 1]:
            end = i
            break

if start is None or end is None:
    raise SystemExit(f'Analytics block not found: start={start}, end={end}')

replacement = """            {pageMode === 'analytics' ? (
              <TasksAnalyticsView
                ui={ui}
                isAnalyticsMobile={isAnalyticsMobile}
                filtersVisible={analyticsFiltersVisible}
                onToggleFilters={toggleAnalyticsFilters}
                onExport={() => void handleExportTaskAnalytics()}
                analyticsLoading={analyticsLoading}
                analyticsExporting={analyticsExporting}
                analyticsAccentColor={analyticsAccentColor}
                analyticsGridStroke={analyticsGridStroke}
                analyticsFocusMeta={analyticsFocusMeta}
                filtersPanel={analyticsFiltersContent}
                analyticsKpis={analyticsKpis}
                analyticsPayload={analyticsPayload}
                analyticsProjectSectionMeta={analyticsProjectSectionMeta}
                selectedAnalyticsProjects={selectedAnalyticsProjects}
                selectedAnalyticsObjects={selectedAnalyticsObjects}
                onSelectParticipant={selectAnalyticsParticipant}
                analyticsStatusChartData={analyticsStatusChartData}
                analyticsTrendItems={analyticsTrendItems}
                analyticsParticipantSectionMeta={analyticsParticipantSectionMeta}
                analyticsParticipantChartData={analyticsParticipantChartData}
                analyticsScopeChart={analyticsScopeChart}
                selectedAnalyticsParticipant={selectedAnalyticsParticipant}
                analyticsTableColumns={analyticsTableColumns}
              />
"""

new_lines = lines[:start] + [replacement] + lines[end:]
path.write_text(''.join(new_lines), encoding='utf-8')
print(f'Replaced analytics block lines {start + 1}-{end}')
