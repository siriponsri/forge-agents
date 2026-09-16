[CmdletBinding()]
param(
  [string]$TargetRoot = (Join-Path $env:LOCALAPPDATA 'FORGE\forge-v1-portable'),
  [int]$Port = 3935,
  [int]$SmokeSeconds = 0,
  [string]$FixtureJson
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$target = [IO.Path]::GetFullPath($TargetRoot)
$doctorArgs = @{ TargetRoot=$target }
if ($FixtureJson) { $doctorArgs.FixtureJson = $FixtureJson }
$doctorText = & (Join-Path $PSScriptRoot 'doctor.ps1') @doctorArgs
$doctor = $doctorText | ConvertFrom-Json
if ($doctor.status -eq 'BLOCKED_WITH_ACTION') {
  $doctorText
  exit 2
}
$node = Get-Command node.exe,node -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $node) { throw 'BLOCKED_WITH_ACTION: Node.js not detected.' }
$launcher = Join-Path $PSScriptRoot 'launch-runtime.mjs'
$args = @($launcher, '--target-root', $target, '--port', [string]$Port)
if ($SmokeSeconds -gt 0) { $args += @('--smoke-ms', [string]($SmokeSeconds * 1000)) }
& $node.Source @args
exit $LASTEXITCODE
