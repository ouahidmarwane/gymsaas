# GymFlow Codex-first orchestration

GymFlow uses a fresh Codex process as the authoritative workflow Orchestrator. OpenCode is a bounded runtime only for the remaining free-model roles. Task reports under `.ai/tasks/` are the handoff contract; agents do not share conversational memory.

## Recommended entrypoint

Large request file:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .ai/scripts/Invoke-AiFeature.ps1 -TaskFile ".ai/requests/messaging.md" -Mode Full
```

Short low-risk request:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .ai/scripts/Invoke-AiFeature.ps1 -Task "Fix spacing on dashboard cards" -Mode Fast
```

`-TaskFile` reads a repository-local file directly; large prompts are never placed in a command string. Exactly one of `-Task` and `-TaskFile` is required. Full is the default.

OpenCode `/feature` is an optional interactive convenience that shows the recommended PowerShell invocation. It is not the normal full-workflow orchestrator.

## Models and independence

| Role | Primary | Fallback | Process/sandbox |
|---|---|---|---|
| Orchestrator | Codex | None | Fresh, workspace-write; coordination only |
| Architect | `opencode/nemotron-3.5-lightning-free` | Fresh Codex | One free attempt; fallback read-only |
| Developer | Codex | None | Fresh, workspace-write |
| Reviewer | Codex | None | Fresh independent, read-only |
| Fixer | Codex | None | Fresh per correction, workspace-write |
| Tester | Codex | None | Fresh independent, workspace-write for generated outputs |
| Security | Codex | None | Fresh independent, read-only |
| Security second opinion | `opencode/nemotron-3.5-lightning-free` | Skip | Optional once for high-risk tasks |
| Finalizer | `opencode/nemotron-3-ultra-free` | Fresh Codex | One free attempt; minimal-context read-only fallback |

Every Codex role uses `codex exec --ephemeral`. Reviewer, Tester, Security, Fixer, and Developer never reuse a Codex conversation.

## Full and Fast workflows

Full:

```text
Architect -> Developer -> Reviewer/Fixer loop
          -> Tester/Fixer loop
          -> Codex Security/Fixer loop
          -> optional high-risk security second opinion
          -> Finalizer
```

Full is mandatory for authentication, authorization, messaging/private communications, billing/payments, permissions, databases/migrations, multi-tenancy, support mode, Superadmin, secrets, account recovery, security, and large features.

Fast:

```text
Architect -> Developer -> Reviewer/Fixer loop -> targeted Codex Tester
```

Fast skips dedicated Security and Finalizer only for clearly low-risk work. The Codex Orchestrator must block Fast mode when the task is high risk.

## Task state and reports

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

State includes mode, Codex orchestrator, selected Architect and Finalizer models, fallback flags/events, three correction counters, and notification status. Optional second-opinion and local provider-error files may also appear. Generated task folders and request Markdown files are ignored by Git; their `.gitkeep` files remain tracked.

## Provider fallback and timeouts

Architect and Finalizer receive one normal free-model attempt each. There are no retries. Architect has a hard 120-second default maximum. On a helper-enforced timeout, `Invoke-OpenCodeRole.ps1` terminates the complete Windows process tree, writes a deterministic `PROVIDER_TIMEOUT` artifact, and exits 124 without waiting on redirected pipes. `Test-ProviderFailure.ps1` recognizes that marker plus HTTP 429/502/503/504, upstream/gateway timeout, rate limits, quota/token quota, insufficient credits, unavailable model/provider, and temporary unavailability. Local launcher/runtime failures remain orchestration failures and never automatically activate fallback.

On Windows, each OpenCode role attempt receives a unique task-local `OPENCODE_CONFIG_DIR`. The launcher also scopes `XDG_CONFIG_HOME` to its parent because OpenCode 1.18.18 resolves that XDG variable while newer CLI documentation names `OPENCODE_CONFIG_DIR`. Both overrides are set inside the launched `cmd.exe` command rather than injected through `ProcessStartInfo.EnvironmentVariables`, which is not reliable in every Windows PowerShell 5 host. This avoids concurrent initialization races in the user's shared `~/.config/opencode` directory without altering global configuration or provider credentials. The task-local directory is generated beneath the ignored task workspace.

Only a positively classified provider/runtime error activates Codex fallback. `STATUS: BLOCKED`, review/test/security FAIL, architecture rejection, and invalid code remain real workflow results.

The optional Nemotron security second opinion is attempted once only for high-risk work. Failure or timeout is logged and skipped; Codex Security remains authoritative.

## ntfy workflow notifications

Notifications are sent once, after a meaningful terminal state: approved, rejected, blocked, or unexpected orchestration failure. Notification failure never changes workflow status.

The workflow invokes the notification helper in its own PowerShell process context, so it uses the same `GYMFLOW_NTFY_URL` and `GYMFLOW_NTFY_TOPIC` environment it received at launch. Windows PowerShell 5 explicitly enables TLS 1.2 for the request. Notification output never includes the topic or request URI.

Configure in the launching PowerShell environment:

```powershell
$env:GYMFLOW_NTFY_URL = "https://ntfy.sh"
$env:GYMFLOW_NTFY_TOPIC = "<private-topic>"
```

`GYMFLOW_NTFY_URL` is optional and defaults to `https://ntfy.sh`. The topic has no default and is never printed. If it is unset, notification is a no-op.

Safe configuration-only test:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .ai/scripts/Send-AiNotification.ps1 -Status test -Title test -Message test -DryRun
```

## Optional native Codex notify hook

Codex CLI supports a `notify` command array in user `config.toml` for supported events, currently `agent-turn-complete`. That hook runs for individual Codex turns, so enabling mobile pushes there would create subagent spam. Leave it disabled or use it only for local desktop feedback. ntfy at the PowerShell workflow boundary is the reliable mobile channel.

## Troubleshooting

- `codex.exe --version` and `opencode.cmd --version` verify installations.
- `opencode.cmd models` verifies the two free-model IDs.
- Inspect `state.json`, `orchestration.md`, gate reports, and role-specific provider-error files.
- A 429 or 504 should produce one logged fallback, not repeated retries.
- If Codex is absent from PATH, the runner resolves the newest installed OpenAI VS Code extension.
- Use `npm.cmd` when PowerShell blocks `npm.ps1`.
- Never put credentials, ntfy topics, or environment values in task reports.

The workflow never commits, pushes, deploys, applies production migrations, rotates secrets, or changes production Cloudflare resources.
