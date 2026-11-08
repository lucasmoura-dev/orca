import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaudeManagedAccount } from '../../shared/managed-account-types'
import { isAgentSessionAccountHome } from '../../shared/agent-session/lifecycle/agent-session-account-home'
import {
  decodePersistedAgentSessionRecord,
  encodeAgentSessionRecord
} from '../../shared/agent-session/lifecycle/agent-session-record-stored-form'
import { agentSessionRecordFixture } from '../native-chat/agent-session-record-test-fixture'
import { isReadableAgentSessionStoreRecord } from '../runtime/agent-session/records/agent-session-store-row-rules'
import { CreateIntentParams } from '../../shared/rpc-contract/structured-agent-session-params'
import { resolveClaudeStructuredLaunchHome } from '../claude/structured/launch/claude-structured-launch-home'
import { prepareClaudeLaunchAccount } from '../claude/claude-launch-account'
import { AgentSessionPreSpawnError } from '../native-chat/agent-session-wire/providers/structured-agent-session-adapter-errors'
import { readClaudeChatAccount } from './claude-chat-account-view'
import { resolveClaudeChatAccountPin } from './claude-chat-account-pin'
import {
  installClaudeProfileRouter,
  withClaudeProfileTerminalEnv
} from './claude-profile-installed-router'
import { readFileSync } from 'node:fs'
import { resolveAgentStartupPlanInputs } from '../../shared/agent-launch/startup/agent-startup-plan-inputs'
import { AgentLaunchAccountEnv } from '../../shared/agent-launch/startup/agent-launch-account-env'
import { ClaudeProfileRouter, type ClaudeProfileRouterSettings } from './claude-profile-router'

const roots: string[] = []
afterEach(() => {
  installClaudeProfileRouter(undefined)
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

function account(id: string, email: string): ClaudeManagedAccount {
  return {
    id,
    email,
    authMethod: 'subscription-oauth',
    managedAuthPath: '/unused-legacy',
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  }
}

function signIn(stateDir: string, email: string): void {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(
    join(stateDir, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: email } })
  )
}

/** Two saved accounts, each signed in to its own folder, beside a personal System default. */
function twoAccounts() {
  const root = mkdtempSync(join(tmpdir(), 'claude-chat-account-pin-'))
  roots.push(root)
  const userHome = join(root, 'personal')
  const settings: ClaudeProfileRouterSettings = {
    claudeManagedAccounts: [
      account('work', 'work@example.test'),
      account('dev', 'dev@example.test')
    ],
    activeClaudeManagedAccountId: 'work',
    activeClaudeManagedAccountIdsByRuntime: undefined,
    agentStatusHooksEnabled: false,
    disabledTuiAgents: []
  }
  const router = new ClaudeProfileRouter({
    getSettings: () => settings,
    dataRoot: join(root, 'data'),
    userHome,
    env: {},
    runSetup: async () => ({ outcome: 'prepared', warnings: [], surfaces: {} })
  })
  for (const [id, email] of [
    ['work', 'work@example.test'],
    ['dev', 'dev@example.test']
  ] as const) {
    const home = router.accountHome(id)
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, '..', 'profile.json'), '{}')
    signIn(home, email)
  }
  signIn(userHome, 'personal@example.test')
  installClaudeProfileRouter(router)
  return { router, settings, systemHome: join(userHome, '.claude') }
}

const pinned = (pin: { kind: 'system' } | { kind: 'managed'; accountId: string }) => ({
  variable: 'CLAUDE_CONFIG_DIR',
  path: '/recorded',
  pin
})

