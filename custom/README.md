# Customizações do fork

Este fork do Orca (stablyai/orca) acrescenta duas coisas ao oficial: cada chat ou terminal do Claude pode ser fixado numa conta do Claude específica (conta gerenciada ou System default), de modo que trocar a conta selecionada na barra de status não move esse chat; e cada repositório pode definir a conta padrão do Claude com que os novos chats daquele projeto começam. Tudo está no commit `df223fe9074` sobre a base `133bc99e5a3`. Diff de referência: `git diff 133bc99e5a3 df223fe9074`.

Vocabulário usado abaixo:

- `ClaudeAccountChoice`: `{ kind: 'system' }` ou `{ kind: 'managed', accountId }`. É o que o usuário escolhe.
- `ClaudeAccountPin`: o mesmo mais um `label` opcional (e-mail da conta), gravado no registro do chat em `accountHome.pin`.
- Pin: dizer que um chat ou terminal é "pinado" significa que ele sempre lança nessa conta, nunca na seleção atual.
- `ORCA_CLAUDE_ACCOUNT_PIN`: variável de ambiente que carrega o pin de um terminal (valor `system` ou o id da conta, nunca um caminho).

## Feature: conta do Claude fixada por chat e por terminal

- Intenção: no oficial, todo chat ou terminal do Claude segue a conta selecionada na barra de status; trocar a seleção move todas as conversas. No fork o usuário escolhe, ao lançar, em qual conta aquele chat ou terminal vai rodar, e ele fica nela para sempre, mesmo que a seleção mude ou o Orca reinicie.
- Comportamento esperado:
  - O menu de lançamento de agente mostra uma linha por conta do Claude (`Claude (email)`, com System default primeiro) quando o host tem contas gerenciadas e anuncia a capability `agentSession.create.claude-account.v1`; o painel de setup também ganha a linha "Account".
  - Um chat pinado grava `pin` em `accountHome` do registro e lança sempre na pasta daquela conta; a leitura de opções do chat devolve `claudeAccount` com `state: ready | needsSignIn | removed`, e o cabeçalho do chat mostra o rótulo com o e-mail e o estado.
  - Se a conta pinada foi removida do Orca, o lançamento falha com o motivo `claudeAccountRemoved` em vez de cair em outra conta.
  - Um chat pinado numa conta gerenciada não herda `CLAUDE_CODE_OAUTH_TOKEN` nem `ANTHROPIC_API_KEY` do ambiente (`stripAuthEnv`), para que o login da pasta da conta prevaleça; um pin em System default herda tudo como antes.
  - Um terminal pinado recebe `ORCA_CLAUDE_ACCOUNT_PIN` no `agentEnv` da config de lançamento (sobrevive a restart) e o host troca essa variável por um ponteiro próprio em `<dir do pointerPath>/pinned/<id>`; o ponteiro de conta removida tem o conteúdo `orca-claude-account-removed` (não absoluto) para a função `claude` do pane recusar o lançamento.
  - Chats e panes pinados são ignorados pela rotina que move sessões quando a seleção de conta muda, e pelo cache de catálogo de comandos (`AtRestCommandCatalog`) que usa a seleção como chave.
