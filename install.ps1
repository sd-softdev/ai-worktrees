<#
.SYNOPSIS
Installs Agent Workspace on Windows from a verified GitHub release.
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
    throw 'The Windows installer currently supports x64 systems only.'
}
if (-not [IO.Path]::IsPathRooted($InstallDirectory) -or $InstallDirectory -match '["\r\n]') {
    throw 'Invalid installation directory.'
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($Version -eq 'latest' -and -not $DryRun) {
    $Version = (Invoke-RestMethod -Uri 'https://api.github.com/repos/sd-softdev/ai-worktrees/releases/latest' -Headers @{ 'User-Agent' = 'Agent-Workspace-Installer' }).tag_name
}
if ($Version -ne 'latest' -and $Version -notmatch '^v\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$') {
    throw 'Invalid release version.'
}
$Name = "agent-workspace-$($Version -replace '^v', '')-win-x64.exe"
if ($DryRun) {
    Write-Output "Platform: Windows x64`nRelease: $Version`nPackage: $Name`nDestination: $InstallDirectory"
    return
}
if (Get-Process -Name 'Agent Workspace' -ErrorAction SilentlyContinue) {
    throw 'Please close Agent Workspace before updating.'
}
$Temporary = Join-Path ([IO.Path]::GetTempPath()) ("agent-workspace-install-" + [Guid]::NewGuid())
[void](New-Item -ItemType Directory -Path $Temporary)
try {
    if ($InstallerPath) {
        if (-not $ChecksumPath -or -not (Test-Path -LiteralPath $InstallerPath -PathType Leaf) -or -not (Test-Path -LiteralPath $ChecksumPath -PathType Leaf)) {
            throw 'InstallerPath and ChecksumPath must point to existing files.'
        }
        if ((Split-Path -Leaf $InstallerPath) -ne $Name) { throw "Expected package: $Name" }
        $InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
    }
    else {
        $Base = "https://github.com/sd-softdev/ai-worktrees/releases/download/$Version"
        $InstallerPath = Join-Path $Temporary $Name
        $ChecksumPath = Join-Path $Temporary 'SHA256SUMS'
        Write-Output "Downloading $Name ..."
        Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Name" -OutFile $InstallerPath
        Invoke-WebRequest -UseBasicParsing -Uri "$Base/SHA256SUMS" -OutFile $ChecksumPath
    }
    $Pattern = '^([a-fA-F0-9]{64})\s+\*?' + [Regex]::Escape($Name) + '$'
    $Hashes = @(Get-Content -LiteralPath $ChecksumPath | ForEach-Object { if ($_ -match $Pattern) { $Matches[1] } })
    if ($Hashes.Count -ne 1) { throw 'Could not find a unique SHA-256 entry for the package.' }
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
    if ($Actual -ne $Hashes[0]) { throw 'SHA-256 verification failed. The package will not be installed.' }

    # NSIS requires /D to be the last argument and does not accept quotes around its value.
    $Process = Start-Process -FilePath $InstallerPath -ArgumentList "/S /D=$InstallDirectory" -Wait -PassThru
    if ($Process.ExitCode -ne 0) { throw "Installation failed (exit code $($Process.ExitCode))." }
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDirectory 'Agent Workspace.exe'))) {
        throw 'The installer did not create an application executable at the expected location.'
    }
    Write-Output "Installed: $InstallDirectory\Agent Workspace.exe"
}
finally {
    Remove-Item -LiteralPath $Temporary -Recurse -Force -ErrorAction SilentlyContinue
}