describe('a chat pinned to a Claude account', () => {
  it('launches on its own account while the selection points elsewhere', async () => {
    const f = twoAccounts()
    const dev = await resolveClaudeStructuredLaunchHome(
      f.router,
      {},
      pinned({ kind: 'managed', accountId: 'dev' })
    )
    const system = await resolveClaudeStructuredLaunchHome(f.router, {}, pinned({ kind: 'system' }))
    const following = await resolveClaudeStructuredLaunchHome(
      f.router,
      {},
      {
        variable: 'CLAUDE_CONFIG_DIR',
        path: '/recorded'
      }
    )
    expect(dev).toBe(f.router.accountHome('dev'))
    expect(system).toBe(f.systemHome)
    expect(following).toBe(f.router.accountHome('work'))

    f.settings.activeClaudeManagedAccountId = 'dev'
    expect(await resolveClaudeStructuredLaunchHome(f.router, {}, pinned({ kind: 'system' }))).toBe(
      f.systemHome
    )
    expect(
      await resolveClaudeStructuredLaunchHome(
        f.router,
        {},
        pinned({ kind: 'managed', accountId: 'work' })
      )
    ).toBe(f.router.accountHome('work'))
  })

  it("drops an inherited token only for a managed pin, so the account's own login runs", async () => {
    const f = twoAccounts()
    const inherited = () => ({
      PATH: '/usr/bin',
      CLAUDE_CODE_OAUTH_TOKEN: 'inherited-token',
      ANTHROPIC_API_KEY: 'inherited-key',
      ANTHROPIC_BASE_URL: 'https://proxy.example.test'
    })
    const managed: Record<string, string> = inherited()
    const recipe = await prepareClaudeLaunchAccount(f.router, managed, '/recorded', {
      kind: 'managed',
      accountId: 'dev'
    })
    expect(recipe).toEqual({
      route: 'managed',
      accountId: 'dev',
      home: f.router.accountHome('dev')
    })
    expect(managed).toEqual({
      PATH: '/usr/bin',
      ANTHROPIC_BASE_URL: 'https://proxy.example.test',
      CLAUDE_CONFIG_DIR: f.router.accountHome('dev'),
      ORCA_CLAUDE_INJECTED_CONFIG_DIR: f.router.accountHome('dev')
    })
    const system: Record<string, string> = inherited()
    await prepareClaudeLaunchAccount(f.router, system, '/recorded', { kind: 'system' })
    expect(system).toEqual(inherited())
    const following: Record<string, string> = inherited()
    await prepareClaudeLaunchAccount(f.router, following, '/recorded')
    expect(following).toMatchObject({
      CLAUDE_CODE_OAUTH_TOKEN: 'inherited-token',
      ANTHROPIC_API_KEY: 'inherited-key'
    })
  })

  it('refuses to start when its account was removed instead of using another one', async () => {
    const f = twoAccounts()
    f.settings.claudeManagedAccounts = f.settings.claudeManagedAccounts.filter(
      (saved) => saved.id !== 'dev'
    )
    const launch = resolveClaudeStructuredLaunchHome(
      f.router,
      {},
      pinned({ kind: 'managed', accountId: 'dev' })
    )
    await expect(launch).rejects.toBeInstanceOf(AgentSessionPreSpawnError)
    await expect(launch).rejects.toMatchObject({ reason: 'claudeAccountRemoved' })
  })

  it('reports its account, a missing login and a removed account to the chat', async () => {
    const f = twoAccounts()
    const record = (pin: Parameters<typeof pinned>[0]) => ({
      provider: 'claude',
      accountHome: pinned(pin)
    })
    expect(
      await readClaudeChatAccount(record({ kind: 'managed', accountId: 'dev' }), f.router)
    ).toEqual({ kind: 'managed', accountId: 'dev', label: 'dev@example.test', state: 'ready' })
    expect(await readClaudeChatAccount(record({ kind: 'system' }), f.router)).toEqual({
      kind: 'system',
      label: 'personal@example.test',
      state: 'ready'
    })
    rmSync(join(f.router.accountHome('dev'), '.claude.json'))
    expect(
      (await readClaudeChatAccount(record({ kind: 'managed', accountId: 'dev' }), f.router))?.state
    ).toBe('needsSignIn')
    f.settings.claudeManagedAccounts = []
    expect(
      await readClaudeChatAccount(
        {
          provider: 'claude',
          accountHome: {
            ...pinned({ kind: 'managed', accountId: 'dev' }),
            pin: { kind: 'managed', accountId: 'dev', label: 'dev@example.test' }
          }
        },
        f.router
      )
    ).toEqual({ kind: 'managed', accountId: 'dev', label: 'dev@example.test', state: 'removed' })
    expect(
      await readClaudeChatAccount(
        { provider: 'claude', accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/recorded' } },
        f.router
      )
    ).toBeUndefined()
  })
})

describe('the account a new chat pins', () => {
  const settings = {
    claudeManagedAccounts: [
      account('work', 'work@example.test'),
      account('dev', 'dev@example.test')
    ],
    activeClaudeManagedAccountId: 'work'
  }

  it('takes the explicit pick, then the workspace default, then the selection', () => {
    expect(
      resolveClaudeChatAccountPin({
        explicit: { kind: 'managed', accountId: 'dev' },
        workspaceDefault: 'system',
        settings
      })
    ).toEqual({ kind: 'managed', accountId: 'dev', label: 'dev@example.test' })
    expect(resolveClaudeChatAccountPin({ workspaceDefault: 'system', settings })).toEqual({
      kind: 'system'
    })
    expect(resolveClaudeChatAccountPin({ workspaceDefault: 'dev', settings })).toEqual({
      kind: 'managed',
      accountId: 'dev',
      label: 'dev@example.test'
    })
    expect(resolveClaudeChatAccountPin({ workspaceDefault: 'gone', settings })).toEqual({
      kind: 'managed',
      accountId: 'work',
      label: 'work@example.test'
    })
    expect(
      resolveClaudeChatAccountPin({ settings: { ...settings, activeClaudeManagedAccountId: null } })
    ).toEqual({ kind: 'system' })
  })

  it('refuses an explicit account this host does not have', () => {
    expect(() =>
      resolveClaudeChatAccountPin({ explicit: { kind: 'managed', accountId: 'gone' }, settings })
    ).toThrow(AgentSessionPreSpawnError)
  })
})

describe('the stored pin', () => {
  it('keeps old records readable and rejects a malformed pin', () => {
    expect(isAgentSessionAccountHome({ variable: 'CLAUDE_CONFIG_DIR', path: '/a' })).toBe(true)
    expect(
      isAgentSessionAccountHome({
        variable: 'CLAUDE_CONFIG_DIR',
        path: '/a',
        pin: { kind: 'managed', accountId: 'dev', label: 'dev@example.test' }
      })
    ).toBe(true)
    expect(
      isAgentSessionAccountHome({
        variable: 'CLAUDE_CONFIG_DIR',
        path: '/a',
        pin: { kind: 'managed', accountId: '../escape' }
      })
    ).toBe(false)
  })

  it('survives the stored row, so a restart reopens the chat on the same account', () => {
    const accountHome = {
      variable: 'CLAUDE_CONFIG_DIR',
      path: '/data/claude-profiles/dev',
      pin: { kind: 'managed' as const, accountId: 'dev', label: 'dev@example.test' }
    }
    const row = JSON.parse(
      JSON.stringify(
        encodeAgentSessionRecord(agentSessionRecordFixture({ sessionId: 'claude_1', accountHome }))
      )
    )
    expect(isReadableAgentSessionStoreRecord('claude_1', row)).toBe(true)
    expect(decodePersistedAgentSessionRecord(row).record.accountHome).toEqual(accountHome)
  })

  it('accepts a create naming an account and rejects an unsafe id', () => {
    const create = (claudeAccount: unknown) =>
      CreateIntentParams.safeParse({
        envelope: {
          sessionId: 'claude_1',
          clientOperationId: 'op-1',
          expectedRuntimeFence: null,
          payloadFingerprint: 'a'.repeat(64)
        },
        worktree: 'repo::/w',
        agent: 'claude',
        claudeAccount
      }).success
    expect(create({ kind: 'managed', accountId: 'dev' })).toBe(true)
    expect(create({ kind: 'system' })).toBe(true)
    expect(create({ kind: 'managed', accountId: '../escape' })).toBe(false)
  })
})

describe('a terminal pinned to a Claude account', () => {
  const pointerOf = (env: Record<string, string>) => env.ORCA_CLAUDE_PROFILE_POINTER

  it("reads its account's own pointer, not the selection's", () => {
    const f = twoAccounts()
    const dev = withClaudeProfileTerminalEnv(
      { ORCA_CLAUDE_ACCOUNT_PIN: 'dev' },
      { runtime: 'host' }
    )
    const system = withClaudeProfileTerminalEnv(
      { ORCA_CLAUDE_ACCOUNT_PIN: 'system' },
      { runtime: 'host' }
    )
    const following = withClaudeProfileTerminalEnv({}, { runtime: 'host' })
    expect(readFileSync(pointerOf(dev), 'utf8')).toBe(f.router.accountHome('dev'))
    expect(readFileSync(pointerOf(system), 'utf8')).toBe('')
    expect(pointerOf(following)).toBe(f.router.pointerPath)
    expect(readFileSync(pointerOf(following), 'utf8')).toBe(f.router.accountHome('work'))

    f.settings.activeClaudeManagedAccountId = 'dev'
    withClaudeProfileTerminalEnv({}, { runtime: 'host' })
    expect(readFileSync(pointerOf(system), 'utf8')).toBe('')
    f.settings.claudeManagedAccounts = f.settings.claudeManagedAccounts.filter(
      (saved) => saved.id !== 'dev'
    )
    const removed = withClaudeProfileTerminalEnv(
      { ORCA_CLAUDE_ACCOUNT_PIN: 'dev' },
      { runtime: 'host' }
    )
    // Not absolute: the pane's claude function refuses it instead of running another account.
    expect(readFileSync(pointerOf(removed), 'utf8')).toBe('orca-claude-account-removed')
  })

  it('keeps its account in the launch config a restart replays', () => {
    const inputs = resolveAgentStartupPlanInputs({
      agent: 'claude',
      settings: {},
      platform: 'linux',
      isRemote: false,
      shell: 'posix',
      claudeAccount: { kind: 'managed', accountId: 'dev' }
    })
    expect(inputs.agentEnv).toEqual({ ORCA_CLAUDE_ACCOUNT_PIN: 'dev' })
    const codex = resolveAgentStartupPlanInputs({
      agent: 'codex',
      settings: {},
      platform: 'linux',
      isRemote: false,
      shell: 'posix',
      claudeAccount: { kind: 'managed', accountId: 'dev' }
    })
    expect(codex.agentEnv).toEqual({})
  })

  it('takes an account identity over agent.launch, never a path', () => {
    expect(AgentLaunchAccountEnv.safeParse({ ORCA_CLAUDE_ACCOUNT_PIN: 'dev' }).success).toBe(true)
    expect(AgentLaunchAccountEnv.safeParse({ ORCA_CLAUDE_ACCOUNT_PIN: 'system' }).success).toBe(
      true
    )
    expect(AgentLaunchAccountEnv.safeParse({ ORCA_CLAUDE_ACCOUNT_PIN: '/tmp/x' }).success).toBe(
      false
    )
  })
})
