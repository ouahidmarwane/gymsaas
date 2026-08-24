[CmdletBinding(DefaultParameterSetName = 'Task')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Task')]
    [ValidateNotNullOrEmpty()]
    [string]$Task,

    [Parameter(Mandatory = $true, ParameterSetName = 'TaskFile')]
    [ValidateNotNullOrEmpty()]
    [string]$TaskFile,

    [string]$Id,

    [ValidateSet('Full', 'Fast')]
    [string]$Mode = 'Full'
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tasksRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '.ai\tasks'))

if ($PSCmdlet.ParameterSetName -eq 'TaskFile') {
    $resolvedRequest = (Resolve-Path -LiteralPath $TaskFile).Path
    if (-not $resolvedRequest.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'TaskFile must be inside the GymFlow repository.'
    }
    $taskText = Get-Content -Raw -LiteralPath $resolvedRequest
} else {
    $taskText = $Task
}
if ([string]::IsNullOrWhiteSpace($taskText)) { throw 'The feature task is empty.' }

if ([string]::IsNullOrWhiteSpace($Id)) {
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 6)
    $Id = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $suffix
}

if ($Id -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
    throw 'Task ID may contain only letters, numbers, dot, underscore, and hyphen.'
}

$taskDirectory = [System.IO.Path]::GetFullPath((Join-Path $tasksRoot ('TASK-' + $Id)))
if (-not $taskDirectory.StartsWith($tasksRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Resolved task directory is outside .ai/tasks.'
}
if (Test-Path -LiteralPath $taskDirectory) {
    throw "Task directory already exists: $taskDirectory"
}

New-Item -ItemType Directory -Path $taskDirectory | Out-Null
Set-Content -LiteralPath (Join-Path $taskDirectory 'task.md') -Encoding UTF8 -Value ("# Task`r`n`r`n" + $taskText.Trim() + "`r`n")

foreach ($report in @('architecture.md', 'implementation.md', 'review.md', 'tests.md', 'security.md', 'final.md')) {
    Set-Content -LiteralPath (Join-Path $taskDirectory $report) -Encoding UTF8 -Value "STATUS: PENDING`r`n"
}

$state = [ordered]@{
    status = 'created'
    mode = $Mode.ToLowerInvariant()
    orchestrator = 'codex'
    architect_model = 'pending'
    architect_fallback = $false
    review_cycles = 0
    test_cycles = 0
    security_cycles = 0
    finalizer_model = 'pending'
    notification_status = 'pending'
    provider_events = @()
    fallback_roles = @()
}
$state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskDirectory 'state.json') -Encoding UTF8

Write-Output ('.ai\tasks\TASK-' + $Id)
