import { UserRound } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { AgentSessionClaudeAccount } from '../../../../shared/claude-account-choice'

/** The Claude account a pinned chat runs on; it never follows the status bar's selection. */
export function NativeChatClaudeAccountLabel({
  account
}: {
  account: AgentSessionClaudeAccount
}): React.JSX.Element {
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const name =
    account.label ??
    (account.kind === 'system'
      ? translate('accounts.claude.systemDefault', 'System default')
      : translate('accounts.claude.unnamedAccount', 'Claude account'))
  const status =
    account.state === 'removed'
      ? translate('nativeChat.claudeAccount.removed', 'Removed from Orca')
      : account.state === 'needsSignIn'
        ? translate('nativeChat.claudeAccount.needsSignIn', 'Needs sign-in')
        : null
  const detail =
    account.kind === 'system'
      ? translate(
          'nativeChat.claudeAccount.systemTooltip',
          "This chat runs on this device's System default Claude login. Switching accounts elsewhere does not move it."
        )
      : translate(
          'nativeChat.claudeAccount.managedTooltip',
          'This chat runs on this Claude account. Switching accounts elsewhere does not move it.'
        )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'pointer-events-auto ml-2 flex min-w-0 max-w-1/2 items-center gap-1 truncate font-sans text-xs text-muted-foreground',
            status && 'text-status-warning-text'
          )}
          data-testid="native-chat-claude-account"
          onClick={(event) => {
            event.stopPropagation()
            // Fixing a removed or signed-out account happens where accounts are managed.
            openSettingsTarget({ pane: 'accounts', repoId: null, sectionId: 'accounts-claude' })
            openSettingsPage()
          }}
        >
          <UserRound className="size-3 shrink-0" />
          <span className="truncate">{status ? `${name} · ${status}` : name}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {status
          ? translate(
              'nativeChat.claudeAccount.fixTooltip',
              'Open Accounts to sign in to this account or add it again. Orca never moves this chat to another account.'
            )
          : detail}
      </TooltipContent>
    </Tooltip>
  )
}
