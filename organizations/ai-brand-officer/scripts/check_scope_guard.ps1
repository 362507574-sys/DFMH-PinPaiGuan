[CmdletBinding()]
param(
    [string]$ControlCenterRoot = '',
    [string]$OrganizationRoot = ''
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

if ([string]::IsNullOrWhiteSpace($OrganizationRoot)) {
    $OrganizationRoot = Split-Path -Parent $PSScriptRoot
}
if ([string]::IsNullOrWhiteSpace($ControlCenterRoot)) {
    $ControlCenterRoot = Split-Path -Parent (Split-Path -Parent $OrganizationRoot)
}

$nodeScript = Join-Path $PSScriptRoot 'rebaseline_protected_root.mjs'
$nodeArguments = @(
    $nodeScript,
    '--check',
    '--control-center-root',
    $ControlCenterRoot,
    '--organization-root',
    $OrganizationRoot
)
& node @nodeArguments
$nodeExitCode = $LASTEXITCODE
exit $nodeExitCode
