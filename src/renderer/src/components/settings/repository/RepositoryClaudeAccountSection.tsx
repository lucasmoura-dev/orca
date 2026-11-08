import { useId, useMemo } from 'react'
import type { Repo } from '../../../../../shared/repo-types'
import { CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID } from '../../../../../shared/repo-types'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../../../shared/execution-host'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { SearchableSetting } from '../section-layout/SearchableSetting'
import { runtimeTargetForOwnerEnvironment } from '@/runtime/rpc/targets/runtime-client-target'
import { useProviderAccountList } from '@/components/status-bar/use-provider-account-list'
import { emptyClaudeAccountsState } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import { translate } from '@/i18n/i18n'
import { searchKeywords } from '../search/settings-search-keywords'

// Radix forbids empty item values; this one stands for following the selection.
const INHERIT_VALUE = '__inherit_claude_account__'

/** New Claude chats in this project pin this account; existing chats keep theirs. */
export function RepositoryClaudeAccountSection({
  repo,
  updateRepo,
  forceVisible
}: {
  repo: Repo
  updateRepo: (repoId: string, updates: { claudeAccountId?: string }) => unknown
  forceVisible?: boolean
}): React.JSX.Element | null {
  const selectLabelId = useId()
  const ownerHost = parseExecutionHostId(getRepoExecutionHostId(repo))
  const ownerEnvironmentId = ownerHost?.kind === 'runtime' ? ownerHost.environmentId : null
  const runtimeTarget = useMemo(
    () => runtimeTargetForOwnerEnvironment(ownerEnvironmentId),
    [ownerEnvironmentId]
  )
  const { accounts, accountsLoaded } = useProviderAccountList(
    'claude',
    runtimeTarget,
    ownerEnvironmentId ?? 'local',
    emptyClaudeAccountsState()
  )
  const hostAccounts = accounts.accounts.filter((account) => account.managedAuthRuntime !== 'wsl')
  const current = repo.claudeAccountId || INHERIT_VALUE
  const missing =
    accountsLoaded &&
    current !== INHERIT_VALUE &&
    current !== CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID &&
    !hostAccounts.some((account) => account.id === current)
  if (hostAccounts.length === 0 && !repo.claudeAccountId) {
    return null
  }
  const title = translate('repository.claudeAccount.title', 'Claude Account')
  return (
    <SearchableSetting
      title={title}
      description={translate(
        'repository.claudeAccount.description',
        'The Claude account new chats in this project start on.'
      )}
      keywords={searchKeywords([repo.displayName, 'claude', 'claude account', 'account'])}
      className="space-y-3"
      forceVisible={forceVisible}
    >
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-semibold">{title}</div>
        <p className="text-xs text-muted-foreground">
          {translate(
            'repository.claudeAccount.longDescription',
            'New Claude chats in this project start on this account unless you pick another when you start them. Existing chats keep the account they started on.'
          )}
        </p>
      </div>
      <div className="space-y-1.5">
        <span id={selectLabelId} className="text-xs text-muted-foreground">
          {translate('repository.claudeAccount.selectLabel', 'Account')}
        </span>
        <Select
          value={current}
          onValueChange={(value) => {
            const next = value === INHERIT_VALUE ? '' : value
            if (next !== (repo.claudeAccountId ?? '')) {
              void updateRepo(repo.id, { claudeAccountId: next })
            }
          }}
        >
          <SelectTrigger size="sm" className="w-full" aria-labelledby={selectLabelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT_VALUE}>
              {translate('repository.claudeAccount.inherit', 'Use the selected account')}
            </SelectItem>
            <SelectItem value={CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID}>
              {accounts.systemDefaultEmail
                ? translate(
                    'agentPicker.claudeAccount.systemDefaultWithEmail',
                    'System default ({{email}})',
                    { email: accounts.systemDefaultEmail }
                  )
                : translate('accounts.claude.systemDefault', 'System default')}
            </SelectItem>
            {missing ? (
              <SelectItem value={current} disabled>
                {translate('repository.claudeAccount.removed', 'Removed account')}
              </SelectItem>
            ) : null}
            {hostAccounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {missing ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'repository.claudeAccount.removedHint',
            'This account was removed, so new chats here use the selected account.'
          )}
        </p>
      ) : null}
    </SearchableSetting>
  )
}
