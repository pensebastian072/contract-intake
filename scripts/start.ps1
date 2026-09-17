param([switch]$NoBrowser, [ValidateRange(1024,65535)][int]$Port = 4317)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$appUrl = "http://127.0.0.1:$Port"
$healthUrl = "$appUrl/api/health"
$runtimeDir = Join-Path $projectRoot '.runtime'

function Test-ContractIntakeServer {
    try {
        $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
        return $response.ok -eq $true -and $response.localOnly -eq $true -and $response.app -eq 'contract-intake'
    }
    catch {
        return $false
    }
}

if (Test-ContractIntakeServer) {
    if (-not $NoBrowser) { Start-Process $appUrl }
    Write-Host "Contract Intake is ready at $appUrl"
    exit 0
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw 'Install Node.js 24 LTS from https://nodejs.org, then open this shortcut again.'
}
$nodePath = $nodeCommand.Source
& $nodePath -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if ($LASTEXITCODE -ne 0) { throw 'Node.js is too old. Install Node.js 24 LTS from https://nodejs.org.' }
$lockPath = Join-Path $projectRoot 'package-lock.json'
$lockHash = (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash
$installStamp = Join-Path $runtimeDir 'installed-lock.txt'
$installedHash = if (Test-Path -LiteralPath $installStamp) { (Get-Content -LiteralPath $installStamp -Raw).Trim() } else { '' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules')) -or $installedHash -ne $lockHash) {
    Write-Host 'Installing local application components...'
    Push-Location $projectRoot
    try {
        & (Join-Path (Split-Path -Parent $nodePath) 'npm.cmd') ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Component installation failed. Check your internet connection, then try again.' }
        New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
        Set-Content -LiteralPath $installStamp -Value $lockHash -Encoding ascii
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-ContractIntakeServer)) {
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    $stdoutPath = Join-Path $runtimeDir 'server.out.log'
    $stderrPath = Join-Path $runtimeDir 'server.err.log'
    $previousPort = $env:CONTRACT_INTAKE_PORT
    $env:CONTRACT_INTAKE_PORT = [string]$Port
    try {
    $process = Start-Process -FilePath $nodePath `
        -ArgumentList 'src/server.js' `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru
    } finally { $env:CONTRACT_INTAKE_PORT = $previousPort }
    Set-Content -LiteralPath (Join-Path $runtimeDir 'server.pid') -Value $process.Id -Encoding ascii

    $ready = $false
    foreach ($attempt in 1..40) {
        Start-Sleep -Milliseconds 250
        if (Test-ContractIntakeServer) {
            $ready = $true
            break
        }
        if ($process.HasExited) { break }
    }
    if (-not $ready) {
        $details = if (Test-Path -LiteralPath $stderrPath) { (Get-Content -LiteralPath $stderrPath -Raw).Trim() } else { '' }
        if ($details) { throw "Contract Intake failed to start: $details" }
        throw "Contract Intake did not become ready at $appUrl. Another application may be using that port."
    }
}

if (-not $NoBrowser) {
    Start-Process $appUrl
}
Write-Host "Contract Intake is ready at $appUrl"