- Arquivos novos (só do fork):
  - `src/shared/claude-account-choice.ts`: tipos `ClaudeAccountChoice`, `ClaudeAccountPin`, `AgentSessionClaudeAccount`, schema zod `ClaudeAccountChoiceSchema`, guardas `isClaudeAccountPin`, `claudeAccountChoiceOf`, `sameClaudeAccountChoice`.
  - `src/shared/claude-account-pin-env.ts`: constante `CLAUDE_ACCOUNT_PIN_ENV` (`ORCA_CLAUDE_ACCOUNT_PIN`) e conversão de ida e volta `claudeAccountPinEnvValue` / `claudeAccountChoiceFromPinEnv`.
  - `src/shared/rpc-contract/structured-agent-session-create-choice-params.ts`: `CREATE_CHOICE_FIELDS` (`options`, `optionsMode`, `claudeAccount`) usados no schema de `agentSession.create`.
  - `src/main/claude-accounts/claude-chat-account-pin.ts`: `resolveClaudeChatAccountPin`, decide o pin de um chat novo (explícito > padrão do repositório > seleção atual) e lança `claudeAccountRemoved` se a conta explícita não existe.
  - `src/main/claude-accounts/claude-chat-account-view.ts`: `readClaudeChatAccount`, lê o pin de um registro e devolve `AgentSessionClaudeAccount` com estado de login (`ready`, `needsSignIn`, `removed`); `undefined` para chats sem pin.
  - `src/main/claude-accounts/claude-pinned-terminal-env.ts`: `claudePinnedTerminalEnv`, escreve o ponteiro próprio do terminal pinado (gravação atômica via rename) e devolve o env patch do terminal com `ORCA_CLAUDE_PROFILE_POINTER` apontando para ele.
  - `src/main/claude-accounts/claude-chat-account-pin.test.ts`: testes de toda a feature no main (ver "Como validar").
  - `src/renderer/src/components/agent/launch-settings/use-claude-launch-accounts.ts`: hook `useClaudeLaunchAccounts(worktreeId)` que lista as contas do host (System default primeiro, sem contas WSL), calcula `inherited` (padrão do repo, senão seleção, senão system) e só devolve algo quando o host suporta a capability; helpers `claudeLaunchAccountValue`, `claudeLaunchAccountChoice`, `claudeLaunchAccountName`.
  - `src/renderer/src/components/agent/launch-settings/ClaudeLaunchAccountRow.tsx`: linha "Account" do painel de setup, um `AgentChoiceMenu` sobre as opções do hook.
  - `src/renderer/src/components/agent/AgentLaunchSetupAccessRows.tsx`: extrai do `AgentLaunchSetupPanel` o menu de permissão (código movido do upstream, sem mudança) e acrescenta a `ClaudeLaunchAccountRow` para `entry.agent === 'claude'`.
  - `src/renderer/src/components/native-chat/NativeChatClaudeAccountLabel.tsx`: rótulo no cabeçalho do chat (`data-testid="native-chat-claude-account"`) com e-mail, estado e tooltip; clicar abre Settings > Accounts na seção `accounts-claude`.
  - `src/renderer/src/lib/agent-session/launch/new-tab/launch-agent-new-tab-host-route.ts` (função nova `launchNewTabArgsPromptThroughHost`, o arquivo já existia): monta a chamada `launchNewTabPromptThroughHost` a partir de `LaunchAgentInNewTabArgs`, repassando `claudeAccount`.
