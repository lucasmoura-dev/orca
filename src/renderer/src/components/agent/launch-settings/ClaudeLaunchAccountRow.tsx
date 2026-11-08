import { translate } from '@/i18n/i18n'
import type { ClaudeAccountChoice } from '../../../../../shared/claude-account-choice'
import { CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID } from '../../../../../shared/repo-types'
import { AgentChoiceMenu } from './AgentChoiceMenu'
import {
  claudeLaunchAccountChoice,
  claudeLaunchAccountValue,
  useClaudeLaunchAccounts
} from './use-claude-launch-accounts'

/** Picks the Claude account a new chat or terminal pins; hidden when the host has a single login
 *  or predates pinning. */
export function ClaudeLaunchAccountRow({
  worktreeId,
  value,
  disabled,
  onChange
}: {
  worktreeId: string | undefined
  value: ClaudeAccountChoice | undefined
  disabled?: boolean
  onChange: (choice: ClaudeAccountChoice) => void
}): React.JSX.Element | null {
  const launchAccounts = useClaudeLaunchAccounts(worktreeId)
  if (!launchAccounts) {
    return null
  }
  return (
    <AgentChoiceMenu
      label={translate('agentPicker.claudeAccount.label', 'Account')}
      row
      value={value ? claudeLaunchAccountValue(value) : launchAccounts.inherited}
      choices={launchAccounts.options.map((option) => ({
        value: option.value,
        label:
          option.value === CLAUDE_SYSTEM_DEFAULT_ACCOUNT_ID
            ? option.email
              ? translate(
                  'agentPicker.claudeAccount.systemDefaultWithEmail',
                  'System default ({{email}})',
                  { email: option.email }
                )
              : translate('accounts.claude.systemDefault', 'System default')
            : (option.email ?? option.value)
      }))}
      disabled={disabled}
      onChange={(next) => onChange(claudeLaunchAccountChoice(next))}
    />
  )
}
