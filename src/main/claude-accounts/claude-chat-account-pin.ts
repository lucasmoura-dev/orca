import type { ClaudeAccountChoice, ClaudeAccountPin } from '../../shared/claude-account-choice'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID } from '../../shared/repo-types'
import { claudeAccountRemoved } from './claude-profile-launch-errors'
import { findClaudeAccount, getSelectedClaudeAccountIdForTarget } from './runtime-selection'

type ClaudeChatAccountSettings = Partial<
  Pick<
    GlobalSettings,
    | 'claudeManagedAccounts'
    | 'activeClaudeManagedAccountId'
    | 'activeClaudeManagedAccountIdsByRuntime'
  >
>

/** The account a new host chat pins: the explicit choice, else the workspace default, else the
 *  current selection. An explicit account must be saved here; a stale workspace default is skipped. */
export function resolveClaudeChatAccountPin(input: {
  explicit?: ClaudeAccountChoice
  workspaceDefault?: string
  settings: ClaudeChatAccountSettings
}): ClaudeAccountPin {
  const { explicit, workspaceDefault, settings } = input
  const managed = (accountId: string): ClaudeAccountPin | null => {
    const account = findClaudeAccount(
      { claudeManagedAccounts: settings.claudeManagedAccounts ?? [] },
      accountId
    )
    return account ? { kind: 'managed', accountId, label: account.email } : null
  }
  if (explicit) {
    if (explicit.kind === 'system') {
      return { kind: 'system' }
    }
    const pin = managed(explicit.accountId)
    if (!pin) {
      throw claudeAccountRemoved()
    }
    return pin
  }
  if (workspaceDefault === CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID) {
    return { kind: 'system' }
  }
  const fromWorkspace = workspaceDefault ? managed(workspaceDefault) : null
  if (fromWorkspace) {
    return fromWorkspace
  }
  const selected = getSelectedClaudeAccountIdForTarget(settings, { runtime: 'host' })
  return (selected ? managed(selected) : null) ?? { kind: 'system' }
}
