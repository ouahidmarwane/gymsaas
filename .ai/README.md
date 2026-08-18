# GymFlow multi-agent workflow

This repository uses OpenCode 1.18.18 as the local orchestrator and Codex CLI as the implementation and independent-review engine. All cross-agent communication is persisted under `.ai/tasks/`; conversational state is not trusted as a handoff.

## Roles and models

| Role | Primary | Fallback | Access |
|---|---|---|---|
| Orchestrator | `opencode/nemotron-3-ultra-free` | Codex through `Invoke-AiFeature.ps1` | Task reports and guarded helper commands |
| Architect | `opencode/nemotron-3.5-lightning-free` | Codex read-only | Read-only planning |
| Developer | Codex | None | Workspace-write |
| Reviewer | Fresh Codex | Optional Lightning only by manual choice | Read-only |
| Fixer | Fresh Codex | None | Workspace-write |
| Tester | `opencode/mimo-v2.5-free` | Codex test workspace | Read plus safe validation commands |
| Security | `opencode/nemotron-3.5-lightning-free` | Codex read-only | Changed attack surface, read-only |
| Finalizer | `opencode/nemotron-3-ultra-free` | Codex read-only | Reports first, read-only |

The model IDs above were confirmed with `opencode.cmd models`. Each Codex call uses `codex exec --ephemeral`, so Developer, Reviewer, and Fixer never share a Codex session.

## Task folders

`.ai/scripts/New-AiTask.ps1` creates:

```text
.ai/tasks/TASK-<timestamp>-<suffix>/
  task.md
  architecture.md
  implementation.md
  review.md
  tests.md
  security.md
  final.md
  state.json
```

`state.json` tracks the workflow status, review/test/security correction counts, and roles that used fallback. Each correction category is capped at three cycles.

## Run a feature

Start OpenCode from the repository root:

```powershell
opencode.cmd .
```

Then run:

```text
/feature Add feature X
```

The command selects the `orchestrator` primary agent and runs:

```text
Architect -> Developer -> Reviewer
  -> Fixer/Reviewer (up to 3)
  -> Tester -> Fixer/Tester (up to 3)
  -> Security -> Fixer/Security (up to 3)
  -> Finalizer
```

OpenCode may ask permission for any command not explicitly allowlisted. Do not use `--auto` until you have reviewed the project permissions. Explicit denials remain enforced even in auto mode.

## Reports and stopping

Inspect the newest folder under `.ai/tasks/`. Every report starts with a machine-readable status line. To stop, cancel the active OpenCode operation with the TUI interrupt command or close the process. The completed report files remain available for resumption; inspect `state.json` before continuing.

No stage commits automatically. Review `git diff` and all reports before creating a commit.

## Codex runner

Run a role manually from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .ai/scripts/invoke-codex.ps1 -Role reviewer -TaskDirectory .ai/tasks/TASK-...
```

Supported roles are `developer`, `reviewer`, `fixer`, `fallback-orchestrator`, `fallback-architect`, `fallback-tester`, `fallback-security`, and `fallback-finalizer`. Fixer also requires `-FailureReport`. The runner resolves `codex.exe` from PATH or the newest installed OpenAI VS Code extension.

For automatic fallback when the OpenCode Orchestrator itself cannot start, launch:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .ai/scripts/Invoke-AiFeature.ps1 -Task "Add feature X"
```

This wrapper activates `fallback-orchestrator` only when the conservative provider classifier confirms a provider/runtime failure. Ordinary workflow failures are preserved.

## Fallback behavior

`.ai/scripts/Test-ProviderFailure.ps1` conservatively recognizes only explicit provider/runtime conditions: HTTP 429, rate limit, exhausted quota, unavailable model/provider, insufficient credits/token quota, or temporarily unavailable service. Only those conditions activate a Codex fallback, and the role is logged in `state.json`.

Do not use fallback for a blocked architecture, failed review, failing test, security finding, or final rejection. Those are real workflow outcomes.

## Token efficiency

Agents receive task reports and targeted files only:

- architecture uses the task and relevant modules;
- development uses task, plan, and relevant code;
- review uses reports and diff;
- testing uses implementation, package scripts, and failures;
- security uses only changed attack surface;
- finalization uses reports before code.

Avoid pasting repository-wide output into reports. Record paths, decisions, concise results, and actionable failures.

## Troubleshooting

- Run `codex.exe --version` and `opencode.cmd --version`.
- Run `opencode.cmd agent list` to confirm project agents load.
- Run `opencode.cmd models` to confirm provider/model availability.
- If a free model fails, save the exact error and classify it with `Test-ProviderFailure.ps1`.
- If Codex is not found, add its CLI to PATH or ensure the OpenAI VS Code extension is installed.
- If PowerShell blocks an npm wrapper, use `npm.cmd`.
- Never place credentials in task reports or command arguments.

The workflow never pushes, deploys, applies production migrations, rotates secrets, or modifies production Cloudflare resources.
