[CmdletBinding(DefaultParameterSetName = 'Task')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Task')]
    [ValidateNotNullOrEmpty()]
    [string]$Task,
    [Parameter(Mandatory = $true, ParameterSetName = 'TaskFile')]
    [ValidateNotNullOrEmpty()]
    [string]$TaskFile,
    [ValidateSet('Full', 'Fast')]
    [string]$Mode = 'Full'
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location -LiteralPath $projectRoot

if ($PSCmdlet.ParameterSetName -eq 'TaskFile') {
    $resolvedRequest = (Resolve-Path -LiteralPath $TaskFile).Path
    if (-not $resolvedRequest.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'TaskFile must be inside the GymFlow repository.'
    }
    if ([string]::IsNullOrWhiteSpace((Get-Content -Raw -LiteralPath $resolvedRequest))) { throw 'The feature task is empty.' }
    $newTaskArguments = @('-TaskFile', $resolvedRequest)
} else {
    $newTaskArguments = @('-Task', $Task)
}

$taskDirectory = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'New-AiTask.ps1') @newTaskArguments -Mode $Mode
if ($LASTEXITCODE -ne 0) { throw 'Could not create the task workspace.' }
$taskDirectory = $taskDirectory | Select-Object -Last 1
$resolvedTask = (Resolve-Path -LiteralPath $taskDirectory).Path

$workflowFailed = $false
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'invoke-codex.ps1') -Role 'orchestrator' -TaskDirectory $resolvedTask -Mode $Mode
    if ($LASTEXITCODE -ne 0) { throw "Codex Orchestrator exited with code $LASTEXITCODE." }
} catch {
    $workflowFailed = $true
    Set-Content -LiteralPath (Join-Path $resolvedTask 'orchestration-error.txt') -Encoding UTF8 -Value 'The Codex orchestration process failed unexpectedly. Inspect local process output.'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Set-AiTaskState.ps1') -TaskDirectory $resolvedTask -Status 'orchestration_failed' | Out-Null
}

$state = Get-Content -Raw -LiteralPath (Join-Path $resolvedTask 'state.json') | ConvertFrom-Json
$status = [string]$state.status
switch ($status) {
    'approved' { $title = 'GymFlow AI - Approved'; $message = "Feature approved.`nReview: PASS`nTests: PASS`nSecurity: PASS"; $priority = 'default'; $tags = 'white_check_mark' }
    'blocked' { $title = 'GymFlow AI - Human input required'; $message = 'Architect blocked on an unresolved decision. Check the task reports.'; $priority = 'high'; $tags = 'warning' }
    'rejected' { $title = 'GymFlow AI - Rejected'; $message = 'Feature rejected. Check the final report.'; $priority = 'high'; $tags = 'x' }
    default { $title = 'GymFlow AI - Workflow failed'; $message = 'Workflow failed unexpectedly. Check orchestration logs.'; $priority = 'high'; $tags = 'rotating_light' }
}

$notificationResult = @(& (Join-Path $PSScriptRoot 'Send-AiNotification.ps1') -Status $status -Title $title -Message $message -Priority $priority -Tags $tags) | Select-Object -Last 1
if ($notificationResult -eq 'SENT') { $notificationState = 'sent' }
elseif ($notificationResult -eq 'NOT_CONFIGURED') { $notificationState = 'not_configured' }
else { $notificationState = 'failed' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Set-AiTaskState.ps1') -TaskDirectory $resolvedTask -Status $status -NotificationStatus $notificationState | Out-Null

Write-Output "Task directory: $taskDirectory"
Write-Output "Workflow status: $status"
if ($workflowFailed -or $status -notin @('approved', 'blocked', 'rejected')) { exit 1 }
