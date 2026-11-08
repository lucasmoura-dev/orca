# Atualização do fork (orca-custom-update)

O app instalado continua verificando as releases oficiais do `stablyai/orca`. Quando o usuário
aceita a atualização, o updater (patch em `src/main/updater/custom/`) chama este script em vez
de baixar o AppImage oficial. O script mescla a tag do upstream no branch `custom/main`, verifica,
compila o AppImage e o instala em `~/Applications/Orca.AppImage`. "Reiniciar" relança o AppImage.

## Peças

| Peça              | Onde                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| Script            | `custom/update/orca-custom-update.mjs` (+ `shared.mjs`, `claude-step.mjs`), versionado no branch |
| Wrapper           | `~/.local/bin/orca-custom-update`                                                                |
| Ativação no app   | `~/.config/orca/custom-updater.json` com `command` e `appImage`                                  |
| Worktree de build | `~/.local/share/orca-custom-update/worktree` (branch `custom/main`)                              |
| Logs por execução | `~/.local/share/orca-custom-update/runs/<data>-<tag>/`                                           |
| Backups do perfil | `~/.local/share/orca-custom-update/backups/` (últimos 3)                                         |
| AppImage anterior | `~/Applications/Orca.AppImage.prev`                                                              |

## Fluxo de uma execução

1. `preflight`: worktree limpo, fetch do `upstream` e do `origin`, fast-forward de `custom/main`.
2. `backup-tag`: tag `custom/antes-<tag>-<data>` no commit atual.
3. `intersection`: arquivos que o custom altera e o upstream também mudou (`intersection.txt`, `upstream.diff`).
4. `merge`: `git merge --no-ff <tag>`. Conflito chama o Claude (`claude -p`) com o manifesto `custom/README.md`.
5. `verify`: `pnpm install`, `pnpm run typecheck`, testes do custom (`custom-tests.txt`). Falha chama o Claude uma vez.
6. `build`: `build:desktop` + `electron-builder --linux AppImage`.
7. `install`: tar do perfil, `Orca.AppImage.prev`, troca atômica do AppImage.
8. `push`: `custom/main` e a tag de backup para o fork (falha de rede não derruba a execução).

Cada execução grava `result.json`, `run.log`, os logs por etapa e, quando o Claude é chamado,
`claude/prompt-N.md`, `claude/transcript-N.jsonl` e `claude/changes-N.diff`.

## Uso manual

```bash
orca-custom-update --target v1.4.253            # atualização completa
orca-custom-update --target v1.4.253 --no-install --no-push   # só merge, verificação e build
orca-custom-update --reset                       # desfaz um merge pendente no worktree
orca-custom-update --setup                       # cria o worktree e instala dependências
```

## Quando falha

A mensagem no app aponta a pasta da execução. O worktree fica no estado da falha para resolver
na mão (abra o Claude Code lá e peça para ler o `result.json` da última execução). Para voltar
ao app anterior: renomeie `Orca.AppImage.prev` para `Orca.AppImage` e, se a versão nova migrou
o perfil, restaure o tar de `backups/` em `~/.config/orca/`.

## Desenvolvimento

Desenvolva em branches a partir de `custom/main` e mescle neles de volta; o script só atualiza
`custom/main`. Mantenha o custom pequeno e em arquivos próprios: cada arquivo do upstream que o
fork altera é uma frente de conflito nas próximas atualizações.
