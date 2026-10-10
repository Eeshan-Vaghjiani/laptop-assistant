# Compatible with Windows PowerShell 5.1. Installs for the current user only.
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'LaptopAssistant'),
    [switch]$SkipLaunch,
    [switch]$SkipShortcuts,
    [switch]$SkipPreferences
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$source = Split-Path -Parent $PSScriptRoot
$build = $null
try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw '64-bit Windows is required.' }
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'This setup supports Intel/AMD x64 Windows. ARM64 needs a separate build.' }
    foreach ($file in @('package.json', 'package-lock.json', 'server.mjs', 'desktop\main.mjs')) {
        if (-not (Test-Path -LiteralPath (Join-Path $source $file))) { throw 'Extract the entire setup ZIP first, then run setup.bat from the extracted folder.' }
    }
    if (-not (Test-Path -LiteralPath $InstallRoot)) { New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null }
    $InstallRoot = (Resolve-Path -LiteralPath $InstallRoot).Path
    $runtime = Join-Path $InstallRoot 'runtime'
    $node = Join-Path $runtime 'node.exe'
    if (-not (Test-Path -LiteralPath $node)) {
        Write-Host '[1/5] Downloading a private Node.js 24 runtime (no administrator access needed)...'
        $versions = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
        $version = ($versions | Where-Object { $_.version -match '^v24\.' -and $_.lts -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1).version
        if (-not $version) { throw 'Could not find a Node.js 24 LTS Windows runtime.' }
        $name = "node-$version-win-x64.zip"
        $archive = Join-Path $InstallRoot $name
        Invoke-WebRequest "https://nodejs.org/dist/$version/$name" -OutFile $archive -UseBasicParsing
        $checksums = (Invoke-WebRequest "https://nodejs.org/dist/$version/SHASUMS256.txt" -UseBasicParsing).Content
        $line = ($checksums -split "`n" | Where-Object { $_.Trim().EndsWith("  $name") })
        if (-not $line -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne (($line.Trim() -split '\s+')[0])) { throw 'Node.js checksum verification failed.' }
        $extract = Join-Path $InstallRoot ('runtime-download-' + [Guid]::NewGuid().ToString('N'))
        Expand-Archive -LiteralPath $archive -DestinationPath $extract
        Move-Item -LiteralPath (Join-Path $extract "node-$version-win-x64") -Destination $runtime
        Remove-Item -LiteralPath $extract -Recurse -Force
        Remove-Item -LiteralPath $archive -Force
    }
    & $node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'The private runtime is outdated. Remove only the runtime folder in the installation directory and run setup again.' }
    $env:PATH = "$runtime;$env:PATH"
    $env:ELECTRON_RUN_AS_NODE = $null
    $env:ASSISTANT_TEST_PROFILE = $null
    $npm = Join-Path $runtime 'npm.cmd'
    $build = Join-Path $InstallRoot ('build-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $build | Out-Null
    Write-Host '[2/5] Preparing clean application source...'
    foreach ($file in @('package.json', 'package-lock.json', 'server.mjs', 'attachments.mjs', 'runtime-env.mjs', 'preferences.mjs', 'access-policy.mjs', 'file-library.mjs')) {
        Copy-Item -LiteralPath (Join-Path $source $file) -Destination $build
    }
    foreach ($folder in @('desktop', 'public')) { Copy-Item -LiteralPath (Join-Path $source $folder) -Destination $build -Recurse }
    New-Item -ItemType Directory -Path (Join-Path $build 'scripts') | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'build.mjs') -Destination (Join-Path $build 'scripts')
    # Prevent legacy chat import on the recipient's machine.
    '{"distributable":true}' | Set-Content -LiteralPath (Join-Path $build 'release.json') -Encoding UTF8
    Push-Location -LiteralPath $build
    try {
        Write-Host '[3/5] Installing app dependencies and bundled GitHub sign-in...'
        & $npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check Internet access and rerun setup.' }
        & $npm install --save-exact '@github/copilot@1.0.85' --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Copilot sign-in helper installation failed.' }
        & $npm run check
        if ($LASTEXITCODE -ne 0) { throw 'Application syntax checks failed.' }
        Write-Host '[4/5] Building your desktop app...'
        & $npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
    } finally { Pop-Location }
    $built = Join-Path $build 'dist\Laptop Assistant-win32-x64'
    $install = Join-Path $InstallRoot ('app-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6))
    Move-Item -LiteralPath $built -Destination $install
    $exe = Join-Path $install 'Laptop Assistant.exe'
    if (-not (Test-Path -LiteralPath $exe)) { throw 'The built application executable is missing.' }
    $cli = Join-Path $install 'resources\app\node_modules\@github\copilot-win32-x64\copilot.exe'
    if (-not (Test-Path -LiteralPath $cli)) { throw 'The bundled login helper is missing.' }
    & $cli login --help | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The bundled login helper could not start.' }
    Write-Host '[5/5] Setting up preferences and shortcuts...'
    if (-not $SkipPreferences) {
        $data = Join-Path $env:APPDATA 'Laptop Assistant\chats'
        if (-not (Test-Path -LiteralPath $data)) { New-Item -ItemType Directory -Path $data -Force | Out-Null }
        $preferences = Join-Path $data 'preferences.json'
        if (-not (Test-Path -LiteralPath $preferences)) {
            '{"model":"gpt-6-astra","effort":"max","access":"full","lastChat":null}' | Set-Content -LiteralPath $preferences -Encoding ASCII
        }
    }
    if (-not $SkipShortcuts) {
        $shell = New-Object -ComObject WScript.Shell
        foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
            if (-not (Test-Path -LiteralPath $folder)) { throw "Shortcut directory missing: $folder" }
            $shortcut = $shell.CreateShortcut((Join-Path $folder 'Laptop Assistant.lnk'))
            $shortcut.TargetPath = $exe
            $shortcut.WorkingDirectory = $install
            $shortcut.Description = 'Laptop Assistant powered by your GitHub Copilot account'
            $shortcut.IconLocation = "$exe,0"
            $shortcut.Save()
        }
    }
    $exe | Set-Content -LiteralPath (Join-Path $InstallRoot 'current-app.txt') -Encoding UTF8
    Remove-Item -LiteralPath $build -Recurse -Force
    Write-Host "Installed: $exe"
    Write-Host 'Default: GPT-6 Astra / Max, with full control for routine actions. Existing preferences are preserved.'
    Write-Host 'Use your own Copilot account. If requested, click Sign in to GitHub and authorize the displayed code.'
    if (-not $SkipLaunch) {
        # Ask an old assistant window to close normally so the new process does not
        # merely focus the old single-instance application. Never force-kill it.
        $old = @(Get-Process -Name 'Laptop Assistant' -ErrorAction SilentlyContinue)
        foreach ($process in $old) { if ($process.MainWindowHandle -ne 0) { $null = $process.CloseMainWindow() } }
        if ($old.Count) { Start-Sleep -Seconds 12 }
        if (Get-Process -Name 'Laptop Assistant' -ErrorAction SilentlyContinue) {
            Write-Host 'Close your existing assistant, then open Laptop Assistant from Start to use this update.'
        } else { Start-Process -FilePath $exe -WorkingDirectory $install }
    }
    exit 0
} catch {
    Write-Host "SETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
    if ($build) { Write-Host "Build folder retained for troubleshooting: $build" }
    exit 1
}
