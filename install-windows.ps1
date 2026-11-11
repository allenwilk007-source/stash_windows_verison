# Stash installer for Windows — installs Stash from this folder.
# Run from PowerShell inside the stash folder:
#   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
# Re-run it any time to update (your notes in %APPDATA%\Stash are never touched).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar on
$ElectronVersion = '45.2.3'
$Src  = $PSScriptRoot
$Dest = Join-Path $env:LOCALAPPDATA 'Programs\Stash'
function Say($m){ Write-Host "> $m" -ForegroundColor Cyan }

$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$Tmp = Join-Path $env:TEMP ("stash-install-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  Say "Installing Stash for Windows ($Arch)"
  Say "Downloading the app engine (~120 MB)..."
  $zip = Join-Path $Tmp 'electron.zip'
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/electron/electron/releases/download/v$ElectronVersion/electron-v$ElectronVersion-win32-$Arch.zip" -OutFile $zip
  Say "Unpacking..."
  $eng = Join-Path $Tmp 'e'
  Expand-Archive -Path $zip -DestinationPath $eng -Force
  Rename-Item (Join-Path $eng 'electron.exe') 'Stash.exe'
  Remove-Item (Join-Path $eng 'resources\default_app.asar') -Force -ErrorAction SilentlyContinue

  Say "Copying Stash..."
  $app = Join-Path $eng 'resources\app'
  New-Item -ItemType Directory -Path $app | Out-Null
  $files = 'boot.js','package.json','version.json','index.html','supabase.js','collab.js','notes.js','quick.html','island.html','ai.js','main.js','preload.js','trayTemplate.png','trayTemplate@2x.png','icon.png'
  foreach ($f in $files){ Copy-Item (Join-Path $Src $f) (Join-Path $app $f) }

  # icon: wrap a 256px PNG of icon.png in an .ico for the shortcuts
  Add-Type -AssemblyName System.Drawing
  $img = [System.Drawing.Image]::FromFile((Join-Path $Src 'icon.png'))
  $bmp = New-Object System.Drawing.Bitmap 256, 256
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, 256, 256); $g.Dispose(); $img.Dispose()
  $ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  $png = $ms.ToArray()
  $ico = New-Object System.IO.MemoryStream; $w = New-Object System.IO.BinaryWriter $ico
  $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)                     # header: icon, 1 image
  $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0)         # 256x256, no palette
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$png.Length); $w.Write([UInt32]22)
  $w.Write($png); $w.Flush()
  [System.IO.File]::WriteAllBytes((Join-Path $eng 'stash.ico'), $ico.ToArray())

  Say "Moving Stash to $Dest..."
  Get-Process -Name 'Stash' -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Dest*" } | Stop-Process -Force
  Start-Sleep -Milliseconds 800
  if (Test-Path $Dest){ Remove-Item $Dest -Recurse -Force }
  New-Item -ItemType Directory -Path (Split-Path $Dest) -Force | Out-Null
  Move-Item $eng $Dest

  Say "Adding shortcuts..."
  $sh = New-Object -ComObject WScript.Shell
  foreach ($lnk in @((Join-Path ([Environment]::GetFolderPath('Programs')) 'Stash.lnk'), (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Stash.lnk'))){
    $s = $sh.CreateShortcut($lnk)
    $s.TargetPath = Join-Path $Dest 'Stash.exe'; $s.WorkingDirectory = $Dest
    $s.IconLocation = (Join-Path $Dest 'stash.ico') + ',0'; $s.Description = 'Stash'
    $s.Save()
  }

  $ver = (Get-Content (Join-Path $Src 'version.json') -Raw | ConvertFrom-Json).version
  Say "Done! Stash $ver is installed. Look for its icon in the taskbar tray (bottom-right, maybe under ^)."
  Start-Process (Join-Path $Dest 'Stash.exe')
}
finally {
  Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
