import type { AgentSessionRecord } from '../../shared/agent-session/lifecycle/agent-session-record'
import { agentSessionClaudeAccountPin } from '../../shared/agent-session/lifecycle/agent-session-account-home'
import type { AgentSessionClaudeAccount } from '../../shared/claude-account-choice'
import { claudeStateFileAsync, readClaudeFolderLoginAsync } from './claude-account-folder'
import type { ClaudeProfileRouter } from './claude-profile-router'

type ClaudeChatAccountRouter = Pick<
  ClaudeProfileRouter,
  'savedAccount' | 'accountHome' | 'userConfigDir' | 'userHome'
>

/** The pinned account a chat reports, read without blocking main; undefined for unpinned chats. */
export async function readClaudeChatAccount(
  record: Pick<AgentSessionRecord, 'provider' | 'accountHome'>,
  router: ClaudeChatAccountRouter | undefined
): Promise<AgentSessionClaudeAccount | undefined> {
  const pin = agentSessionClaudeAccountPin(record.accountHome)
  if (!pin || record.provider !== 'claude' || !router) {
    return undefined
  }
  const login = (configDir: string | undefined) =>
    claudeStateFileAsync(configDir, router.userHome).then(readClaudeFolderLoginAsync)
  if (pin.kind === 'system') {
    const systemDefault = await login(router.userConfigDir())
    return { kind: 'system', label: systemDefault?.email ?? null, state: 'ready' }
  }
  const saved = router.savedAccount(pin.accountId)
  if (!saved) {
    return { kind: 'managed', accountId: pin.accountId, label: pin.label ?? null, state: 'removed' }
  }
  const own = await login(router.accountHome(pin.accountId))
  // A legacy account still signed in only as the System default launches through it.
  const covered = own ? null : await login(router.userConfigDir())
  const signedIn = Boolean(own) || covered?.email === saved.email
  return {
    kind: 'managed',
    accountId: pin.accountId,
    label: saved.email,
    state: signedIn ? 'ready' : 'needsSignIn'
  }
}
