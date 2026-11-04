<#
.SYNOPSIS
Installiert Agent Workspace unter Windows aus einem geprüften GitHub-Release.
#>
[CmdletBinding()]
param(
    [string]$Version = 'latest',
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\Agent Workspace'),
    [string]$InstallerPath,
    [string]$ChecksumPath,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    throw 'Der Windows-Installer unterstützt derzeit x64-Systeme.'
}
if (-not [IO.Path]::IsPathRooted($InstallDirectory) -or $InstallDirectory -match '["\r\n]') {
    throw 'Ungültiges Installationsverzeichnis.'
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($Version -eq 'latest' -and -not $DryRun) {
    $Version = (Invoke-RestMethod -Uri 'https://api.github.com/repos/sd-softdev/ai-worktrees/releases/latest' -Headers @{ 'User-Agent' = 'Agent-Workspace-Installer' }).tag_name
}
if ($Version -ne 'latest' -and $Version -notmatch '^v\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$') {
    throw 'Ungültige Release-Version.'
}
$Name = "agent-workspace-$($Version -replace '^v', '')-win-x64.exe"
if ($DryRun) {
    Write-Output "Plattform: Windows x64`nRelease: $Version`nPaket: $Name`nZiel: $InstallDirectory"
    return
}
if (Get-Process -Name 'Agent Workspace' -ErrorAction SilentlyContinue) {
    throw 'Bitte Agent Workspace vor dem Update schließen.'
}
$Temporary = Join-Path ([IO.Path]::GetTempPath()) ("agent-workspace-install-" + [Guid]::NewGuid())
[void](New-Item -ItemType Directory -Path $Temporary)
try {
    if ($InstallerPath) {
        if (-not $ChecksumPath -or -not (Test-Path -LiteralPath $InstallerPath -PathType Leaf) -or -not (Test-Path -LiteralPath $ChecksumPath -PathType Leaf)) {
            throw 'InstallerPath und ChecksumPath müssen auf vorhandene Dateien zeigen.'
        }
        if ((Split-Path -Leaf $InstallerPath) -ne $Name) { throw "Erwartetes Paket: $Name" }
        $InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
    }
    else {
        $Base = "https://github.com/sd-softdev/ai-worktrees/releases/download/$Version"
        $InstallerPath = Join-Path $Temporary $Name
        $ChecksumPath = Join-Path $Temporary 'SHA256SUMS'
        Write-Output "Lade $Name ..."
        Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Name" -OutFile $InstallerPath
        Invoke-WebRequest -UseBasicParsing -Uri "$Base/SHA256SUMS" -OutFile $ChecksumPath
    }
    $Pattern = '^([a-fA-F0-9]{64})\s+\*?' + [Regex]::Escape($Name) + '$'
    $Hashes = @(Get-Content -LiteralPath $ChecksumPath | ForEach-Object { if ($_ -match $Pattern) { $Matches[1] } })
    if ($Hashes.Count -ne 1) { throw 'Kein eindeutiger SHA-256-Eintrag für das Paket gefunden.' }
    # Use .NET directly so hashing also works when a PowerShell 7 parent passes
    # its module search path to Windows PowerShell 5.1.
    $Algorithm = [Security.Cryptography.SHA256]::Create()
    $Stream = [IO.File]::OpenRead($InstallerPath)
    try {
        $Actual = [BitConverter]::ToString($Algorithm.ComputeHash($Stream)).Replace('-', '')
    }
    finally {
        $Stream.Dispose()
        $Algorithm.Dispose()
    }
    if ($Actual -ne $Hashes[0]) { throw 'SHA-256-Prüfung fehlgeschlagen. Das Paket wird nicht installiert.' }

    # NSIS requires /D to be the last argument and does not accept quotes around its value.
    $Process = Start-Process -FilePath $InstallerPath -ArgumentList "/S /D=$InstallDirectory" -Wait -PassThru
    if ($Process.ExitCode -ne 0) { throw "Installation fehlgeschlagen (Exit $($Process.ExitCode))." }
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDirectory 'Agent Workspace.exe'))) {
        throw 'Der Installer hat keine ausführbare Anwendung am erwarteten Ort hinterlegt.'
    }
    Write-Output "Installiert: $InstallDirectory\Agent Workspace.exe"
}
finally {
    Remove-Item -LiteralPath $Temporary -Recurse -Force -ErrorAction SilentlyContinue
}
