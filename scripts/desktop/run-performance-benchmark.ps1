[CmdletBinding()]
param(
    [ValidateRange(1, 20)]
    [int]$Runs = 5,

    [ValidateSet('Cold', 'Warm', 'Both')]
    [string]$Mode = 'Both',

    [string]$Route = '',

    [ValidateRange(5000, 180000)]
    [int]$ReadyTimeoutMs = 60000,

    [ValidateRange(1, 10000)]
    [int]$QuitDelayMs = 750,

    [string]$OutputRoot = '',

    [switch]$NoBuild,
    [switch]$NoRestore,
    [switch]$RequireAuthenticated,
    [switch]$KeepProfiles
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$project = Join-Path $repoRoot 'desktop\Hub.Desktop\Hub.Desktop.csproj'
$nugetConfig = Join-Path $repoRoot 'desktop\NuGet.Config'
$dotnet = Join-Path $repoRoot 'tools\dotnet-sdk-8\dotnet.exe'
if (-not (Test-Path -LiteralPath $dotnet -PathType Leaf)) {
    $dotnet = (Get-Command dotnet -ErrorAction Stop).Source
}

$allowedRoutes = @('', '/dashboard', '/chat', '/mail', '/tasks')
if ($Route -notin $allowedRoutes) {
    throw "Unsupported route '$Route'. Allowed routes: /dashboard, /chat, /mail, /tasks."
}

$loginUser = [Environment]::GetEnvironmentVariable('HUB_DESKTOP_PERF_LOGIN_USER', 'Process')
$loginPassword = [Environment]::GetEnvironmentVariable('HUB_DESKTOP_PERF_LOGIN_PASSWORD', 'Process')
$hasCredentials = -not [string]::IsNullOrWhiteSpace($loginUser) `
    -and -not [string]::IsNullOrWhiteSpace($loginPassword)
if (($RequireAuthenticated -or -not [string]::IsNullOrWhiteSpace($Route)) -and -not $hasCredentials) {
    throw 'Authenticated benchmark requires HUB_DESKTOP_PERF_LOGIN_USER and HUB_DESKTOP_PERF_LOGIN_PASSWORD in the process environment.'
}

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss')
    $OutputRoot = Join-Path $repoRoot "artifacts\desktop\perf\$stamp"
}
elseif (-not [IO.Path]::IsPathRooted($OutputRoot)) {
    $OutputRoot = Join-Path $repoRoot $OutputRoot
}
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$runsRoot = Join-Path $OutputRoot 'runs'
New-Item -ItemType Directory -Path $runsRoot -Force | Out-Null

function Invoke-Checked([scriptblock]$Command, [string]$Description) {
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE"
    }
}

if (-not $NoBuild) {
    if (-not $NoRestore) {
        Invoke-Checked {
            & $dotnet restore $project --configfile $nugetConfig
        } 'Desktop PerfBench restore'
    }
    Invoke-Checked {
        & $dotnet build $project -c PerfBench --no-restore
    } 'Desktop PerfBench build'
}

$buildRoot = Join-Path $repoRoot 'desktop\Hub.Desktop\bin\PerfBench'
$executable = Get-ChildItem -LiteralPath $buildRoot -Filter 'HUB.Desktop.exe' -File -Recurse -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if ($null -eq $executable) {
    throw "PerfBench executable was not found under '$buildRoot'. Run without -NoBuild first."
}

function Get-MarkEvent([object[]]$Events, [string]$Mark) {
    $matches = @($Events | Where-Object { [string]$_.mark -eq $Mark })
    if ($matches.Count -eq 0) {
        return $null
    }
    return $matches[-1]
}

function Get-NumericField([object]$Event, [string]$Field) {
    if ($null -eq $Event) {
        return $null
    }
    $property = $Event.PSObject.Properties[$Field]
    if ($null -eq $property -or $null -eq $property.Value) {
        return $null
    }
    return [double]$property.Value
}

function Read-BenchMetrics([string]$Path) {
    $events = [System.Collections.Generic.List[object]]::new()
    foreach ($line in @(Get-Content -LiteralPath $Path -Encoding utf8)) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        try {
            $events.Add(($line | ConvertFrom-Json))
        }
        catch {
            throw "Invalid benchmark JSONL in '$Path': $($_.Exception.Message)"
        }
    }

    $frontend = Get-MarkEvent $events 'frontend_probe'
    $processes = Get-MarkEvent $events 'frontend_probe_processes'
    $firstPaint = Get-MarkEvent $events 'first_paint'
    $metrics = [ordered]@{}
    foreach ($mark in @(
        'app_startup_complete',
        'window_shown',
        'webview_ready',
        'navigation_completed',
        'bridge_ready',
        'bench_ready'
    )) {
        $metrics["${mark}_ms"] = Get-NumericField (Get-MarkEvent $events $mark) 't_ms'
    }
    $metrics['first_paint_ms'] = Get-NumericField $firstPaint 'first_paint_ms'
    foreach ($field in @(
        'fcp',
        'nav_ms',
        'request_count',
        'transferred_bytes',
        'decoded_js',
        'long_tasks',
        'long_task_ms',
        'script_duration_ms'
    )) {
        $metrics[$field] = Get-NumericField $frontend $field
    }
    foreach ($field in @(
        'private_bytes',
        'working_set',
        'cpu_ms',
        'renderer_count',
        'renderer_private_bytes'
    )) {
        $metrics[$field] = Get-NumericField $processes $field
    }

    $authenticated = $null -ne (Get-MarkEvent $events 'authenticated_ready')
    $routeReady = $null -ne (Get-MarkEvent $events 'route_ready')
    $smoke = if ($null -ne (Get-MarkEvent $events 'functional_smoke_ok')) {
        'ok'
    }
    elseif ($null -ne (Get-MarkEvent $events 'functional_smoke_failed')) {
        'failed'
    }
    else {
        'not_run'
    }

    return [pscustomobject]@{
        Metrics = [pscustomobject]$metrics
        Authenticated = $authenticated
        RouteReady = $routeReady
        FunctionalSmoke = $smoke
        EventCount = $events.Count
    }
}

function Get-Percentile([double[]]$Values, [double]$Percentile) {
    if ($Values.Count -eq 0) {
        return $null
    }
    $ordered = @($Values | Sort-Object)
    $index = [int][Math]::Max(0, [Math]::Ceiling($Percentile * $ordered.Count) - 1)
    return [Math]::Round([double]$ordered[$index], 2)
}

function Get-MetricSummary([double[]]$Values) {
    if ($Values.Count -eq 0) {
        return $null
    }
    return [pscustomobject]@{
        samples = $Values.Count
        min = [Math]::Round(($Values | Measure-Object -Minimum).Minimum, 2)
        p50 = Get-Percentile $Values 0.50
        p95 = Get-Percentile $Values 0.95
        max = [Math]::Round(($Values | Measure-Object -Maximum).Maximum, 2)
    }
}

$benchmarkVariables = @(
    'HUB_DESKTOP_PERF_BENCH',
    'HUB_DESKTOP_ISOLATED_ROOT',
    'HUB_DESKTOP_USER_DATA_FOLDER',
    'HUB_DESKTOP_PERF_OUT',
    'HUB_DESKTOP_PERF_QUIT_AFTER_MS',
    'HUB_DESKTOP_PERF_PATH'
)
$savedEnvironment = @{}
foreach ($name in $benchmarkVariables) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$tempBase = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'HUB-IT\DesktopPerf'))
$runtimeRoot = Join-Path $tempBase ([Guid]::NewGuid().ToString('N'))
$runResults = [System.Collections.Generic.List[object]]::new()
$activeProcess = $null

function Invoke-BenchRun(
    [string]$Scenario,
    [int]$Number,
    [bool]$Warmup,
    [string]$ProfilePath
) {
    $suffix = if ($Warmup) { 'warmup' } else { $Number.ToString('000') }
    $runName = "$($Scenario.ToLowerInvariant())-$suffix"
    $outputPath = Join-Path $runsRoot "$runName.jsonl"
    $readyPath = "$outputPath.ready"
    if ((Test-Path -LiteralPath $outputPath) -or (Test-Path -LiteralPath $readyPath)) {
        throw "Benchmark output already exists for '$runName': '$outputPath'."
    }

    $isolatedRoot = Join-Path $runtimeRoot "roots\$runName"
    New-Item -ItemType Directory -Path $isolatedRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $ProfilePath -Force | Out-Null

    [Environment]::SetEnvironmentVariable('HUB_DESKTOP_PERF_BENCH', '1', 'Process')
    [Environment]::SetEnvironmentVariable('HUB_DESKTOP_ISOLATED_ROOT', $isolatedRoot, 'Process')
    [Environment]::SetEnvironmentVariable('HUB_DESKTOP_USER_DATA_FOLDER', $ProfilePath, 'Process')
    [Environment]::SetEnvironmentVariable('HUB_DESKTOP_PERF_OUT', $outputPath, 'Process')
    [Environment]::SetEnvironmentVariable('HUB_DESKTOP_PERF_QUIT_AFTER_MS', $QuitDelayMs.ToString(), 'Process')
    [Environment]::SetEnvironmentVariable(
        'HUB_DESKTOP_PERF_PATH',
        $(if ([string]::IsNullOrWhiteSpace($Route)) { $null } else { $Route }),
        'Process')

    Write-Host "Running $runName..."
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $script:activeProcess = Start-Process `
        -FilePath $executable.FullName `
        -WorkingDirectory $executable.DirectoryName `
        -PassThru
    $deadline = [DateTimeOffset]::UtcNow.AddMilliseconds($ReadyTimeoutMs)
    while (-not (Test-Path -LiteralPath $readyPath) `
        -and -not $script:activeProcess.HasExited `
        -and [DateTimeOffset]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 100
        $script:activeProcess.Refresh()
    }

    $ready = Test-Path -LiteralPath $readyPath
    $runnerReadyMs = if ($ready) { $watch.ElapsedMilliseconds } else { $null }
    if (-not $script:activeProcess.HasExited) {
        $exitWaitMs = [Math]::Max(15000, $QuitDelayMs + 10000)
        if (-not $script:activeProcess.WaitForExit($exitWaitMs)) {
            Stop-Process -Id $script:activeProcess.Id -Force -ErrorAction SilentlyContinue
            $script:activeProcess.WaitForExit(5000) | Out-Null
        }
    }
    $watch.Stop()
    $script:activeProcess.Refresh()
    $exitCode = if ($script:activeProcess.HasExited) { $script:activeProcess.ExitCode } else { -1 }
    $script:activeProcess.Dispose()
    $script:activeProcess = $null

    $parsed = if (Test-Path -LiteralPath $outputPath -PathType Leaf) {
        Read-BenchMetrics $outputPath
    }
    else {
        [pscustomobject]@{
            Metrics = [pscustomobject]@{}
            Authenticated = $false
            RouteReady = $false
            FunctionalSmoke = 'not_run'
            EventCount = 0
        }
    }
    $benchReady = $null -ne $parsed.Metrics.PSObject.Properties['bench_ready_ms'] `
        -and $null -ne $parsed.Metrics.bench_ready_ms
    $bridgeReady = $null -ne $parsed.Metrics.PSObject.Properties['bridge_ready_ms'] `
        -and $null -ne $parsed.Metrics.bridge_ready_ms
    $success = $ready -and $benchReady -and $bridgeReady -and $exitCode -eq 0
    if ($RequireAuthenticated -or -not [string]::IsNullOrWhiteSpace($Route)) {
        $success = $success -and $parsed.Authenticated
    }
    if (-not [string]::IsNullOrWhiteSpace($Route)) {
        $success = $success -and $parsed.RouteReady
    }
    if (-not [string]::IsNullOrWhiteSpace($Route) `
        -and $Route -in @('/chat', '/tasks')) {
        $success = $success -and $parsed.FunctionalSmoke -eq 'ok'
    }

    return [pscustomobject]@{
        scenario = $Scenario.ToLowerInvariant()
        run = $Number
        warmup = $Warmup
        success = $success
        ready_sentinel = $ready
        runner_ready_ms = $runnerReadyMs
        exit_code = $exitCode
        authenticated = $parsed.Authenticated
        route_ready = $parsed.RouteReady
        functional_smoke = $parsed.FunctionalSmoke
        event_count = $parsed.EventCount
        output = $outputPath.Substring($OutputRoot.TrimEnd('\').Length).TrimStart('\')
        metrics = $parsed.Metrics
    }
}

try {
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    if ($Mode -in @('Cold', 'Both')) {
        foreach ($number in 1..$Runs) {
            $profile = Join-Path $runtimeRoot "profiles\cold-$($number.ToString('000'))"
            $runResults.Add((Invoke-BenchRun 'Cold' $number $false $profile))
        }
    }
    if ($Mode -in @('Warm', 'Both')) {
        $warmProfile = Join-Path $runtimeRoot 'profiles\warm'
        $runResults.Add((Invoke-BenchRun 'Warm' 0 $true $warmProfile))
        foreach ($number in 1..$Runs) {
            $runResults.Add((Invoke-BenchRun 'Warm' $number $false $warmProfile))
        }
    }
}
finally {
    if ($null -ne $activeProcess -and -not $activeProcess.HasExited) {
        Stop-Process -Id $activeProcess.Id -Force -ErrorAction SilentlyContinue
        $activeProcess.WaitForExit(5000) | Out-Null
    }
    foreach ($name in $benchmarkVariables) {
        [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
    if (-not $KeepProfiles -and (Test-Path -LiteralPath $runtimeRoot)) {
        $resolvedRuntime = [IO.Path]::GetFullPath($runtimeRoot)
        $safePrefix = $tempBase.TrimEnd('\') + '\'
        if (-not $resolvedRuntime.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove unexpected benchmark runtime path '$resolvedRuntime'."
        }
        $deletePath = '\\?\' + $resolvedRuntime
        foreach ($attempt in 1..3) {
            try {
                [IO.Directory]::Delete($deletePath, $true)
                break
            }
            catch {
                if ($attempt -lt 3) {
                    Start-Sleep -Milliseconds 500
                }
            }
        }
        if (Test-Path -LiteralPath $resolvedRuntime) {
            Write-Warning "Temporary WebView2 profile cleanup is incomplete: '$resolvedRuntime'."
        }
    }
}

$measuredRuns = @($runResults | Where-Object { -not $_.warmup })
$scenarioReports = [System.Collections.Generic.List[object]]::new()
foreach ($scenario in @('cold', 'warm')) {
    $scenarioRuns = @($measuredRuns | Where-Object { $_.scenario -eq $scenario })
    if ($scenarioRuns.Count -eq 0) {
        continue
    }
    $metricNames = @(
        $scenarioRuns |
            ForEach-Object { $_.metrics.PSObject.Properties.Name } |
            Sort-Object -Unique
    )
    $metrics = [ordered]@{}
    foreach ($metricName in $metricNames) {
        $values = @(
            $scenarioRuns |
                Where-Object { $_.success } |
                ForEach-Object {
                    $property = $_.metrics.PSObject.Properties[$metricName]
                    if ($null -ne $property -and $null -ne $property.Value) {
                        [double]$property.Value
                    }
                }
        )
        $summary = Get-MetricSummary $values
        if ($null -ne $summary) {
            $metrics[$metricName] = $summary
        }
    }
    $scenarioReports.Add([pscustomobject]@{
        scenario = $scenario
        requested_runs = $scenarioRuns.Count
        successful_runs = @($scenarioRuns | Where-Object { $_.success }).Count
        metrics = [pscustomobject]$metrics
    })
}

$report = [pscustomobject]@{
    generated_utc = [DateTimeOffset]::UtcNow.ToString('O')
    configuration = 'PerfBench'
    mode = $Mode.ToLowerInvariant()
    route = if ([string]::IsNullOrWhiteSpace($Route)) { $null } else { $Route }
    authentication_required = [bool]$RequireAuthenticated
    requested_runs_per_scenario = $Runs
    successful_runs = @($measuredRuns | Where-Object { $_.success }).Count
    failed_runs = @($measuredRuns | Where-Object { -not $_.success }).Count
    failed_warmups = @($runResults | Where-Object { $_.warmup -and -not $_.success }).Count
    runs = @($runResults)
    scenarios = @($scenarioReports)
}

$reportJson = Join-Path $OutputRoot 'report.json'
$reportMarkdown = Join-Path $OutputRoot 'report.md'
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportJson -Encoding utf8

$markdown = [System.Collections.Generic.List[string]]::new()
$markdown.Add('# HUB Desktop performance benchmark')
$markdown.Add('')
$markdown.Add("- Generated UTC: $($report.generated_utc)")
$markdown.Add("- Mode: $($report.mode)")
$markdown.Add("- Route: $(if ($null -eq $report.route) { 'startup only' } else { $report.route })")
$markdown.Add("- Successful measured runs: $($report.successful_runs)")
$markdown.Add("- Failed measured runs: $($report.failed_runs)")
$markdown.Add("- Failed warmups: $($report.failed_warmups)")
foreach ($scenarioReport in $scenarioReports) {
    $markdown.Add('')
    $markdown.Add("## $($scenarioReport.scenario)")
    $markdown.Add('')
    $markdown.Add('| Metric | Samples | Min | p50 | p95 | Max |')
    $markdown.Add('|---|---:|---:|---:|---:|---:|')
    foreach ($property in $scenarioReport.metrics.PSObject.Properties) {
        $value = $property.Value
        $markdown.Add("| $($property.Name) | $($value.samples) | $($value.min) | $($value.p50) | $($value.p95) | $($value.max) |")
    }
}
$markdown | Set-Content -LiteralPath $reportMarkdown -Encoding utf8

Write-Host "Benchmark report: $reportMarkdown"
if ($report.failed_runs -gt 0 -or $report.failed_warmups -gt 0) {
    throw "$($report.failed_runs) measured run(s) and $($report.failed_warmups) warmup(s) failed. See '$reportJson'."
}

$report
