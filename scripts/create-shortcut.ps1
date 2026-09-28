$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $project 'dist\Laptop Assistant-win32-x64\Laptop Assistant.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Build the desktop app first with npm run build.' }
$desktop = [Environment]::GetFolderPath('Desktop')
if (-not (Test-Path -LiteralPath $desktop)) { throw 'Desktop folder not found.' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $desktop 'Laptop Assistant.lnk'))
$shortcut.TargetPath = $executable
$shortcut.WorkingDirectory = Split-Path -Parent $executable
$shortcut.Description = 'Your personal laptop assistant powered by GitHub Copilot'
$shortcut.IconLocation = "$executable,0"
$shortcut.Save()
"Desktop shortcut created: $(Join-Path $desktop 'Laptop Assistant.lnk')"
