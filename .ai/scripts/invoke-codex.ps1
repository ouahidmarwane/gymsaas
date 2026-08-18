[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('developer', 'reviewer', 'fixer', 'fallback-orchestrator', 'fallback-architect', 'fallback-tester', 'fallback-security', 'fallback-finalizer')]
    [string]$Role,

    [Parameter(Mandatory = $true)]
    [string]$TaskDirectory,

    [string]$FailureReport
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tasksRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '.ai\tasks'))
$resolvedTask = (Resolve-Path -LiteralPath $TaskDirectory).Path
if (-not $resolvedTask.StartsWith($tasksRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Task directory must be under .ai/tasks.'
}

$codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue
if ($null -eq $codexCommand) {
    $extensionRoot = Join-Path $env:USERPROFILE '.vscode\extensions'
    $candidate = Get-ChildItem -LiteralPath $extensionRoot -Directory -Filter 'openai.chatgpt-*-win32-x64' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object { Join-Path $_.FullName 'bin\windows-x86_64\codex.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
    if ($null -eq $candidate) {
        throw 'Codex CLI was not found. Add codex.exe to PATH or install the Codex CLI.'
    }
    $codexPath = $candidate
} else {
    $codexPath = $codexCommand.Source
}

$roleConfig = @{
    'fallback-orchestrator' = @{ sandbox = 'workspace-write'; output = 'orchestration.md'; instruction = @'
Act as the fallback GymFlow Orchestrator because the OpenCode orchestrator provider failed. Read AGENTS.md, .opencode/commands/feature.md, and the existing task.md. Execute the same file-based workflow from architecture onward. Use fresh invoke-codex.ps1 processes for Developer, Reviewer, every Fixer, fallback Tester, fallback Security, and fallback Finalizer. Produce architecture.md yourself before development. Enforce three-cycle limits with Set-AiTaskState.ps1. Treat real BLOCKED/FAIL results normally, never as provider failures. Persist every report and state transition. Never deploy, push, commit, switch branches, or run production migrations. Your final response is an orchestration summary, while final.md remains the final gate report.
'@ }
    developer = @{ sandbox = 'workspace-write'; output = 'implementation.md'; instruction = @'
Act as the GymFlow Developer. Read AGENTS.md, task.md, and architecture.md. Inspect only relevant code and verify the plan against reality. Implement the smallest coherent solution, preserving D1/DO placement, authorization, tenant isolation, and Workers compatibility. Avoid unrelated refactors and dependencies. Run relevant local checks. Never deploy, push, commit, or run remote migrations. Your final response becomes implementation.md and must include implemented changes, files modified, database changes, checks run, and remaining issues.
'@ }
    reviewer = @{ sandbox = 'read-only'; output = 'review.md'; instruction = @'
Act as an independent GymFlow Reviewer. Do not modify files. Read AGENTS.md, task.md, architecture.md, implementation.md, and the current git diff. Do not assume the Developer is correct. Review correctness, architecture, D1/DO placement, authorization, tenant isolation, Workers compatibility, regression risk, unnecessary changes, error handling, and SQL safety. Begin exactly STATUS: PASS or STATUS: FAIL. If failing, provide numbered concrete issues with file locations.
'@ }
    fixer = @{ sandbox = 'workspace-write'; output = 'implementation.md'; instruction = @'
Act as the GymFlow Fixer in a fresh session. Read AGENTS.md, task.md, architecture.md, implementation.md, and the specified latest failing report. Fix only concrete relevant issues. Do not redesign or fix unrelated findings. Preserve auth, isolation, storage placement, and Workers compatibility. Run targeted checks, never deploy/push/commit/migrate production, and update the implementation report with fixes and validation.
'@ }
    'fallback-architect' = @{ sandbox = 'read-only'; output = 'architecture.md'; instruction = @'
Act as the read-only fallback Architect. Read AGENTS.md and task.md, inspect only relevant code, and produce architecture.md content. Begin exactly STATUS: PLAN_READY or STATUS: BLOCKED. Cover task understanding, existing architecture, relevant files, database impact, auth/authorization, multi-tenancy, Cloudflare runtime, plan, tests, risks, and unknowns. Do not implement.
'@ }
    'fallback-tester' = @{ sandbox = 'workspace-write'; output = 'tests.md'; instruction = @'
Act as the fallback Tester. Do not edit source. Read AGENTS.md and task reports plus package.json. Run relevant non-destructive checks; generated test/build outputs are allowed. Assess regressions, authorization, tenant isolation, and D1/DO behavior. Begin exactly STATUS: PASS or STATUS: FAIL and report commands, results, failures, and untested risks.
'@ }
    'fallback-security' = @{ sandbox = 'read-only'; output = 'security.md'; instruction = @'
Act as the read-only fallback Security Reviewer. Review only the changed attack surface using task reports and git diff. Check authentication, authorization, tenant isolation, storage boundaries, SQL injection, XSS, secrets, R2, client IDs, privilege escalation, and Workers security. Begin exactly STATUS: PASS or STATUS: FAIL. For issues include severity, location, attack scenario, and fix.
'@ }
    'fallback-finalizer' = @{ sandbox = 'read-only'; output = 'final.md'; instruction = @'
Act as the read-only fallback Finalizer. Read the task reports and state first; inspect diff only if needed. Approve only if architecture, review, tests, security, tenant isolation, and Workers compatibility are acceptable with no critical unresolved issue. Begin exactly STATUS: APPROVED or STATUS: REJECTED and explain briefly.
'@ }
}

$config = $roleConfig[$Role]
if ($Role -eq 'fixer') {
    if ([string]::IsNullOrWhiteSpace($FailureReport)) {
        throw 'Fixer requires -FailureReport.'
    }
    $resolvedFailure = (Resolve-Path -LiteralPath $FailureReport).Path
    if (-not $resolvedFailure.StartsWith($resolvedTask + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Failure report must be inside the task directory.'
    }
    $failureLine = "Latest failing report: $resolvedFailure"
} else {
    $failureLine = ''
}

$outputPath = Join-Path $resolvedTask $config.output
$prompt = @"
$($config.instruction)

Task directory: $resolvedTask
$failureLine
Use the task files as the handoff contract and keep context targeted.
"@

$arguments = @(
    'exec',
    '--sandbox', $config.sandbox,
    '--ephemeral',
    '-C', $projectRoot,
    '--output-last-message', $outputPath,
    $prompt
)

& $codexPath @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Codex role '$Role' failed with exit code $LASTEXITCODE."
}
Write-Output $outputPath
