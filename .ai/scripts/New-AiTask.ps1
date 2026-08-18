[CmdletBinding()]
param(
    [ValidateNotNullOrEmpty()]
    [string]$Task = 'Task details pending.',

    [string]$Id
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tasksRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '.ai\tasks'))

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
Set-Content -LiteralPath (Join-Path $taskDirectory 'task.md') -Encoding UTF8 -Value ("# Task`r`n`r`n" + $Task.Trim() + "`r`n")

foreach ($report in @('architecture.md', 'implementation.md', 'review.md', 'tests.md', 'security.md', 'final.md')) {
    Set-Content -LiteralPath (Join-Path $taskDirectory $report) -Encoding UTF8 -Value "STATUS: PENDING`r`n"
}

$state = [ordered]@{
    status = 'created'
    review_cycles = 0
    test_cycles = 0
    security_cycles = 0
    fallback_roles = @()
}
$state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskDirectory 'state.json') -Encoding UTF8

Write-Output ('.ai\tasks\TASK-' + $Id)
