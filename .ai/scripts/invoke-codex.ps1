[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('orchestrator', 'architect', 'developer', 'reviewer', 'fixer', 'tester', 'security', 'finalizer')]
    [string]$Role,
    [Parameter(Mandatory = $true)]
    [string]$TaskDirectory,
    [string]$FailureReport,
    [ValidateSet('Full', 'Fast')]
    [string]$Mode = 'Full'
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
    if ($null -eq $candidate) { throw 'Codex CLI was not found.' }
    $codexPath = $candidate
} else {
    $codexPath = $codexCommand.Source
}

$roleConfig = @{
    orchestrator = @{ sandbox = 'workspace-write'; output = 'orchestration.md'; instruction = @'
Act only as the Codex-first GymFlow Orchestrator. Never implement application source yourself. Read AGENTS.md, task.md, state.json, and .ai/README.md. Coordinate the file-based workflow by invoking the repository PowerShell helpers.

Your writable working directory is the task directory, not the repository root. The repository root is supplied in the invocation context. Read repository files using that absolute root and invoke helpers by absolute path. Never write outside the task directory; Developer/Fixer subprocesses own source changes.

ARCHITECT: Call Invoke-OpenCodeRole.ps1 -Role architect exactly once with the default 120-second timeout. On exit 124, immediately classify architect-provider-error.txt; PROVIDER_TIMEOUT must classify true and trigger a fresh Codex architect fallback without polling or retrying OpenCode. For any other failure, classify architect-provider-error.txt only when it exists. Only a true provider classification permits fallback; a runtime-error artifact or missing provider artifact is an orchestration failure. Record ArchitectModel codex, ArchitectFallback true, fallback role, a concise provider event reason, and fallback model codex before continuing. On OpenCode success, record ArchitectModel opencode/nemotron-3.5-lightning-free and ArchitectFallback false. STATUS: BLOCKED in a completed architecture report is a real result: set blocked and stop.

DEVELOPER: launch a fresh Codex developer. REVIEWER: launch a separate fresh read-only Codex reviewer. On review FAIL, increment review_cycles, launch a fresh fixer against review.md, then a fresh reviewer; maximum 3.

TESTER: launch a fresh independent Codex tester. On FAIL, increment test_cycles, launch a fresh fixer against tests.md, then a fresh tester; maximum 3.

SECURITY in Full mode: launch a fresh independent Codex security reviewer. Its result is authoritative. On FAIL, increment security_cycles, launch a fresh fixer against security.md, then a fresh security reviewer; maximum 3. For a high-risk task involving auth, authorization, multi-tenancy, billing/payments, support mode, superadmin, messaging/private communications, migrations, secrets, recovery, or permissions, optionally call the OpenCode security agent once for security-second-opinion.md. Never block or retry if this optional call fails.

FINALIZER in Full mode: Call Invoke-OpenCodeRole.ps1 -Role finalizer exactly once with minimal report context and the bounded helper timeout. On exit 124, immediately classify finalizer-provider-error.txt; PROVIDER_TIMEOUT must classify true and trigger a fresh Codex finalizer without polling or retrying OpenCode. For other failures, fallback only on a positively classified provider-error artifact; runtime/helper failures are orchestration failures. Record FinalizerModel codex plus the provider event and fallback role when fallback occurs.

FAST mode is allowed only for clearly low-risk work and runs Architect, Developer, Reviewer, and fresh Codex targeted Tester. It skips dedicated Security and Finalizer, records that they were skipped by mode, and may approve only after review and tests pass. If the task is high risk, reject FAST as blocked and require Full.

Set status approved only after all required gates pass. Otherwise set blocked or rejected. Persist every report and state transition. Produce a concise orchestration summary. Never deploy, push, commit, switch branches, run production migrations, expose secrets, or treat a real FAIL/BLOCKED as provider failure.
'@ }
    architect = @{ sandbox = 'read-only'; output = 'architecture.md'; instruction = @'
Act as the fresh read-only Codex fallback Architect. Read AGENTS.md and task.md; inspect only relevant code. Begin exactly STATUS: PLAN_READY or STATUS: BLOCKED. Cover task understanding, relevant files, D1 versus Durable Object placement, auth/authorization, tenant isolation, Workers compatibility, implementation plan, tests, risks, and unknowns. Do not implement.
'@ }
    developer = @{ sandbox = 'workspace-write'; output = 'implementation.md'; instruction = @'
Act as the fresh GymFlow Developer. Read AGENTS.md, task.md, and architecture.md. Verify the plan against relevant code and implement the smallest coherent solution. Preserve D1/DO placement, authorization, tenant isolation, and Workers compatibility. Avoid unrelated refactors and dependencies. Run targeted checks. Never deploy, push, commit, or run remote migrations. Report implemented changes, files, DB impact, checks, and remaining issues.
'@ }
    reviewer = @{ sandbox = 'read-only'; output = 'review.md'; instruction = @'
Act as a fresh independent GymFlow Reviewer. Do not modify files or trust the Developer conclusion. Read AGENTS.md, task.md, architecture.md, implementation.md, current git diff, and relevant source. Review correctness, D1/DO placement, authorization, tenant isolation, Workers compatibility, regressions, unnecessary changes, error handling, and SQL safety. Begin exactly STATUS: PASS or STATUS: FAIL. Number concrete issues with file locations.
'@ }
    fixer = @{ sandbox = 'workspace-write'; output = 'implementation.md'; instruction = @'
Act as a fresh GymFlow Fixer. Read AGENTS.md, task.md, architecture.md, implementation.md, and the specified latest failing report. Fix only concrete relevant issues. Do not redesign or refactor unrelated code. Preserve auth, isolation, storage placement, and Workers compatibility. Run targeted checks and update implementation.md. Never deploy, push, commit, or migrate production.
'@ }
    tester = @{ sandbox = 'workspace-write'; output = 'tests.md'; instruction = @'
Act as a fresh independent GymFlow Tester. Do not redesign or intentionally edit application source. Read AGENTS.md, task reports, package.json, relevant source, and feature-specific tests. Run actual relevant commands; generated build/test artifacts are allowed. Validate regressions, authorization, tenant isolation, and D1/DO behavior. Begin exactly STATUS: PASS or STATUS: FAIL. Include commands, results, failures, and untested risks.
'@ }
    security = @{ sandbox = 'read-only'; output = 'security.md'; instruction = @'
Act as a fresh independent authoritative GymFlow Security Reviewer. Review only the changed attack surface using task reports, git diff, and relevant source. Mandatory checks: authentication, authorization, tenant isolation, D1 versus Durable Object access, IDOR, sender/user impersonation, SQL injection, stored/reflected XSS, privilege escalation, Superadmin controls, support-mode abuse, secrets, unsafe client identifiers, cross-club access, R2, and Cloudflare-specific implications. Begin exactly STATUS: PASS or STATUS: FAIL. For each issue include severity, location, attack scenario, and required fix. Do not modify files.
'@ }
    finalizer = @{ sandbox = 'read-only'; output = 'final.md'; instruction = @'
Act as a fresh read-only fallback Finalizer. Use minimal context: task summary, architecture status, review.md, tests.md, security.md, state.json, and unresolved issues. Do not reread the repository unless a report is inconsistent. Approve only when all required gates pass and no critical issue remains. Begin exactly STATUS: APPROVED or STATUS: REJECTED.
'@ }
}

$config = $roleConfig[$Role]
if ($Role -eq 'fixer') {
    if ([string]::IsNullOrWhiteSpace($FailureReport)) { throw 'Fixer requires -FailureReport.' }
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
Repository root: $projectRoot
Workflow mode: $Mode
$failureLine
Use task files as the handoff contract and keep context targeted.
"@
$workingDirectory = if ($Role -eq 'orchestrator') { $resolvedTask } else { $projectRoot }
$arguments = @('exec', '--sandbox', $config.sandbox, '--ephemeral', '-C', $workingDirectory, '--output-last-message', $outputPath, $prompt)
& $codexPath @arguments
if ($LASTEXITCODE -ne 0) { throw "Codex role '$Role' failed with exit code $LASTEXITCODE." }
Write-Output $outputPath
