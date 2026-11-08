import * as z from 'zod'

/** The Claude account a chat is pinned to: a saved account by id, or the host's System default.
 *  Only the reference is stored; credentials stay in the account's own folder. */
export type ClaudeAccountChoice = { kind: 'system' } | { kind: 'managed'; accountId: string }

/** A pinned choice as a chat record keeps it; `label` names a removed account in errors. */
export type ClaudeAccountPin = ClaudeAccountChoice & { label?: string }

const ACCOUNT_ID = /^[a-zA-Z0-9_-]{1,512}$/
const MAX_LABEL_LENGTH = 512

export const ClaudeAccountChoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('system') }).strict(),
  z.object({ kind: z.literal('managed'), accountId: z.string().regex(ACCOUNT_ID) }).strict()
])

export function isClaudeAccountPin(value: unknown): value is ClaudeAccountPin {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const pin = value as Record<string, unknown>
  if (
    pin.label !== undefined &&
    (typeof pin.label !== 'string' || pin.label.length > MAX_LABEL_LENGTH)
  ) {
    return false
  }
  if (pin.kind === 'system') {
    return true
  }
  return (
    pin.kind === 'managed' && typeof pin.accountId === 'string' && ACCOUNT_ID.test(pin.accountId)
  )
}

export function claudeAccountChoiceOf(pin: ClaudeAccountPin): ClaudeAccountChoice {
  return pin.kind === 'managed' ? { kind: 'managed', accountId: pin.accountId } : { kind: 'system' }
}

export function sameClaudeAccountChoice(
  left: ClaudeAccountChoice | undefined,
  right: ClaudeAccountChoice | undefined
): boolean {
  if (!left || !right) {
    return left === right
  }
  return left.kind === 'managed'
    ? right.kind === 'managed' && left.accountId === right.accountId
    : right.kind === 'system'
}

/** What a pinned chat shows about its account; `label` is the login's email when known. */
export type AgentSessionClaudeAccount = {
  kind: 'system' | 'managed'
  accountId?: string
  label: string | null
  state: 'ready' | 'needsSignIn' | 'removed'
}
