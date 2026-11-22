Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process HUB.Desktop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "no window"; exit 1 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document) {
        $doc = $e.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        Write-Output ('doc children: ' + $doc.Count)
        $i = 0
        foreach ($d in $doc) {
            if ($i++ -ge 40) { break }
            $name = ($d.Current.Name -replace "`n", ' ')
            if ($name.Length -gt 80) { $name = $name.Substring(0, 80) }
            Write-Output ($d.Current.ControlType.ProgrammaticName + ' | ' + $d.Current.ClassName + ' | ' + $name)
        }
        # TextPattern — прямое чтение содержимого документа, если поддерживается.
        try {
            $tp = $e.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
            $txt = $tp.DocumentRange.GetText(600)
            Write-Output '--- TextPattern ---'
            Write-Output $txt
        } catch { Write-Output 'no TextPattern' }
    }
}
