param([string]$TypeName = 'DataItem', [int]$Max = 60)
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$ct = [System.Windows.Automation.ControlType]::$TypeName
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ct)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
$n = 0
foreach ($e in $all) {
    $name = $e.Current.Name
    Write-Output ($e.Current.ClassName + ' | ' + $(if ($name) { $name.Substring(0, [Math]::Min(60, $name.Length)) } else { '<EMPTY>' }))
    $n++
    if ($n -ge $Max) { break }
}
Write-Output ("total " + $all.Count)
