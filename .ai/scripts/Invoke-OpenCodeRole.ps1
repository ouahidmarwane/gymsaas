[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('architect', 'security', 'finalizer')]
    [string]$Role,
    [Parameter(Mandatory = $true)]
    [string]$TaskDirectory,
    [ValidateRange(1, 300)]
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tasksRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '.ai\tasks'))
$resolvedTask = (Resolve-Path -LiteralPath $TaskDirectory).Path
if (-not $resolvedTask.StartsWith($tasksRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Task directory must be under .ai/tasks.'
}

$outputMap = @{ architect = 'architecture.md'; security = 'security-second-opinion.md'; finalizer = 'final.md' }
$outputPath = Join-Path $resolvedTask $outputMap[$Role]
$errorPath = Join-Path $resolvedTask ($Role + '-provider-error.txt')
$runtimeErrorPath = Join-Path $resolvedTask ($Role + '-runtime-error.txt')
$outputCapturePath = Join-Path $resolvedTask ($Role + '-stdout.capture')
$errorCapturePath = Join-Path $resolvedTask ($Role + '-stderr.capture')
$configHomePath = Join-Path $resolvedTask ('.opencode-xdg-{0}-{1}' -f $Role, [Guid]::NewGuid().ToString('N'))
$configPath = Join-Path $configHomePath 'opencode'
$promptPath = Join-Path $resolvedTask ($Role + '-request.txt')
Set-Content -LiteralPath $promptPath -Encoding UTF8 -Value "Read AGENTS.md and the task reports in '$resolvedTask'. Execute the configured $Role role once. Return only the required report content. Do not modify application source."

Remove-Item -LiteralPath $errorPath, $runtimeErrorPath, $outputCapturePath, $errorCapturePath -Force -ErrorAction SilentlyContinue

function ConvertTo-CmdArgument {
    param([Parameter(Mandatory = $true)][string]$Value)

    # These arguments are passed through cmd.exe because npm installs OpenCode as
    # opencode.cmd. Double quotes are doubled for cmd's quoted argument syntax.
    return '"' + $Value.Replace('"', '""') + '"'
}

try {
    $openCodeCommand = Get-Command 'opencode.cmd' -CommandType Application -ErrorAction Stop
    $commandProcessor = if ($env:ComSpec) { $env:ComSpec } else { 'cmd.exe' }
    $openCodeArguments = @(
        'run'
        '--agent'
        $Role
        ("Read $promptPath and follow it exactly.")
    )
    # Set the supported config override inside cmd.exe instead of indexing
    # ProcessStartInfo.EnvironmentVariables. The latter can be null under the
    # Windows PowerShell 5 host created by the Codex orchestrator.
    $commandLine = 'set OPENCODE_CONFIG_DIR=' + $configPath + '&& '
    $commandLine += 'set XDG_CONFIG_HOME=' + $configHomePath + '&& '
    $commandLine += (ConvertTo-CmdArgument $openCodeCommand.Source) + ' ' + (($openCodeArguments | ForEach-Object { ConvertTo-CmdArgument $_ }) -join ' ')
    # Let cmd.exe own file redirection. Managed redirected streams can remain open
    # when a descendant inherits their handles, making ReadToEnd/ReadToEndAsync
    # wait beyond the advertised timeout even after the wrapper is terminated.
    $commandLine += ' 1>' + (ConvertTo-CmdArgument $outputCapturePath) + ' 2>' + (ConvertTo-CmdArgument $errorCapturePath)

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $commandProcessor
    $startInfo.Arguments = '/d /s /c ' + (ConvertTo-CmdArgument $commandLine)
    $startInfo.WorkingDirectory = $projectRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $false
    $startInfo.RedirectStandardError = $false
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw 'System.Diagnostics.Process.Start returned false.'
    }
}
catch {
    Set-Content -LiteralPath $runtimeErrorPath -Encoding UTF8 -Value ("OpenCode orchestration/runtime launch failure: " + $_.Exception.Message)
    [Console]::Error.WriteLine("OpenCode did not launch. See '$runtimeErrorPath'.")
    exit 125
}

$timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
if ($timedOut) {
    # .NET Framework/Windows PowerShell 5 has no Process.Kill(entireProcessTree).
    # OpenCode is behind a cmd.exe wrapper, so terminate that complete tree or
    # the child can retain stdout/stderr pipe handles and defeat the timeout.
    $taskKill = New-Object System.Diagnostics.Process
    $taskKill.StartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $taskKill.StartInfo.FileName = "$env:SystemRoot\System32\taskkill.exe"
    $taskKill.StartInfo.Arguments = "/PID $($process.Id) /T /F"
    $taskKill.StartInfo.UseShellExecute = $false
    $taskKill.StartInfo.CreateNoWindow = $true
    try {
        if ($taskKill.Start()) {
            [void]$taskKill.WaitForExit(5000)
            if (-not $taskKill.HasExited) { $taskKill.Kill() }
        }
    }
    catch { }
    if (-not $process.HasExited) {
        try { $process.Kill() } catch { }
    }

    $timeoutArtifact = @(
        'PROVIDER_TIMEOUT'
        "Role: $Role"
        "TimeoutSeconds: $TimeoutSeconds"
    ) -join [Environment]::NewLine
    Set-Content -LiteralPath $errorPath -Encoding UTF8 -Value $timeoutArtifact
    exit 124
}

$capturedError = if (Test-Path -LiteralPath $errorCapturePath) { Get-Content -Raw -LiteralPath $errorCapturePath } else { '' }
if ($process.ExitCode -ne 0) {
    if ($capturedError -match '(?is)EEXIST:.*mkdir.*[\\/]opencode') {
        Set-Content -LiteralPath $runtimeErrorPath -Encoding UTF8 -Value ("OpenCode local config initialization failure." + [Environment]::NewLine + $capturedError)
        Remove-Item -LiteralPath $errorPath -Force -ErrorAction SilentlyContinue
        exit 125
    }
    if (-not [string]::IsNullOrWhiteSpace($capturedError)) {
        Set-Content -LiteralPath $errorPath -Encoding UTF8 -Value $capturedError
    }
    exit $process.ExitCode
}
$capturedOutput = if (Test-Path -LiteralPath $outputCapturePath) { Get-Content -Raw -LiteralPath $outputCapturePath } else { '' }
if ([string]::IsNullOrWhiteSpace($capturedOutput)) {
    Set-Content -LiteralPath $errorPath -Encoding UTF8 -Value 'Provider returned no report content.'
    exit 1
}
Set-Content -LiteralPath $outputPath -Encoding UTF8 -Value $capturedOutput
Write-Output $outputPath