- Pontos de encaixe no upstream:
  - shared
    - `src/shared/agent-session/lifecycle/agent-session-account-home.ts`: `LegacyAgentSessionAccountHome` ganha `pin?: ClaudeAccountPin`; `agentSessionAccountHomesEqual` compara o pin; `isAgentSessionAccountHome` valida o pin; nova função `agentSessionClaudeAccountPin(home)`.
    - `src/shared/agent-session/structured-agent-session-create.ts`: `StructuredAgentSessionCreateParams` e `structuredAgentSessionCreateParams` ganham `claudeAccount`.
    - `src/shared/agent-session/lifecycle/structured-agent-session-mutation.ts`: `structuredAgentSessionCreateFingerprint` inclui `claudeAccount` no payload fingerprintado.
    - `src/shared/agent-session/agent-session-create-capabilities.ts`: nova capability `AGENT_SESSION_CREATE_CLAUDE_ACCOUNT_RUNTIME_CAPABILITY = 'agentSession.create.claude-account.v1'`, incluída em `AGENT_SESSION_CREATE_RUNTIME_CAPABILITIES`.
    - `src/shared/agent-session/options/agent-session-options-result.ts`: `AgentSessionOptionsResult.claudeAccount?: AgentSessionClaudeAccount`.
    - `src/shared/agent-session/failures/agent-session-failure.ts`, `agent-session-failure-copy.ts`, `agent-session-failure-words.ts`, `agent-session-refusal-details.ts`, `agent-session-refusal-reason-words.ts`, `requests/structured-agent-session-dispatch-rejection.ts`: novo kind `claudeAccountRemoved` (categoria `startFailed`, veredito `failure`, ação `actFirst`, texto `CLAUDE_ACCOUNT_REMOVED_MESSAGE`). Em `agent-session-failure-words.ts` o `FAILURE_SENTENCES` passou de `satisfies` para anotação de tipo explícita.
    - `src/shared/claude-profile-routing.ts`: constante `CLAUDE_ACCOUNT_REMOVED_MESSAGE`.
    - `src/shared/rpc-contract/structured-agent-session-params.ts`: `CreateIntentParams` usa `...CREATE_CHOICE_FIELDS` no lugar de `options`/`optionsMode` inline.
    - `src/shared/agent-launch/choices/agent-launch-choices.ts`: `AgentLaunchInputViews.claudeAccount`.
    - `src/shared/agent-launch/picker/agent-launch-picker.ts`: `AgentPickerDraft.claudeAccount`; `agentPickerLaunchInputs` copia `draft.claudeAccount` para as views só quando `draft.agent === 'claude'`.
    - `src/shared/agent-launch/startup/agent-launch-account-env.ts`: `AGENT_LAUNCH_ACCOUNT_ENV_KEYS` inclui `CLAUDE_ACCOUNT_PIN_ENV`; `isAccountPath` aceita essa chave só como identidade válida (`claudeAccountChoiceFromPinEnv !== null`), nunca como caminho.
    - `src/shared/agent-launch/startup/agent-startup-plan-inputs.ts`: `resolveAgentStartupPlanInputs` aceita `claudeAccount` e, para `agent === 'claude'`, põe `ORCA_CLAUDE_ACCOUNT_PIN` em `agentEnv`.
  - main
    - `src/main/claude-accounts/claude-profile-router.ts`: novo método público `profileFor(choice?)` (lança `claudeAccountRemoved` se a conta gerenciada não está salva); `routedProfile`, `routedHome`, `prepareLaunch`, `launchEnv` e `preparation` aceitam `choice?`; `launchEnv` omite `ORCA_CLAUDE_PROFILE_POINTER` quando há `choice`.
    - `src/main/claude-accounts/claude-profile-routed-home.ts`: `claudeRoutedHomeAsync` recebe `choice?` e usa `router.profileFor(choice)` no lugar de `selectedProfile()`.
    - `src/main/claude-accounts/claude-profile-installed-router.ts`: `withClaudeProfileTerminalEnv` lê `ORCA_CLAUDE_ACCOUNT_PIN` do env (fora de WSL) e, se houver pin, usa `claudePinnedTerminalEnv` em vez de `terminalEnv(target)`.
    - `src/main/claude-accounts/claude-profile-launch-errors.ts`: nova fábrica `claudeAccountRemoved()`.
    - `src/main/claude/claude-launch-account.ts`: `prepareClaudeLaunchAccount` ganha `choice?`, repassa a `router.prepareLaunch(choice)` e a `resolveStructuredClaudeAccountHomePath`, e aplica `stripAuthEnv` quando `choice.kind === 'managed'` e a rota não é `system`.
    - `src/main/claude/structured/launch/claude-structured-launch-home.ts`: `resolveClaudeStructuredLaunchHome` passa a receber o `LegacyAgentSessionAccountHome` inteiro (antes era só o `path`) e deriva `choice` de `recordHome.pin`.
    - `src/main/claude/structured/launch/claude-structured-launch-resolution.ts`: `claudeStructuredLaunchPart` passa `claudeAccountChoiceOf(accountHome.pin)` a `prepareClaudeLaunchAccount`.
    - `src/main/native-chat/agent-session-wire/options/at-rest-command-catalog.ts`: `key()` mantém `record.accountHome` na chave quando há pin; a resolução de `accountHome` usa o do registro quando há pin em vez de `resolveAccountHome()`.
    - `src/main/native-chat/agent-session-wire/options/structured-agent-session-options-read.ts`: `readStructuredAgentSessionOptions` acrescenta `claudeAccount` via `readClaudeChatAccount(record, getClaudeProfileRouter())`.
    - `src/main/native-chat/agent-session-wire/providers/structured-agent-session-adapter-errors.ts` e `startup/structured-agent-session-failure-text.ts`: `claudeAccountRemoved` entra em `AgentSessionPreSpawnReason` e em `TYPED_START_REFUSALS`.
    - `src/main/runtime/agent-session/environment/structured-agent-account-home.ts`: `StructuredClaudeAccountHomeDeps.choice?`; repassado a `claudeRoutedHomeAsync`.
    - `src/main/runtime/agent-session/installation/structured-agent-runtime-metadata.ts`: na entrada do Claude, `launchFollowsSelection(accountHome)` devolve false para registro com pin; `resolveAccountHome` recebe `claudeAccount` e devolve `{ ...home, pin: claudeAccount }`.
    - `src/main/runtime/agent-session/installation/structured-agent-runtime-registration-types.ts`: `StructuredAgentAccountHomeRequest.claudeAccount?: ClaudeAccountPin`; `launchFollowsSelection` passa a receber `accountHome`.
    - `src/main/runtime/agent-session/lifecycle/structured-session-recovery-options.ts`: chamada `launchFollowsSelection?.(record.accountHome)`.
    - `src/main/runtime/agent-session/naming/structured-chat-naming-agent-launch.ts`: `chatNamingAgentTarget` passa `home` inteiro a `resolveClaudeStructuredLaunchHome`.
    - `src/main/runtime/agent-session/structured-agent-session-create-adoption.ts`: `StructuredAgentSessionCreateIntentInput.claudeAccount?`.
    - `src/main/runtime/rpc/methods/structured-sessions/creation/structured-agent-session-create-handler.ts`: repassa `params.claudeAccount` ao prepare.
    - `src/main/runtime/rpc/methods/structured-sessions/creation/structured-agent-session-create.ts`: `structuredAgentSessionCreateIntentFingerprint` tipado a partir de `StructuredAgentSessionCreateParams` e inclui `claudeAccount`; `prepareStructuredAgentSessionCreateForWorktree` aceita e repassa `claudeAccount`.
    - `src/main/runtime/session-tabs/structured-session-account-home.ts`: o resolver devolvido por `structuredAgentAccountHomeResolver` aceita um terceiro argumento `claudeAccount?: ClaudeAccountPin`; `launchFollowsSelection` recebe `record.accountHome`.
    - `src/main/runtime/session-tabs/structured-session-create-support.ts`: o callback `resolveAccountHome` ganha o terceiro parâmetro e a chamada passa `await this.structuredClaudeAccountPinForCreate(input, location, settings)`.
    - `src/main/runtime/session-tabs/structured-session-workspace-scope.ts`: novo método protegido `structuredClaudeAccountPinForCreate` (só para `agent === 'claude'`, sem `resumeFrom`, sem WSL e com router instalado) que lê `repo.claudeAccountId` via `resolveWorktreeHostRouting` e chama `resolveClaudeChatAccountPin`.
    - `src/main/runtime/terminal/launch/runtime-agent-terminal-startup.ts`: `buildRuntimeAgentTerminalStartupOptions` acrescenta `claudeAccount` lido de `opts.accountEnv[ORCA_CLAUDE_ACCOUNT_PIN]` (helper `claudeAccountStartupInput`).
  - renderer
    - `src/renderer/src/components/agent/AgentLaunchPickerMenu.tsx`: usa `useClaudeLaunchAccounts`; o `visible.map` virou `flatMap` que gera uma `AgentPickerMenuRow` por conta para o Claude (rótulo `Claude (nome)`, `claudeAccount={option.choice}`), com `selected`, `isDefault` e `shortcut` só na primeira linha.
    - `src/renderer/src/components/agent/AgentLaunchPickerMenuRow.tsx`: prop `claudeAccount?`; monta `launchDraft` com a conta e o usa como `seed` do setup e como draft do clique.
    - `src/renderer/src/components/agent/AgentLaunchSetupPanel.tsx`: o bloco do `AgentPermissionMenu` foi substituído por `<AgentLaunchSetupAccessRows ... />`.
    - `src/renderer/src/components/native-chat/NativeChatPaneHeader.tsx`: prop `claudeAccount?` em `NativeChatPaneHeader` e parâmetro extra em `nativeChatPaneHeader`; renderiza `NativeChatClaudeAccountLabel` antes das ações.
    - `src/renderer/src/components/native-chat/NativeChatStructuredSession.tsx`: passa `controller.claudeAccount` a `nativeChatPaneHeader`.
    - `src/renderer/src/components/native-chat/agent-session-failure-words-text.ts`: peça `claudeAccountRemoved` traduzida.
    - `src/renderer/src/components/native-chat/host-access/native-chat-sign-in.ts`: `useManagedClaudeSignIn` e `useNativeChatSignIn` aceitam `claudeAccount`; chat pinado só oferece sign-in para a própria conta gerenciada (nunca para `system` ou `removed`).
    - `src/renderer/src/components/native-chat/messages/notices/use-native-chat-structured-pane-notices.ts`: repassa `controller.claudeAccount` a `useNativeChatSignIn`.
    - `src/renderer/src/components/native-chat/session/options/structured/use-structured-agent-session-option-state.ts`: copia `result.claudeAccount` para o support e para `sessionSupport`.
    - `src/renderer/src/hooks/composer-state/quick-startup-plan.ts`: `buildQuickComposerStartup` repassa `launchInputs.claudeAccount` a `resolveAgentStartupPlanInputs`.
    - `src/renderer/src/lib/agent-session/launch/new-tab/launch-agent-in-new-tab-args.ts`: `LaunchAgentInNewTabArgs.claudeAccount?`.
    - `src/renderer/src/lib/agent-session/launch/new-tab/launch-agent-in-new-tab.ts`: `openAgentInNewTab` repassa `claudeAccount` para o plano estruturado, `resolveAgentStartupPlanInputs`, `launchAgentInWebHostTab` e, no caminho de paste pelo host, usa `launchNewTabArgsPromptThroughHost(args, ...)` em vez de montar os argumentos inline.
    - `src/renderer/src/lib/agent-session/launch/new-tab/launch-agent-web-host-tab.ts`: `launchAgentInWebHostTab` aceita `claudeAccount` e repassa ao startup plan.
    - `src/renderer/src/lib/agent-session/launch/pane/agent-launch-through-host.ts`: `HostAgentLaunchArgs.claudeAccount?`; `launchParams` envia `accountEnv: { ORCA_CLAUDE_ACCOUNT_PIN }` para `agent === 'claude'`.
    - `src/renderer/src/lib/agent-session/launch/routing/agent-session-launch-plan.ts`: `AgentSessionLaunchRequest` e `AgentSessionLaunchVerdict` carregam `claudeAccount`; `structuredLaunchOptions` e `planAgentSessionLaunch` repassam.
    - `src/renderer/src/lib/agent-session/launch/structured-agent-session-launch-callers.ts`: `StructuredAgentLaunchOptions.claudeAccount?`.
    - `src/renderer/src/lib/agent-session/launch/structured-agent-session-launch.ts`: `structuredAgentLaunchState` copia `options.claudeAccount` para o intent só sem `forkFrom` e sem `resumeFrom`.
    - `src/renderer/src/lib/agent-session/launch/structured-agent-session-launch-create-call.ts`: nova função `applyStructuredLaunchClaudeAccount(intent)` chamada logo após `requireHostPermission`; só envia `claudeAccount` se o host suporta a capability, e recalcula `payloadFingerprint` com `structuredAgentSessionCreateFingerprint`.
    - `src/renderer/src/lib/agent-session/launch/structured-agent-session-launch-record.ts`: `StructuredAgentLaunchPersistedRecord.claudeAccount?`; gravado em `structuredAgentLaunchRecordFor` e validado em `validRecord` com `ClaudeAccountChoiceSchema`.
    - `src/renderer/src/lib/agent-session/launch/structured-agent-session-launch-reload.ts`: `restorePersistedStructuredLaunchState` repassa `record.claudeAccount`.
    - `src/renderer/src/lib/launch-structured-agent-session.ts`: `StructuredAgentSessionLaunchIntent.claudeAccount?`; `retryStructuredAgentSessionLaunchIntent` e `restoreStructuredAgentSessionLaunchIntent` preservam.
    - `src/renderer/src/lib/workspace/creation/worktree-creation-structured-session.ts`: `launchStructuredWorktreeSession` repassa `launchInputs.claudeAccount`.
    - `src/renderer/src/lib/claude-session-account-move.ts`: `localClaudePanes` pula panes cuja config de lançamento tem `agentEnv[ORCA_CLAUDE_ACCOUNT_PIN]`.
  - i18n (`src/renderer/src/i18n`)
    - `en-runtime-required.json`: `components.native-chat.failureWords.claudeAccountRemoved`.
    - `locales/en.json` e `locales/pt.json`: `components.native-chat.failureWords.claudeAccountRemoved`; `nativeChat.claudeAccount.{removed,needsSignIn,systemTooltip,managedTooltip,fixTooltip}`; `agentPicker.claudeAccount.{label,systemDefaultWithEmail}`.
    - `locales/de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `ru.json`, `tr.json`, `zh-Hant.json`, `zh.json`: só `components.native-chat.failureWords.claudeAccountRemoved` (texto em inglês).
- Invariantes:
  - Um chat com `accountHome.pin` lança sempre na conta do pin; a seleção da barra de status nunca o move (`launchFollowsSelection` devolve false, `claude-session-account-move` o ignora, `AtRestCommandCatalog` usa o `accountHome` do registro).
  - Conta pinada removida nunca cai em outra conta: `profileFor` lança `claudeAccountRemoved`, e o terminal recebe ponteiro não absoluto `orca-claude-account-removed`.
  - Ordem de precedência de um chat novo: escolha explícita > `repo.claudeAccountId` > seleção atual do host > System default. Padrão do repositório que aponta para conta inexistente é ignorado silenciosamente; escolha explícita inexistente é erro.
  - Pin em conta gerenciada remove `CLAUDE_CODE_OAUTH_TOKEN` e `ANTHROPIC_API_KEY` herdados do env do lançamento; pin em `system` e chat sem pin herdam como no upstream.
  - Um lançamento pinado não recebe `ORCA_CLAUDE_PROFILE_POINTER` do roteador (`launchEnv(choice)`); o terminal pinado recebe um ponteiro próprio em `pinned/<id>`.
  - `claudeAccount` só é enviado em `agentSession.create` para hosts que anunciam `agentSession.create.claude-account.v1`; o schema do create é `strict`, então enviar a hosts antigos quebraria. Quando é enviado, entra no `payloadFingerprint` (renderer e main calculam igual).
  - `claudeAccount` nunca acompanha fork nem resume (adoção mantém a conta do transcript original).
  - `ORCA_CLAUDE_ACCOUNT_PIN` carrega apenas identidade (`system` ou id `^[a-zA-Z0-9_-]{1,512}$`), nunca um caminho; `isAccountPath` recusa qualquer outra coisa. `accountId` com caracteres fora desse padrão é rejeitado no schema, no `isClaudeAccountPin` e no `validRecord`.
  - Registros antigos sem `pin` continuam válidos e seguem a seleção (`isAgentSessionAccountHome` aceita `pin` ausente).
  - A UI de escolha de conta (linhas do picker, linha "Account" do setup) só aparece quando o host tem contas gerenciadas não WSL e suporta a capability; chats em WSL nunca pinam.
- Como validar:
  - Testes do fork: `src/main/claude-accounts/claude-chat-account-pin.test.ts` (novo) e `src/main/claude-accounts/claude-launch-routing.test.ts` (alterado para a nova assinatura de `resolveClaudeStructuredLaunchHome`). Rode `pnpm test -- src/main/claude-accounts/claude-chat-account-pin.test.ts src/main/claude-accounts/claude-launch-routing.test.ts` e `pnpm typecheck`.
  - Roteiro manual:
    1. Com duas contas do Claude salvas em Settings > Accounts, abra o menu de lançamento de agente e confira uma linha `Claude (email)` por conta, mais `Claude (System default)`.
    2. Lance um chat pela linha da conta B enquanto a barra de status seleciona a conta A; o cabeçalho do chat deve mostrar o e-mail de B.
    3. Troque a seleção da barra de status para A ou C e envie uma mensagem no chat: ele continua em B. Reinicie o Orca e confira que o rótulo e a conta se mantêm.
    4. Remova a conta B em Settings: o rótulo muda para "Removed from Orca" e um novo envio falha com a mensagem de conta removida, sem usar outra conta.
    5. Lance um terminal do Claude pela linha da conta B e troque a seleção: o terminal não é movido (o pane continua com `ORCA_CLAUDE_ACCOUNT_PIN` e o ponteiro em `pinned/<id>`).

## Feature: conta padrão do Claude por repositório

- Intenção: o usuário define, em Settings > Repository, a conta do Claude em que os novos chats daquele projeto começam, sem precisar escolher a conta a cada lançamento. O oficial só tem a seleção global.
- Comportamento esperado:
  - `Repo.claudeAccountId` guarda `system`, um id de conta salva, ou vazio/ausente (segue a seleção). A seção "Claude Account" no painel do repositório oferece "Use the selected account", "System default (email)" e cada conta do host; só aparece se o host tem contas ou se o repo já tem valor.
  - Um chat novo do Claude nesse repo, lançado sem escolha explícita, pina o padrão do repo (ver `resolveClaudeChatAccountPin`). O picker mostra como `inherited` a mesma conta que o host usaria.
  - Chats existentes não mudam quando o padrão do repo muda.
  - Se a conta do padrão foi removida, a seção mostra "Removed account" desabilitado com a dica de que novos chats usam a seleção; o host ignora o valor e cai na seleção.
- Arquivos novos (só do fork):
  - `src/renderer/src/components/settings/repository/RepositoryClaudeAccountSection.tsx`: a seção com o `Select` (valor sentinela `__inherit_claude_account__` vira string vazia ao salvar).
  - `src/renderer/src/components/settings/repository/RepositoryAccountSections.tsx`: envoltório que renderiza `RepositoryGitHubAccountSection` e `RepositoryClaudeAccountSection` com as mesmas props.
- Pontos de encaixe no upstream:
  - shared
    - `src/shared/repo-types.ts`: `Repo.claudeAccountId?: string`; constantes `CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID = 'system'` e `CLAUDE_ACCOUNT_DEFAULT_PATTERN = /^(|[a-zA-Z0-9_-]{1,512})$/`.
    - `src/shared/rpc-contract/repo-update-params.ts`: `createRepoUpdateSchema` aceita `claudeAccountId` validado pelo padrão.
  - main
    - `src/main/ipc/repos/repo-update-handler.ts`, `src/main/persistence/loading-store/repo-lifecycle-operations.ts`, `src/main/persistence/tracking-repos/repo-update-operations.ts`: `claudeAccountId` entra na lista `Pick<Repo, ...>` de campos atualizáveis.
    - `src/main/persistence/tracking-repos/repo-sanitization.ts`: `sanitizeRepoUpdatesForPersistence` aceita `claudeAccountId` e apaga o campo se não for string ou não casar com `CLAUDE_ACCOUNT_DEFAULT_PATTERN`.
    - `src/main/runtime/session-tabs/structured-session-workspace-scope.ts`: `structuredClaudeAccountPinForCreate` lê `routing.repo?.claudeAccountId` (já listado na feature anterior).
  - preload
    - `src/preload/api/repository-api.ts`: `claudeAccountId` no `Pick` de `updateRepo`.
  - renderer
    - `src/renderer/src/store/repos/repo-state.ts`: `RepoUpdate` inclui `claudeAccountId`.
    - `src/renderer/src/components/settings/repository/RepositoryPane.tsx`: `RepositoryGitHubAccountSection` substituído por `RepositoryAccountSections` (import e uso).
    - `src/renderer/src/components/agent/launch-settings/use-claude-launch-accounts.ts`: lê `repo.claudeAccountId` para calcular `inherited` (arquivo novo, listado na feature anterior).
  - i18n (`src/renderer/src/i18n`)
    - `locales/en.json` e `locales/pt.json`: `repository.claudeAccount.{title,description,longDescription,selectLabel,inherit,removed,removedHint}`.
- Invariantes:
  - Valor persistido só pode ser vazio, `system` ou id no padrão `^[a-zA-Z0-9_-]{1,512}$`; qualquer outra coisa é descartada na sanitização e recusada no schema do RPC.
  - String vazia significa "seguir a seleção"; o `Select` nunca salva o sentinela `__inherit_claude_account__`.
  - O padrão do repositório só vale para chats novos sem escolha explícita; nunca altera chats existentes nem vence uma escolha explícita no picker.
  - Padrão apontando para conta removida é ignorado no host (cai na seleção) e sinalizado na UI, nunca erro.
  - `inherited` no renderer segue a mesma ordem do host: `system` > id salvo do repo > seleção ativa do host (`activeAccountIdsByRuntime.host ?? activeAccountId`) > `system`.
- Como validar:
  - Não há teste dedicado; a resolução `workspaceDefault` é coberta em `src/main/claude-accounts/claude-chat-account-pin.test.ts` ("the account a new chat pins"). Rode esse arquivo e `pnpm typecheck`.
  - Roteiro manual:
    1. Em Settings > Repository de um projeto, confira a seção "Claude Account" abaixo de GitHub Account e escolha a conta B.
    2. Com a seleção da barra de status em A, lance um chat do Claude nesse projeto pelo atalho padrão (sem escolher conta): o cabeçalho mostra B.
    3. Abra o menu de lançamento: a linha de B aparece como a selecionada/herdada para esse projeto.
    4. Remova a conta B: a seção mostra "Removed account" e a dica; um chat novo abre na conta selecionada (A).
    5. Volte a seção para "Use the selected account" e confira que o chat criado no passo 2 continua em B.

## Feature: atualização do fork pelo updater do app

- Intenção: o app instalado continua avisando sobre releases oficiais, mas "atualizar" roda o script `custom/update/orca-custom-update.mjs` (merge do upstream em `custom/main`, verificação, build e instalação do AppImage) em vez de baixar o AppImage oficial. Detalhes em `custom/update/README.md`.
- Arquivos novos (só do fork):
  - `src/main/updater/custom/custom-updater.ts`: lê `<userData>/custom-updater.json` (`readCustomUpdaterConfig`), roda o script com progresso (`runCustomUpdate`), guarda a versão instalada à espera de reinício (`get/setCustomUpdateInstalledVersion`) e relança o AppImage depois que o processo atual sair (`relaunchCustomAppImage`).
  - `src/main/updater/custom/custom-updater.test.ts`: parsing da config e das linhas de progresso.
  - `custom/update/orca-custom-update.mjs`, `shared.mjs`, `claude-step.mjs` e `custom/update/README.md`: o script e sua documentação.
- Pontos de encaixe no upstream:
  - `src/main/updater/lifecycle/updater-download-install.ts`, `downloadUpdate()`: logo antes de `this.downloadInFlight = true`, se `activeUpdateSource === 'release'` e existe config custom, chama `startCustomUpdate(config, version)` (método privado do fork na mesma classe) e retorna. O método publica `downloading` com o progresso do script, depois `downloaded`.
  - `src/main/updater/lifecycle/updater-install-execution.ts`, `performQuitAndInstall()`: após as checagens de pacote Linux e WSL e antes de `finishActiveUpdateCheckAttempt()`, se `getCustomUpdateInstalledVersion()` está definido, chama `performCustomQuitAndInstall(version)` (método privado do fork) e retorna. Esse método faz o pre-quit cleanup oficial (`runBeforeUpdateQuitCleanup`, `releaseSessionsForInstaller`, `commitInFlightInstall`), agenda o relançamento e chama `app.quit()`.
- Invariantes:
  - Sem `custom-updater.json`, ou fora do Linux empacotado, o updater oficial roda sem nenhuma diferença.
  - A verificação de atualização nunca é alterada: a versão "disponível" continua vindo do feed oficial, e a versão do app após o merge é a do `package.json` do upstream.
  - O relançamento só acontece depois que o processo atual terminou (loop `kill -0` no shell), para não disputar o lock de instância única.
- Como validar: `src/main/updater/custom/custom-updater.test.ts`; manual: com o arquivo de config presente, "Download update" deve mostrar a barra de progresso do script e "Restart" deve reabrir o app na versão nova.

## Regras para o merge

- Nos pontos de encaixe listados, preferir o código do fork; ao aceitar uma refatoração do upstream (função movida, assinatura trocada, arquivo dividido), re-aplicar a mudança do fork no novo lugar em vez de descartá-la.
- Se o upstream mudar a assinatura de `prepareClaudeLaunchAccount`, `resolveClaudeStructuredLaunchHome`, `claudeRoutedHomeAsync`, `ClaudeProfileRouter.{profileFor,routedHome,prepareLaunch,launchEnv,preparation}`, `resolveAccountHome`, `launchFollowsSelection` ou `structuredAgentSessionCreateIntentFingerprint`, manter o parâmetro `choice`/`claudeAccount` do fork na nova assinatura e conferir todos os chamadores (`grep -rn "claudeAccount\|ClaudeAccountChoice\|ClaudeAccountPin\|CLAUDE_ACCOUNT_PIN_ENV" src`).
- Se o upstream criar algo equivalente (conta por chat ou por repo), avaliar substituir a implementação do fork pela oficial; até lá, manter as duas separadas e não misturar nomes.
- Nunca remover chaves de i18n do fork (`claudeAccountRemoved`, `nativeChat.claudeAccount.*`, `agentPicker.claudeAccount.*`, `repository.claudeAccount.*`). Se o upstream regenerar os `locales/*.json`, re-inserir as chaves em `en.json`, `pt.json`, `en-runtime-required.json` e o `claudeAccountRemoved` nos demais idiomas.
- Listas de kinds (`AGENT_SESSION_FAILURE_KINDS`, `AGENT_SESSION_REFUSAL_REASONS`, `KIND_CATEGORY`, `KIND_VERDICT`, `REASON_WORDS`, `FAILURE_SENTENCES`, `TYPED_START_REFUSALS`, `AgentSessionPreSpawnReason`) e listas `Pick<Repo, ...>` de campos atualizáveis: garantir que `claudeAccountRemoved` e `claudeAccountId` sobrevivam a qualquer reordenação do upstream; o typecheck acusa a maioria das faltas.
- Ao final, rodar `pnpm typecheck` e os testes `src/main/claude-accounts/claude-chat-account-pin.test.ts` e `src/main/claude-accounts/claude-launch-routing.test.ts`, depois o roteiro manual das duas features.
