# WEB-01: baseline layout capture — WPF side (live stand).
# Same fixture/theme/sizes as web01_capture.mjs: DM "E2E Пользователь"
# (id 2a534311-d6e6-4ec5-9e8d-ac531595013a), panel closed/open,
# dark+light, 1280x720 and 1024x600. ASCII only: .ps1 files without BOM
# are decoded as ANSI by Windows PowerShell — cyrillic literals corrupt.
$ErrorActionPreference = 'Stop'
$DM_ID = '2a534311-d6e6-4ec5-9e8d-ac531595013a'

function Send-Cmd($name, $json) {
    $r = & "C:\Project\HUB-IT-main\ui-review\stand\stand_cmd.ps1" -Name $name -Json $json
    Write-Host "$(Get-Date -Format HH:mm:ss.fff) [$name] $r"
}

function Snap($name) {
    Send-Cmd "measure" (@{ op = "measure"; name = "$name.json" } | ConvertTo-Json -Compress)
    Send-Cmd "shot" (@{ op = "shot"; name = "$name.png" } | ConvertTo-Json -Compress)
}

Send-Cmd "select" (@{ op="select"; id=$DM_ID } | ConvertTo-Json -Compress)

foreach ($scheme in @('dark', 'light')) {
    foreach ($size in @(@(1280,720), @(1024,600))) {
        $w = $size[0]; $h = $size[1]
        Send-Cmd "resize" (@{ op="resize"; w=$w; h=$h } | ConvertTo-Json -Compress)
        Send-Cmd "theme" (@{ op="theme"; value=$scheme } | ConvertTo-Json -Compress)
        Send-Cmd "wait" '{"op":"wait","ms":400}'
        Snap "wpf-$scheme-${w}x${h}-panel-closed"
        Send-Cmd "invoke" '{"op":"invoke","path":"Chat.TogglePeerCardCommand"}'
        Send-Cmd "wait" '{"op":"wait","ms":400}'
        Snap "wpf-$scheme-${w}x${h}-panel-open"
        Send-Cmd "invoke" '{"op":"invoke","path":"Chat.TogglePeerCardCommand"}'
    }
}

# Extra: portal-nav collapsed (shell width recovery) — documentation frame.
Send-Cmd "resize" '{"op":"resize","w":1280,"h":720}'
Send-Cmd "theme" '{"op":"theme","value":"dark"}'
Send-Cmd "nav" '{"op":"nav","collapsed":true}'
Send-Cmd "wait" '{"op":"wait","ms":400}'
Snap "wpf-dark-1280x720-nav-collapsed"
Send-Cmd "nav" '{"op":"nav","collapsed":false}'
Send-Cmd "theme" '{"op":"theme","value":"dark"}'
Write-Host "done"
