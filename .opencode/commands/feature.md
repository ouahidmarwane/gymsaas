---
description: Show the recommended Codex-first feature command
---

The normal full workflow is Codex-first and must be launched from PowerShell, not orchestrated by an OpenCode model.

For this short request:

$ARGUMENTS

Use:

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .ai/scripts/Invoke-AiFeature.ps1 -Task "<short feature>" -Mode Full`

For a large request, save it under `.ai/requests/` and use:

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .ai/scripts/Invoke-AiFeature.ps1 -TaskFile ".ai/requests/request.md" -Mode Full`

Do not interpolate untrusted request text into a dynamically evaluated shell string. This OpenCode command is an interactive convenience only; the PowerShell entrypoint launches the authoritative Codex Orchestrator.
