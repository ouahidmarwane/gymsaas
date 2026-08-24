[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TaskDirectory,

    [Parameter(Mandatory = $true)]
    [string]$Status,

    [ValidateSet('none', 'review', 'test', 'security')]
    [string]$Increment = 'none',

    [string]$FallbackRole,

    [string]$ArchitectModel,

    [ValidateSet('true', 'false', '')]
    [string]$ArchitectFallback = '',

    [string]$FinalizerModel,

    [string]$NotificationStatus,

    [string]$ProviderEventRole,

    [string]$ProviderErrorReason,

    [string]$FallbackModel
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

function Set-StateProperty {
    param([string]$Name, $Value)
    if ($state.PSObject.Properties.Name -contains $Name) {
        $state.$Name = $Value
    } else {
        $state | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

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

if (-not [string]::IsNullOrWhiteSpace($ArchitectModel)) { Set-StateProperty -Name 'architect_model' -Value $ArchitectModel }
if (-not [string]::IsNullOrWhiteSpace($ArchitectFallback)) { Set-StateProperty -Name 'architect_fallback' -Value ([bool]::Parse($ArchitectFallback)) }
if (-not [string]::IsNullOrWhiteSpace($FinalizerModel)) { Set-StateProperty -Name 'finalizer_model' -Value $FinalizerModel }
if (-not [string]::IsNullOrWhiteSpace($NotificationStatus)) { Set-StateProperty -Name 'notification_status' -Value $NotificationStatus }
if (-not [string]::IsNullOrWhiteSpace($ProviderEventRole)) {
    if ($state.PSObject.Properties.Name -contains 'provider_events') { $events = @($state.provider_events) } else { $events = @() }
    Set-StateProperty -Name 'provider_events' -Value @($events + [ordered]@{
        role = $ProviderEventRole
        reason = $ProviderErrorReason
        fallback_model = $FallbackModel
        recorded_at = (Get-Date).ToUniversalTime().ToString('o')
    })
}

$state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
Write-Output ($state | ConvertTo-Json -Depth 4)
