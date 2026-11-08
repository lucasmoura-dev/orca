import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ClaudeAccountChoice } from '../../shared/claude-account-choice'
import { claudeAccountPinEnvValue } from '../../shared/claude-account-pin-env'
import { CLAUDE_PROFILE_POINTER_ENV } from '../../shared/claude-profile-routing'
import type { ClaudeProfileRouter } from './claude-profile-router'
import type { ClaudeEnvPatch } from './environment'

// Not an absolute path, so the pane's `claude` function refuses to run instead of using another account.
const REMOVED_ACCOUNT_POINTER = 'orca-claude-account-removed'

/** A terminal pinned to an account reads that account's own pointer, so switching the selection
 *  never moves it. The pane's `claude` function routes it exactly like the selected account. */
export function claudePinnedTerminalEnv(
  router: Pick<
    ClaudeProfileRouter,
    'pointerPath' | 'routedHome' | 'terminalEnv' | 'prepareAccount'
  >,
  choice: ClaudeAccountChoice
): ClaudeEnvPatch {
  const pointer = join(dirname(router.pointerPath), 'pinned', claudeAccountPinEnvValue(choice))
  let home: string
  try {
    home = router.routedHome('identity', choice) ?? ''
  } catch {
    home = REMOVED_ACCOUNT_POINTER
  }
  if (!existsSync(pointer) || readFileSync(pointer, 'utf8') !== home) {
    mkdirSync(dirname(pointer), { recursive: true, mode: 0o700 })
    // A pane reads the pointer on every launch, so it never sees a half-written file.
    const next = `${pointer}.${process.pid}.tmp`
    writeFileSync(next, home, { mode: 0o600 })
    renameSync(next, pointer)
  }
  if (choice.kind === 'managed' && home !== REMOVED_ACCOUNT_POINTER) {
    // Create a missing folder in the background, as a selected account's terminal does.
    void router.prepareAccount(choice.accountId).catch((error: unknown) => {
      console.warn('[claude-profile] Pinned account setup failed:', error)
    })
  }
  return { ...router.terminalEnv({ runtime: 'host' }), [CLAUDE_PROFILE_POINTER_ENV]: pointer }
}
