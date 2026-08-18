[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Task
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location -LiteralPath $projectRoot

$taskDirectory = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'New-AiTask.ps1') -Task $Task
if ($LASTEXITCODE -ne 0) {
    throw 'Could not create the task workspace.'
}
$taskDirectory = $taskDirectory | Select-Object -Last 1
$resolvedTask = (Resolve-Path -LiteralPath $taskDirectory).Path
$errorPath = Join-Path $resolvedTask 'orchestrator-provider-error.txt'
$outputPath = Join-Path $resolvedTask 'orchestrator-output.txt'

$message = "Execute the complete workflow in .opencode/commands/feature.md using the existing task directory '$taskDirectory'. Do not create another task. Start at architecture, persist every report, and enforce all safety and cycle rules."
$openCodeOutput = & opencode.cmd run --agent orchestrator $message 2>&1
$openCodeExit = $LASTEXITCODE
$openCodeOutput | Set-Content -LiteralPath $outputPath -Encoding UTF8

if ($openCodeExit -eq 0) {
    Write-Output $openCodeOutput
    Write-Output "Task directory: $taskDirectory"
    exit 0
}

$openCodeOutput | Set-Content -LiteralPath $errorPath -Encoding UTF8
$providerFailure = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Test-ProviderFailure.ps1') -InputFile $errorPath
if ($providerFailure -ne 'true') {
    throw "OpenCode failed with a non-provider error. Inspect $errorPath; Codex fallback was not activated."
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Set-AiTaskState.ps1') -TaskDirectory $resolvedTask -Status 'fallback-orchestrator' -FallbackRole 'fallback-orchestrator' | Out-Null
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'invoke-codex.ps1') -Role 'fallback-orchestrator' -TaskDirectory $resolvedTask
if ($LASTEXITCODE -ne 0) {
    throw 'Codex fallback Orchestrator failed.'
}
Write-Output "Task directory: $taskDirectory"
