$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $project 'dist\Laptop Assistant-win32-x64\Laptop Assistant.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Build the desktop app first with npm run build.' }
$desktop = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @($desktop, $programs)) {
    if (-not (Test-Path -LiteralPath $folder)) { throw "Shortcut folder not found: $folder" }
    $shortcutPath = Join-Path $folder 'Laptop Assistant.lnk'
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $executable
    $shortcut.WorkingDirectory = Split-Path -Parent $executable
    $shortcut.Description = 'Your personal laptop assistant powered by GitHub Copilot'
    $shortcut.IconLocation = "$executable,0"
    $shortcut.Save()
    "Shortcut updated: $shortcutPath"
}
