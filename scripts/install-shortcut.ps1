$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'Contract Intake.lnk'
$launcherPath = Join-Path $projectRoot 'start-contract-intake.cmd'
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $shortcutPath) {
    $existing = $shell.CreateShortcut($shortcutPath)
    if ($existing.TargetPath -ne $launcherPath) {
        throw 'A Contract Intake shortcut already points somewhere else. Rename that shortcut before installing this copy.'
    }
}
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcherPath
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Start Contract Intake locally and open it in your browser'
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,1"
$shortcut.WindowStyle = 1
$shortcut.Save()
Write-Host "Created: $shortcutPath"
