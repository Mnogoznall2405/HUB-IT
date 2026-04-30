[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$ComputerName = "TMN-LAW-0033",

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$ListPath = (Join-Path -Path $PSScriptRoot -ChildPath "Py.txt"),

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$DestinationRoot = (Join-Path -Path $PSScriptRoot -ChildPath "moved_files")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function New-UniqueDestinationPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $Path
    }

    $directory = Split-Path -Path $Path -Parent
    $fileName = [System.IO.Path]::GetFileNameWithoutExtension($Path)
    $extension = [System.IO.Path]::GetExtension($Path)

    for ($index = 1; $index -lt [int]::MaxValue; $index++) {
        $candidate = Join-Path -Path $directory -ChildPath ("{0} ({1}){2}" -f $fileName, $index, $extension)
        if (-not (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    throw "Could not create a unique destination path for '$Path'."
}

function New-DestinationDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (Test-Path -LiteralPath $Path -PathType Container) {
        return
    }

    $escapedPath = [System.Management.Automation.WildcardPattern]::Escape($Path)
    New-Item -ItemType Directory -Path $escapedPath -Force | Out-Null
}

function New-LogRow {
    param(
        [Parameter(Mandatory = $true)]
        [int]$LineNumber,

        [Parameter(Mandatory = $true)]
        [string]$OriginalLine,

        [Parameter(Mandatory = $true)]
        [string]$SourcePath,

        [Parameter(Mandatory = $true)]
        [string]$RemotePath,

        [Parameter(Mandatory = $true)]
        [string]$DestinationPath,

        [Parameter(Mandatory = $true)]
        [string]$Status,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    [pscustomobject]@{
        LineNumber      = $LineNumber
        OriginalLine    = $OriginalLine
        SourcePath      = $SourcePath
        RemotePath      = $RemotePath
        DestinationPath = $DestinationPath
        Status          = $Status
        Message         = $Message
    }
}

$scriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$resolvedListPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ListPath)
$resolvedDestinationRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DestinationRoot)
$logPath = Join-Path -Path $scriptDirectory -ChildPath ("move_log_{0}.csv" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
$driveName = "TMNMOVE_{0}" -f ([guid]::NewGuid().ToString("N").Substring(0, 8))
$adminShare = "\\{0}\C$" -f $ComputerName
$logRows = New-Object System.Collections.Generic.List[object]
$lineNumber = 0

if (-not (Test-Path -LiteralPath $resolvedListPath -PathType Leaf)) {
    throw "List file was not found: $resolvedListPath"
}

$credential = Get-Credential -Message "Enter administrator credentials for $ComputerName"

try {
    New-PSDrive -Name $driveName -PSProvider FileSystem -Root $adminShare -Credential $credential | Out-Null

    New-DestinationDirectory -Path $resolvedDestinationRoot

    foreach ($line in [System.IO.File]::ReadLines($resolvedListPath, [System.Text.Encoding]::UTF8)) {
        $lineNumber++
        $originalLine = $line
        $sourcePath = (($line -split ";", 2)[0]).Trim()
        $remotePath = ""
        $remoteLogPath = ""
        $destinationPath = ""

        if ([string]::IsNullOrWhiteSpace($sourcePath)) {
            $logRows.Add((New-LogRow -LineNumber $lineNumber -OriginalLine $originalLine -SourcePath $sourcePath -RemotePath $remoteLogPath -DestinationPath $destinationPath -Status "SkippedInvalidPath" -Message "Empty path.")) | Out-Null
            continue
        }

        if ($sourcePath -notmatch "^[Cc]:\\") {
            $logRows.Add((New-LogRow -LineNumber $lineNumber -OriginalLine $originalLine -SourcePath $sourcePath -RemotePath $remoteLogPath -DestinationPath $destinationPath -Status "SkippedInvalidPath" -Message "Only C:\ paths are supported.")) | Out-Null
            continue
        }

        $relativePath = $sourcePath.Substring(3)
        if ([string]::IsNullOrWhiteSpace($relativePath)) {
            $logRows.Add((New-LogRow -LineNumber $lineNumber -OriginalLine $originalLine -SourcePath $sourcePath -RemotePath $remoteLogPath -DestinationPath $destinationPath -Status "SkippedInvalidPath" -Message "Path points to the root of C:.")) | Out-Null
            continue
        }

        $remotePath = Join-Path -Path ("{0}:\" -f $driveName) -ChildPath $relativePath
        $remoteLogPath = Join-Path -Path $adminShare -ChildPath $relativePath
        $destinationPath = Join-Path -Path $resolvedDestinationRoot -ChildPath $relativePath

        try {
            if (-not (Test-Path -LiteralPath $remotePath -PathType Leaf)) {
                $logRows.Add((New-LogRow -LineNumber $lineNumber -OriginalLine $originalLine -SourcePath $sourcePath -RemotePath $remoteLogPath -DestinationPath $destinationPath -Status "Missing" -Message "Source file was not found.")) | Out-Null
                continue
            }

            $destinationDirectory = Split-Path -Path $destinationPath -Parent
            $finalDestinationPath = New-UniqueDestinationPath -Path $destinationPath
            $finalDestinationDirectory = Split-Path -Path $finalDestinationPath -Parent

            if ($PSCmdlet.ShouldProcess($sourcePath, "Move to $finalDestinationPath")) {
                New-DestinationDirectory -Path $destinationDirectory
                New-DestinationDirectory -Path $finalDestinationDirectory
                Move-Item -LiteralPath $remotePath -Destination $finalDestinationPath

                $logRows.Add((New-LogRow -LineNumber $lineNumber -OriginalLine $originalLine -SourcePath $sourcePath -RemotePath $remoteLogPath -DestinationPath $finalDestinationPath -Status "Moved" -Message "File moved.")) | Out-Null
            }
            else {
                $logRows.Add((New-LogRow -LineNumber $lineNumber -OriginalLine $originalLine -SourcePath $sourcePath -RemotePath $remoteLogPath -DestinationPath $finalDestinationPath -Status "SkippedByShouldProcess" -Message "Move was skipped by WhatIf or confirmation response.")) | Out-Null
            }
        }
        catch {
            $logRows.Add((New-LogRow -LineNumber $lineNumber -OriginalLine $originalLine -SourcePath $sourcePath -RemotePath $remoteLogPath -DestinationPath $destinationPath -Status "Failed" -Message $_.Exception.Message)) | Out-Null
        }
    }
}
finally {
    if (Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue) {
        Remove-PSDrive -Name $driveName -Force
    }

    $logRows | Export-Csv -LiteralPath $logPath -NoTypeInformation -Encoding UTF8
    Write-Host "Log written to: $logPath"
}
