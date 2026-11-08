import type { ClaudeAccountChoice } from './claude-account-choice'

/** Marks a terminal launch pinned to a Claude account, by identity only: `system` or the
 *  account id. The host swaps it for that account's own pointer when it spawns the pane. */
export const CLAUDE_ACCOUNT_PIN_ENV = 'ORCA_CLAUDE_ACCOUNT_PIN'

const ACCOUNT_ID = /^[a-zA-Z0-9_-]{1,512}$/

export function claudeAccountPinEnvValue(choice: ClaudeAccountChoice): string {
  return choice.kind === 'managed' ? choice.accountId : 'system'
}

export function claudeAccountChoiceFromPinEnv(
  value: string | undefined
): ClaudeAccountChoice | null {
  if (!value) {
    return null
  }
  if (value === 'system') {
    return { kind: 'system' }
  }
  return ACCOUNT_ID.test(value) ? { kind: 'managed', accountId: value } : null
}
