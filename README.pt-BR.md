<p align="center">
  <img src="banner.png" alt="banner do cc-kiro-plugin" />
</p>

# cc-kiro-plugin

Plugin para Claude Code e Codex que integra o [Kiro CLI](https://kiro.dev/docs/cli/quick-start/) como assistente agentic de programação. Ele roteia tarefas por um bridge Node.js compartilhado, permitindo delegar edições de arquivo, busca de código, comandos shell, análise arquitetural e implementação em múltiplas etapas para o Kiro.

## Instalação

### 1. Registre o marketplace

```bash
claude plugin marketplace add AllanHarlen/cc-kiro-plugin
```

### 2. Instale o plugin

```bash
claude plugin install cc-kiro-plugin
```

Ou abra o gerenciador interativo de plugins com `/plugin` e navegue para instalar.

### 3. Instale e autentique o Kiro CLI

```bash
# macOS/Linux
curl -fsSL https://cli.kiro.dev/install | bash

# Windows PowerShell
irm 'https://cli.kiro.dev/install.ps1' | iex
```

```bash
kiro-cli login
```

O modo headless do Kiro pode exigir `KIRO_API_KEY` em execuções sem interação.

## Por Que Usar O Bridge?

Claude poderia chamar `kiro-cli` direto via Bash, mas o plugin adiciona um contrato estável:

| Capacidade | `kiro-cli` direto | Via bridge |
|------------|-------------------|------------|
| Prompt consistente para coding | Manual a cada chamada | Constraints embutidas |
| Contexto inline de arquivos/diretórios | Manual | `--dirs` / `--files` |
| Permissões em headless | Manual | Default agentic ou `--read-only` |
| Captura de output | Manual | `--output-file` |
| Falhas estruturadas | Não | exit codes para quota/auth/timeout |
| Comando/skill no Claude Code | Não | `/cc-kiro-plugin:kiro` e `$kiro-integration` |

## Uso

```bash
/cc-kiro-plugin:kiro "Refatore o módulo de auth para async/await e atualize os callers"

/cc-kiro-plugin:kiro --dirs src,docs "Explique a arquitetura e cite arquivos importantes"

/cc-kiro-plugin:kiro --read-only --dirs src "Analise o impacto de remover o módulo de cache"

/cc-kiro-plugin:kiro --list-models --model-format json-pretty

/cc-kiro-plugin:kiro --model sonnet --effort high "Desenhe o schema do módulo X"

/cc-kiro-plugin:kiro --cwd ./frontend --parallel "Implemente as telas React solicitadas e rode checks"

/cc-kiro-plugin:kiro --continue "Continue a partir da etapa 3 da refatoração anterior"
```

Para uso como agent, use `kiro-coder` para implementação e `kiro-agent` para arquitetura, auditoria, planejamento e análise de impacto em modo read-only. Coding deve passar por `/cc-kiro-plugin:kiro`, `$kiro-integration` ou `kiro-coder`.

## Opções Do Bridge

| Opção | Comportamento |
|-------|---------------|
| `--dirs <path,...>` | Inclui diretórios no prompt |
| `--files <glob,...>` | Inclui arquivos específicos |
| `--add-dir <path>` | Alias de compatibilidade que inclui diretório; Kiro não tem `--add-dir` nativo |
| `--cwd <path>` | Executa Kiro a partir de um diretório específico |
| `--model <name>` | Encaminha para `kiro-cli chat --model` |
| `--list-models` | Lista modelos Kiro disponíveis |
| `--model-format <format>` | Formato de saída para `--list-models` |
| `--effort <level>` | Encaminha para `kiro-cli chat --effort` |
| `--agent <name>` | Encaminha para `kiro-cli chat --agent` |
| `--kiro-agent <name>` | Alias retrocompativel para `--agent` |
| `--trust-tools <names>` | Encaminha para `kiro-cli chat --trust-tools=<names>` |
| `--parallel` | Pede ao Kiro para usar subagents/crew quando fizer sentido |
| `--subagent-model <name>` | Pede que subagents usem um modelo quando disponível |
| `--read-only` | Usa `--trust-tools=fs_read` em vez de `--trust-all-tools` |
| `--continue`, `-c` | Retoma a última sessão Kiro do diretório |
| `--conversation <id>` | Retoma uma sessão específica via `--resume-id` |
| `--timeout <duration>` | Timeout de silêncio do bridge |
| `--output-file <path>` | Captura o output completo em arquivo |
| `--print-command` | Mostra o comando `kiro-cli` resolvido sem executar |

## Desenvolvimento Local

```bash
npm test
```

Arquivos principais:

- `scripts/kiro-bridge.js`
- `scripts/check-kiro.js`
- `commands/kiro.md`
- `agents/kiro-coder.md`
- `agents/kiro-agent.md`
- `skills/SKILL.md`

## Exit Codes

| Código | Significado |
|--------|-------------|
| `0` | Sucesso |
| `1` | Erro genérico |
| `10` | `QUOTA_EXAUSTED` |
| `11` | `AUTH_REQUIRED` |
| `12` | `TIMEOUT` |
| `13` | `KIRO_MISSING` |
