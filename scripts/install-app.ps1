param([Parameter(Mandatory = $true)][string]$SourceRoot)

$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $SourceRoot).Path.TrimEnd('\')
$installRoot = if ($env:CONTRACT_INTAKE_INSTALL_ROOT) {
    [IO.Path]::GetFullPath($env:CONTRACT_INTAKE_INSTALL_ROOT).TrimEnd('\')
} else {
    (Join-Path $env:LOCALAPPDATA 'Contract Intake').TrimEnd('\')
}

if ($sourcePath -ne $installRoot) {
    Write-Host "Installing Contract Intake to $installRoot"
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    $excluded = @('.git', 'node_modules', '.runtime', 'dist')
    Get-ChildItem -LiteralPath $sourcePath -Force |
        Where-Object { $excluded -notcontains $_.Name } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $installRoot -Recurse -Force }
}

$shortcutScript = Join-Path $installRoot 'scripts\install-shortcut.ps1'
$startScript = Join-Path $installRoot 'scripts\start.ps1'
if (-not (Test-Path -LiteralPath $shortcutScript) -or -not (Test-Path -LiteralPath $startScript)) {
    throw 'The complete application package was not available. Run the installer again while connected to the internet.'
}

if ($env:CONTRACT_INTAKE_SKIP_SHORTCUT -ne '1') {
    & $shortcutScript
}

$port = if ($env:CONTRACT_INTAKE_INSTALL_PORT) { [int]$env:CONTRACT_INTAKE_INSTALL_PORT } else { 4317 }
if ($env:CONTRACT_INTAKE_NO_BROWSER -eq '1') {
    & $startScript -NoBrowser -Port $port
} else {
    & $startScript -Port $port
}
