[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InputFile
)

$ErrorActionPreference = 'Stop'
$text = Get-Content -Raw -LiteralPath $InputFile
$patterns = @(
    '\b429\b',
    'quota\s+(exceeded|exhausted)',
    'rate[ -]?limit(ed| exceeded)?',
    'model\s+(is\s+)?unavailable',
    'provider\s+(is\s+)?unavailable',
    'insufficient\s+(credits|token quota)',
    'service\s+temporarily\s+unavailable',
    'temporar(?:y|ily)\s+unavailable'
)

$isProviderFailure = $false
foreach ($pattern in $patterns) {
    if ($text -match $pattern) {
        $isProviderFailure = $true
        break
    }
}

Write-Output ($isProviderFailure.ToString().ToLowerInvariant())
