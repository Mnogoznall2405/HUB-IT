[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ProjectRoot = 'C:\Project\Image_scan'
)

$ErrorActionPreference = 'Stop'

$expectedRoot = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot 'data\my_files'))
$storageRoot = [System.IO.Path]::GetFullPath($expectedRoot)
if ($storageRoot -ne 'C:\Project\Image_scan\data\my_files') {
    throw "Unexpected my-files storage path: $storageRoot"
}
if (-not (Test-Path -LiteralPath $storageRoot -PathType Container)) {
    throw "My-files storage directory not found: $storageRoot"
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
$adminRole = [System.Security.Principal.WindowsBuiltInRole]::Administrator
if (-not $principal.IsInRole($adminRole)) {
    throw 'Run this script from an elevated PowerShell session.'
}

$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$administrators = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$allowedSids = @($system.Value, $administrators.Value)

function New-RestrictedAcl {
    param(
        [bool]$IsDirectory
    )

    $acl = if ($IsDirectory) {
        [System.Security.AccessControl.DirectorySecurity]::new()
    } else {
        [System.Security.AccessControl.FileSecurity]::new()
    }
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($administrators)

    $inheritance = if ($IsDirectory) {
        [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    } else {
        [System.Security.AccessControl.InheritanceFlags]::None
    }
    foreach ($account in @($system, $administrators)) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $account,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        [void]$acl.AddAccessRule($rule)
    }
    return $acl
}

$children = @(Get-ChildItem -LiteralPath $storageRoot -Force -Recurse | Sort-Object { $_.FullName.Length } -Descending)
foreach ($item in $children) {
    if ($PSCmdlet.ShouldProcess($item.FullName, 'Restrict ACL to SYSTEM and Administrators')) {
        Set-Acl -LiteralPath $item.FullName -AclObject (New-RestrictedAcl -IsDirectory:$item.PSIsContainer)
    }
}
if ($PSCmdlet.ShouldProcess($storageRoot, 'Restrict ACL to SYSTEM and Administrators')) {
    Set-Acl -LiteralPath $storageRoot -AclObject (New-RestrictedAcl -IsDirectory:$true)
}

if ($WhatIfPreference) {
    return
}

$violations = @()
foreach ($path in @($storageRoot) + @($children.FullName)) {
    $acl = Get-Acl -LiteralPath $path
    foreach ($rule in $acl.Access) {
        try {
            $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        } catch {
            $sid = ''
        }
        if ($rule.IsInherited -or $sid -notin $allowedSids) {
            $violations += "$path -> $($rule.IdentityReference.Value) ($($rule.FileSystemRights))"
        }
    }
}

if ($violations.Count -gt 0) {
    throw "Unexpected ACL entries remain:`n$($violations -join "`n")"
}

Write-Host "My-files ACL restricted successfully: $storageRoot" -ForegroundColor Green
