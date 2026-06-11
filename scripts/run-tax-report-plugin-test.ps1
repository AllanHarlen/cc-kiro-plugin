param(
  [string]$ClaudeCommand = "claude"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$LogsDir = Join-Path $RepoRoot ".kirocli\logs"
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogPath = Join-Path $LogsDir "tax-report-plugin-test-$Stamp.jsonl"
New-Item -ItemType File -Force -Path $LogPath | Out-Null

$Claude = Get-Command $ClaudeCommand -ErrorAction SilentlyContinue
if (-not $Claude) {
  throw "Claude Code command '$ClaudeCommand' was not found on PATH. Pass -ClaudeCommand with the correct executable name."
}

$env:CC_KIRO_LOG_PATH = $LogPath
$env:CC_KIRO_LOG_OUTPUT = "1"
$env:CLAUDE_PLUGIN_ROOT = $RepoRoot

$PluginCommand = @"
/cc-kiro-plugin:kiro --timeout 5m Crie relatorio-impostos.html com um relatorio sobre a divisao dos impostos no Brasil. Explique impostos federais, estaduais e municipais, inclua exemplos, use HTML sem dependencias externas e CSS simples dentro de uma tag style.
"@

Write-Host "cc-kiro-plugin tax report test"
Write-Host "Repo: $RepoRoot"
Write-Host "Log:  $LogPath"
Write-Host ""
Write-Host "Antes de executar o prompt, confirme no Claude Code que o plugin esta instalado:"
Write-Host "/plugin marketplace add ./"
Write-Host "/plugin install cc-kiro-plugin@cc-kiro-plugin"
Write-Host "/reload-plugins"
Write-Host ""
Write-Host "Depois cole este comando no Claude Code para chamar o Kiro:"
Write-Host $PluginCommand
Write-Host ""
Write-Host "Quando o Kiro terminar, confira o arquivo relatorio-impostos.html na raiz do projeto."
Write-Host ""

$Pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
if (-not $Pwsh) {
  $Pwsh = Get-Command powershell -ErrorAction Stop
}

$TailCommand = @"
Write-Host 'Monitoring cc-kiro-plugin tax report log:'
Write-Host '$LogPath'
Write-Host ''
Get-Content -LiteralPath '$LogPath' -Wait
"@

Start-Process -FilePath $Pwsh.Source -ArgumentList @("-NoExit", "-Command", $TailCommand) | Out-Null

Push-Location $RepoRoot
try {
  & $Claude.Source
}
finally {
  Pop-Location
  Write-Host ""
  Write-Host "Claude Code session ended."
  Write-Host "Log file: $LogPath"
  Write-Host "Expected report: $(Join-Path $RepoRoot 'relatorio-impostos.html')"
}
