[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedPath = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
if (-not $resolvedPath.EndsWith('.msi', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Expected an MSI file: $resolvedPath"
}

function Get-MsiProperty {
    param(
        [Parameter(Mandatory)]$Database,
        [Parameter(Mandatory)][string]$Name
    )

    if ($Name -notmatch '^[A-Z][A-Za-z0-9_]{0,71}$') {
        throw "Unsafe MSI property name: $Name"
    }

    $view = $null
    $record = $null
    try {
        $query = "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='$Name'"
        $view = $Database.GetType().InvokeMember(
            'OpenView',
            'InvokeMethod',
            $null,
            $Database,
            @($query))
        $view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
        $record = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
        if ($null -eq $record) {
            return $null
        }

        return $record.GetType().InvokeMember(
            'StringData',
            'GetProperty',
            $null,
            $record,
            @(1))
    }
    finally {
        if ($null -ne $record) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)
        }
        if ($null -ne $view) {
            try {
                $view.GetType().InvokeMember('Close', 'InvokeMethod', $null, $view, $null) | Out-Null
            }
            finally {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
            }
        }
    }
}

function Get-MsiFileNames {
    param([Parameter(Mandatory)]$Database)

    $view = $null
    try {
        $view = $Database.GetType().InvokeMember(
            'OpenView',
            'InvokeMethod',
            $null,
            $Database,
            @('SELECT `FileName` FROM `File`'))
        $view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null

        $names = [Collections.Generic.List[string]]::new()
        while ($true) {
            $record = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
            if ($null -eq $record) {
                break
            }

            try {
                $names.Add([string]$record.GetType().InvokeMember(
                    'StringData',
                    'GetProperty',
                    $null,
                    $record,
                    @(1)))
            }
            finally {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)
            }
        }

        return $names.ToArray()
    }
    finally {
        if ($null -ne $view) {
            try {
                $view.GetType().InvokeMember('Close', 'InvokeMethod', $null, $view, $null) | Out-Null
            }
            finally {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
            }
        }
    }
}

$installer = $null
$database = $null
try {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.GetType().InvokeMember(
        'OpenDatabase',
        'InvokeMethod',
        $null,
        $installer,
        @($resolvedPath, 0))

    [pscustomobject]@{
        Path = $resolvedPath
        ProductName = Get-MsiProperty -Database $database -Name 'ProductName'
        ProductVersion = Get-MsiProperty -Database $database -Name 'ProductVersion'
        Manufacturer = Get-MsiProperty -Database $database -Name 'Manufacturer'
        ProductCode = Get-MsiProperty -Database $database -Name 'ProductCode'
        UpgradeCode = Get-MsiProperty -Database $database -Name 'UpgradeCode'
        ProductLanguage = Get-MsiProperty -Database $database -Name 'ProductLanguage'
        Files = @(Get-MsiFileNames -Database $database)
    }
}
finally {
    if ($null -ne $database) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database)
    }
    if ($null -ne $installer) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)
    }
}
