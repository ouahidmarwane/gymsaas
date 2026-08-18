[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TaskDirectory,

    [Parameter(Mandatory = $true)]
    [string]$Status,

    [ValidateSet('none', 'review', 'test', 'security')]
    [string]$Increment = 'none',

    [string]$FallbackRole
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tasksRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '.ai\tasks'))
$resolvedTask = (Resolve-Path -LiteralPath $TaskDirectory).Path
if (-not $resolvedTask.StartsWith($tasksRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Task directory must be under .ai/tasks.'
}

$statePath = Join-Path $resolvedTask 'state.json'
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
$state.status = $Status

if ($Increment -ne 'none') {
    $property = $Increment + '_cycles'
    $next = [int]$state.$property + 1
    if ($next -gt 3) {
        throw "Maximum $Increment correction cycles exceeded."
    }
    $state.$property = $next
}

if (-not [string]::IsNullOrWhiteSpace($FallbackRole)) {
    $roles = @($state.fallback_roles)
    if ($roles -notcontains $FallbackRole) {
        $state.fallback_roles = @($roles + $FallbackRole)
    }
}

$state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
Write-Output ($state | ConvertTo-Json -Depth 4)
