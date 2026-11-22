$ErrorActionPreference = 'Continue'
$root = (Get-ChildItem -LiteralPath '\\10.103.0.170\Common\IT' -Directory -Force | Where-Object { $_.Name -match 'Абдулова' })[0].FullName
$files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue)

$sigs = @{
  '.xlsx'='zip'; '.docx'='zip'; '.pptx'='zip'; '.xlsm'='zip'; '.zip'='zip';
  '.xls'='ole'; '.doc'='ole'; '.ppt'='ole'; '.msg'='ole';
  '.pdf'='pdf'; '.rar'='rar'; '.7z'='7z';
  '.jpg'='jpg'; '.jpeg'='jpg'; '.jfif'='jpg'; '.png'='png'; '.tif'='tif';
  '.rtf'='rtf'; '.dwg'='dwg'; '.ods'='zip';
  '.xml'='text'; '.csv'='text'; '.txt'='text'; '.html'='text'; '.htm'='text'; '.ini'='text'; '.log'='text'; '.css'='text'
}

function Get-Head([string]$p, [int]$n=16) {
  try {
    $fs = [IO.File]::OpenRead($p)
    $b = New-Object byte[] $n
    $r = $fs.Read($b,0,$n); $fs.Close()
    if ($r -le 0) { return ,@() }
    return ,$b[0..($r-1)]
  } catch { return $null }
}
function Test-Sig($b, [string]$kind) {
  if ($null -eq $b) { return 'READFAIL' }
  if ($b.Count -lt 4) { return 'EMPTY/TINY' }
  switch ($kind) {
    'zip' { if ($b[0] -eq 0x50 -and $b[1] -eq 0x4B) { return 'OK' } else { return 'BAD' } }
    'ole' { if ($b[0] -eq 0xD0 -and $b[1] -eq 0xCF -and $b[2] -eq 0x11 -and $b[3] -eq 0xE0) { return 'OK' } else { return 'BAD' } }
    'pdf' { if ($b[0] -eq 0x25 -and $b[1] -eq 0x50 -and $b[2] -eq 0x44 -and $b[3] -eq 0x46) { return 'OK' } else { return 'BAD' } }
    'rar' { if ($b[0] -eq 0x52 -and $b[1] -eq 0x61 -and $b[2] -eq 0x72 -and $b[3] -eq 0x21) { return 'OK' } else { return 'BAD' } }
    '7z'  { if ($b[0] -eq 0x37 -and $b[1] -eq 0x7A -and $b[2] -eq 0xBC -and $b[3] -eq 0xAF) { return 'OK' } else { return 'BAD' } }
    'jpg' { if ($b[0] -eq 0xFF -and $b[1] -eq 0xD8 -and $b[2] -eq 0xFF) { return 'OK' } else { return 'BAD' } }
    'png' { if ($b[0] -eq 0x89 -and $b[1] -eq 0x50 -and $b[2] -eq 0x4E -and $b[3] -eq 0x47) { return 'OK' } else { return 'BAD' } }
    'tif' { if (($b[0] -eq 0x49 -and $b[1] -eq 0x49) -or ($b[0] -eq 0x4D -and $b[1] -eq 0x4D)) { return 'OK' } else { return 'BAD' } }
    'rtf' { if ($b[0] -eq 0x7B -and $b[1] -eq 0x5C) { return 'OK' } else { return 'BAD' } }
    'dwg' { if ($b[0] -eq 0x41 -and $b[1] -eq 0x43) { return 'OK' } else { return 'BAD' } }
    'text'{ return 'TEXT' }
    default { return 'UNK' }
  }
}

$sample = $files | Group-Object { $_.Extension.ToLower() } | ForEach-Object { $_.Group | Select-Object -First 40 }
$out = foreach ($f in $sample) {
  $ext = $f.Extension.ToLower()
  $kind = if ($sigs.ContainsKey($ext)) { $sigs[$ext] } else { 'UNK' }
  $h = Get-Head $f.FullName 16
  $hex = if ($h) { ($h | ForEach-Object { $_.ToString('X2') }) -join ' ' } else { 'READ-ERROR' }
  [pscustomobject]@{ Ext=$ext; Size=$f.Length; Head=$hex; Sig=(Test-Sig $h $kind); Name=$f.Name }
}
$out | Group-Object Ext, Sig | Sort-Object Count -Descending | Select-Object Count, Name | Format-Table -AutoSize | Out-String -Width 140
'=== BAD/READFAIL/EMPTY samples ==='
$out | Where-Object { $_.Sig -in 'BAD','READFAIL','EMPTY/TINY' } | Select-Object -First 40 | Format-Table Ext, Size, Head, Name -AutoSize | Out-String -Width 260
'=== UNK/TEXT headers ==='
$out | Where-Object { $_.Sig -in 'UNK','TEXT' } | Select-Object -First 50 | Format-Table Ext, Size, Head, Name -AutoSize | Out-String -Width 260
