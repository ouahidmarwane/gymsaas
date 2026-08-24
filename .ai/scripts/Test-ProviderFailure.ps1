[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InputFile
)

$ErrorActionPreference = 'Stop'
$text = Get-Content -Raw -LiteralPath $InputFile
$runtimeFailurePatterns = @(
    'Start-Process',
    'System\.Diagnostics\.Process',
    'orchestration/runtime',
    'did not launch',
    'command not found',
    'is not recognized as (?:an internal|the name of)',
    'Cl[ée] du dictionnaire',
    'dictionary key',
    'Path.*PATH'
)
$patterns = @(
    '(?m)^\s*PROVIDER_TIMEOUT\s*$',
    '\b429\b',
    '\b502\b',
    '\b503\b',
    '\b504\b',
    'upstream\s+(idle\s+)?timeout',
    'gateway\s+timeout',
    'quota\s+(exceeded|exhausted)',
    'token\s+quota',
    'rate[ -]?limit(ed| exceeded)?',
    'model\s+(is\s+)?unavailable',
    'provider\s+(is\s+)?unavailable',
    'insufficient\s+(credits|token quota)',
    'service\s+temporarily\s+unavailable',
    'temporar(?:y|ily)\s+unavailable'
)

$isProviderFailure = $false
foreach ($runtimePattern in $runtimeFailurePatterns) {
    if ($text -match $runtimePattern) {
        Write-Output 'false'
        exit 0
    }
}

foreach ($providerPattern in $patterns) {
    if ($text -match $providerPattern) {
        $isProviderFailure = $true
        break
    }
}

Write-Output ($isProviderFailure.ToString().ToLowerInvariant())
