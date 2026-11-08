import { useEffect, useMemo, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useProviderAccountList } from '@/components/status-bar/use-provider-account-list'
import { emptyClaudeAccountsState } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import {
  resolveStructuredAgentSessionOwner,
  structuredAgentSessionTargetForHost
} from '@/runtime/structured-agent-session-owner'
import { structuredAgentSessionHostSupports } from '@/runtime/structured-agent-session-client'
import { AGENT_SESSION_CREATE_CLAUDE_ACCOUNT_RUNTIME_CAPABILITY } from '../../../../../shared/agent-session/agent-session-create-capabilities'
import type { ClaudeAccountChoice } from '../../../../../shared/claude-account-choice'
import { CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID } from '../../../../../shared/repo-types'
import { getRepoIdFromWorktreeId } from '../../../../../shared/worktree/id'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host'

export type ClaudeLaunchAccountOption = {
  /** `system` or the account id. */
  value: string
  choice: ClaudeAccountChoice
  /** The login's email, when the host can read it. */
  email: string | null
}

export function claudeLaunchAccountValue(choice: ClaudeAccountChoice): string {
  return choice.kind === 'managed' ? choice.accountId : CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID
}

export function claudeLaunchAccountChoice(value: string): ClaudeAccountChoice {
  return value === CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID
    ? { kind: 'system' }
    : { kind: 'managed', accountId: value }
}

export function claudeLaunchAccountName(option: ClaudeLaunchAccountOption): string {
  return option.email ?? translate('accounts.claude.systemDefault', 'System default')
}

/** The Claude accounts a launch in this workspace can pin, System default first, with the one an
 *  unpicked launch would use. Null when the host has a single login or predates pinning. */
export function useClaudeLaunchAccounts(
  worktreeId: string | undefined
): { options: ClaudeLaunchAccountOption[]; inherited: string } | null {
  const executionHostId = useAppStore((state) =>
    worktreeId ? resolveStructuredAgentSessionOwner(state, worktreeId) : LOCAL_EXECUTION_HOST_ID
  )
  const workspaceDefault = useAppStore((state) => {
    const repoId = worktreeId ? getRepoIdFromWorktreeId(worktreeId) : null
    return repoId ? state.repos.find((repo) => repo.id === repoId)?.claudeAccountId : undefined
  })
  const target = useMemo(
    () => structuredAgentSessionTargetForHost(executionHostId),
    [executionHostId]
  )
  const { accounts } = useProviderAccountList(
    'claude',
    target ?? { kind: 'local' },
    executionHostId ?? '',
    emptyClaudeAccountsState()
  )
  const hostAccounts = accounts.accounts.filter((account) => account.managedAuthRuntime !== 'wsl')
  const hasAccounts = hostAccounts.length > 0
  const [supported, setSupported] = useState(false)
  // Ask the host only when there is a choice to offer.
  useEffect(() => {
    let current = true
    if (!target || !hasAccounts) {
      setSupported(false)
      return
    }
    void structuredAgentSessionHostSupports(
      target,
      AGENT_SESSION_CREATE_CLAUDE_ACCOUNT_RUNTIME_CAPABILITY
    ).then((answer) => {
      if (current) {
        setSupported(answer)
      }
    })
    return () => {
      current = false
    }
  }, [target, hasAccounts])
  if (!supported || !hasAccounts) {
    return null
  }
  const saved = (id: string | null | undefined) =>
    id && hostAccounts.some((account) => account.id === id) ? id : null
  // Same order as the host's create: workspace default, then the current selection.
  const inherited =
    workspaceDefault === CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID
      ? CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID
      : (saved(workspaceDefault) ??
        saved(accounts.activeAccountIdsByRuntime?.host ?? accounts.activeAccountId) ??
        CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID)
  return {
    inherited,
    options: [
      {
        value: CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID,
        choice: { kind: 'system' },
        email: accounts.systemDefaultEmail ?? null
      },
      ...hostAccounts.map((account) => ({
        value: account.id,
        choice: { kind: 'managed' as const, accountId: account.id },
        email: account.email
      }))
    ]
  }
}
