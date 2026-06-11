# Casos de Uso - cc-kiro-plugin

## UC01 - Sanity check read-only

Confirmar que o plugin esta instalado e que o Kiro responde.

```bash
/cc-kiro-plugin:kiro --read-only "Responda apenas: plugin-ok"
```

## UC02 - Arquitetura com contexto inline

```bash
/cc-kiro-plugin:kiro --read-only --dirs src,docs \
  "Explique a arquitetura do projeto e cite os arquivos mais importantes."
```

## UC03 - Refatoracao multi-arquivo

```bash
/cc-kiro-plugin:kiro \
  "Refatore o modulo de autenticacao para async/await, atualize os callers e rode os testes relevantes."
```

## UC04 - Monorepo / subprojeto

Use `--cwd` para executar o Kiro a partir da raiz do pacote correto.

```bash
/cc-kiro-plugin:kiro --cwd ./frontend --parallel \
  "Implemente as telas solicitadas, siga o design system existente e rode os checks do frontend."
```

## UC05 - Modelo e esforco

Listar modelos disponiveis:

```bash
/cc-kiro-plugin:kiro --list-models --model-format json-pretty
```

Selecionar modelo:

```bash
/cc-kiro-plugin:kiro --model sonnet --effort high \
  "Desenhe o schema do modulo de faturamento e implemente as migrations."
```

Tambem e possivel usar o agent `kiro-coder` para tarefas de implementacao com
modelo especifico.

## UC06 - Read-only com ferramentas restritas

`--read-only` troca o default agentic (`--trust-all-tools`) por
`--trust-tools=fs_read`.

```bash
/cc-kiro-plugin:kiro --read-only --dirs src \
  "Liste riscos de quebrar compatibilidade se o modulo cache for removido."
```

## UC07 - Sessao continua

```bash
/cc-kiro-plugin:kiro --continue \
  "Continue de onde parou e foque apenas nos testes que ainda falham."
```

## UC08 - Sessao especifica

```bash
/cc-kiro-plugin:kiro --conversation <SESSION_ID> \
  "Retome esta conversa e gere o resumo final das alteracoes."
```

## UC09 - Captura de output

```bash
/cc-kiro-plugin:kiro --read-only --output-file ./kiro-output.txt \
  "Analise a arquitetura e produza um relatorio detalhado."
```

## UC10 - Inspecionar comando resolvido

```bash
/cc-kiro-plugin:kiro --print-command --model sonnet \
  "Explique o modulo scripts."
```

O output deve mostrar `kiro-cli chat --no-interactive --wrap never` e, em modo
agentic, `--trust-all-tools`.

## UC11 - Recuperacao de quota

Quando o Kiro reporta rate limit/quota, o bridge emite:

```json
{"status":"QUOTA_EXAUSTED","reason":"quota or rate limit reached","model":"claude-sonnet-4.6","retry":"--continue"}
```

Depois do reset de quota:

```bash
/cc-kiro-plugin:kiro --continue "Continue a partir de onde parou."
```

## UC12 - Autenticacao headless

Para uso local:

```bash
kiro-cli login
```

Para automacao/headless sem interacao, configure `KIRO_API_KEY` conforme a
documentacao do Kiro CLI.
