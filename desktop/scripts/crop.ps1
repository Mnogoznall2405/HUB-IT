param([string]$Src, [int]$X, [int]$Y, [int]$W, [int]$H, [string]$Dst)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile($Src)
$crop = $img.Clone((New-Object System.Drawing.Rectangle $X, $Y, $W, $H), $img.PixelFormat)
$crop.Save($Dst)
$img.Dispose(); $crop.Dispose()
Write-Output "crop -> $Dst"
