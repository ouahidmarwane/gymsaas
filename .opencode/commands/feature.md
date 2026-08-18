---
description: Run the guarded GymFlow multi-agent feature workflow
agent: orchestrator
---

Execute the complete GymFlow feature workflow for this request:

$ARGUMENTS

Follow `AGENTS.md` and these steps exactly:

1. Refuse an empty request. Record the initial `git status --short` so unrelated user changes can be preserved.
2. Create a unique workspace with:
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .ai/scripts/New-AiTask.ps1`
   Never interpolate the raw feature request into a shell command. Use the restricted edit tool to replace the returned folder's `task.md` with the exact request shown above. Use that `.ai/tasks/TASK-...` directory for every report. Update status with `Set-AiTaskState.ps1` at each stage.
3. Invoke the `architect` subagent with only AGENTS.md, task.md, and targeted repository inspection. Save its complete response to `architecture.md`.
   - If it begins `STATUS: BLOCKED`, set state to `blocked` and stop for user clarification.
   - If invocation itself fails, save the exact provider error inside the task directory and run `Test-ProviderFailure.ps1`.
   - Only when that script returns `true`, run `invoke-codex.ps1 -Role fallback-architect`, record `fallback-architect` in state, and continue.
   - Never treat an architectural BLOCKED result as provider failure.
4. Run a fresh Codex Developer:
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .ai/scripts/invoke-codex.ps1 -Role developer -TaskDirectory <task-dir>`
5. Run a fresh independent Codex Reviewer with `-Role reviewer`. Read the first status line from `review.md`.
   - On FAIL, increment `review_cycles`, run a fresh Fixer with `-Role fixer -FailureReport <task-dir>\review.md`, then a fresh Reviewer.
   - Stop rejected after three failed review/fix cycles.
6. Invoke the `tester` subagent and save its complete response to `tests.md`.
   - On FAIL, increment `test_cycles`, run a fresh Codex Fixer against `tests.md`, then rerun Tester.
   - Stop rejected after three failed test/fix cycles.
   - If Tester invocation fails, use `Test-ProviderFailure.ps1`; only a `true` result permits `fallback-tester`. Record fallback in state.
7. Invoke the `security` subagent and save its response to `security.md`.
   - On FAIL, increment `security_cycles`, run a fresh Codex Fixer against `security.md`, then rerun Security.
   - Stop rejected after three failed security/fix cycles.
   - Only a provider failure positively classified by `Test-ProviderFailure.ps1` permits `fallback-security`. Record it.
8. Invoke the `finalizer` subagent and save its response to `final.md`. If its provider invocation fails and conservative detection returns true, use `fallback-finalizer` and record it.
9. Set final state to `approved` only for `STATUS: APPROVED`; otherwise set `rejected`.
10. Report the task directory, each stage status, correction counts, fallbacks used, checks run, final Git status, and APPROVED/REJECTED.

Provider fallback is allowed only for clear 429/rate-limit/quota/model-unavailable/provider-unavailable/insufficient-credit/temporarily-unavailable errors. Ordinary reasoning errors, a blocked plan, review findings, test failures, and security findings must follow their real workflow paths.

Never commit, push, deploy, switch branches, modify production resources, run remote migrations, expose secrets, or discard user work.
