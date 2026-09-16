[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$TargetRoot,
  [string]$FixtureJson
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-DetectedCommand([string[]]$Names) {
  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) { return $command.Source }
  }
  return $null
}

function Get-FixtureValue($Fixture, [string]$Name, $Fallback) {
  if ($null -ne $Fixture -and $Fixture.PSObject.Properties.Name -contains $Name) {
    return [bool]$Fixture.$Name
  }
  return $Fallback
}

$target = [IO.Path]::GetFullPath($TargetRoot)
$packageRoot = $PSScriptRoot
$manifestPath = Join-Path $packageRoot 'P11_PORTABLE_PACKAGE_MANIFEST.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'FAIL_CLOSED: package manifest missing' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$receiptPath = Join-Path $target '.forge-portable-install.json'
$checks = [System.Collections.Generic.List[object]]::new()
function Add-Check([string]$Name, [bool]$Pass, $Detail) {
  $checks.Add([ordered]@{ name=$Name; pass=$Pass; detail=$Detail })
}

Add-Check 'target exists' (Test-Path -LiteralPath $target -PathType Container) $target
Add-Check 'install receipt exists' (Test-Path -LiteralPath $receiptPath -PathType Leaf) $receiptPath
$receipt = $null
if (Test-Path -LiteralPath $receiptPath -PathType Leaf) {
  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  Add-Check 'package identity' ($receipt.package_id -eq $manifest.package_id) $receipt.package_id
}
foreach ($entry in $manifest.payload_files) {
  $file = Join-Path $target ($entry.path -replace '/', '\')
  $exists = Test-Path -LiteralPath $file -PathType Leaf
  $hash = if ($exists) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
  Add-Check ("payload " + $entry.path) ($exists -and $hash -eq $entry.sha256) $hash
}
$registryPath = Join-Path $target 'machine-inputs\Model_Intelligence\MODEL_REGISTRY.json'
Add-Check 'machine-local offline registry' (Test-Path -LiteralPath $registryPath -PathType Leaf) $registryPath

$fixture = $null
if ($FixtureJson) {
  $fixture = Get-Content -LiteralPath $FixtureJson -Raw | ConvertFrom-Json
}
$nodePath = Get-DetectedCommand @('node.exe','node')
$gitPath = Get-DetectedCommand @('git.exe','git')
$chromePath = Get-DetectedCommand @('chrome.exe','chrome','msedge.exe','msedge','chromium.exe','chromium')
$codexPath = Get-DetectedCommand @('codex.exe','codex.cmd','codex')
$openCodePath = Get-DetectedCommand @('opencode.exe','opencode.cmd','opencode')
$maxPlusPath = Get-DetectedCommand @('maxplus.exe','maxplus.cmd','maxplus')
$officialHome = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex'
$maxPlusHome = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex-maxplus'
$detected = [ordered]@{
  node = Get-FixtureValue $fixture 'node' ([bool]$nodePath)
  git = Get-FixtureValue $fixture 'git' ([bool]$gitPath)
  chrome = Get-FixtureValue $fixture 'chrome' ([bool]$chromePath)
  official_codex = Get-FixtureValue $fixture 'official_codex' ([bool]$codexPath -or (Test-Path -LiteralPath $officialHome -PathType Container))
  maxplus = Get-FixtureValue $fixture 'maxplus' ([bool]$maxPlusPath -or (Test-Path -LiteralPath $maxPlusHome -PathType Container))
  opencode = Get-FixtureValue $fixture 'opencode' ([bool]$openCodePath)
}
Add-Check 'Windows platform' ($env:OS -eq 'Windows_NT') $env:OS
Add-Check 'supported architecture' ([Environment]::Is64BitOperatingSystem) ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString())
Add-Check 'Node prerequisite' $detected.node $nodePath
Add-Check 'Git prerequisite' $detected.git $gitPath
Add-Check 'PLUR disabled' ($manifest.plur_enabled -eq $false) $manifest.plur_enabled
Add-Check 'no bundled credentials' ($manifest.credentials_included -eq $false) $manifest.credentials_included

$payloadPass = -not ($checks | Where-Object { $_.name -like 'payload *' -and -not $_.pass })
$corePass = $payloadPass -and (Test-Path -LiteralPath $registryPath -PathType Leaf) -and $detected.node -and $detected.git -and ($manifest.plur_enabled -eq $false) -and ($manifest.credentials_included -eq $false)
$providerCount = @($detected.official_codex, $detected.maxplus, $detected.opencode | Where-Object { $_ }).Count
$status = if (-not $corePass) { 'BLOCKED_WITH_ACTION' } elseif ($providerCount -eq 0) { 'READY_WITH_MISSING_OPTIONAL_PROVIDER' } else { 'READY' }
$actions = @()
if (-not $detected.node) { $actions += 'Install a supported Node.js locally using the OWNER-approved native installer; bootstrap will not install it globally.' }
if (-not $detected.git) { $actions += 'Install Git for Windows using the OWNER-approved native installer; bootstrap will not install it globally.' }
if ($providerCount -eq 0) { $actions += 'Optional: install/login to a provider with its native flow. No credential is bundled or copied.' }

[ordered]@{
  schema_version='1.0.0'
  checkpoint='P11_PORTABLE_DOCTOR'
  checked_at=(Get-Date).ToUniversalTime().ToString('o')
  status=$status
  target_root=$target
  package_id=$manifest.package_id
  checks=$checks
  detected=$detected
  provider_home_policy='DETECT_ROOT_ONLY_NEVER_READ_CREDENTIAL_CONTENTS'
  official_codex_home=$officialHome
  maxplus_home=$maxPlusHome
  provider_homes_merged=$false
  actions=$actions
  model_backed_calls=0
} | ConvertTo-Json -Depth 12

if ($status -eq 'BLOCKED_WITH_ACTION') { exit 2 }
