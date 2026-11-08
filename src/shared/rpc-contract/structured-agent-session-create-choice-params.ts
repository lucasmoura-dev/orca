import * as z from 'zod'
import { ClaudeAccountChoiceSchema } from '../claude-account-choice'
import { AgentSessionOptions } from './structured-agent-session-message-params'

/** `agentSession.create`'s launch choices. Strict payload: `optionsMode` and `claudeAccount` go only
 *  to a host advertising `agentSession.create.options-mode.v1` / `agentSession.create.claude-account.v1`. */
export const CREATE_CHOICE_FIELDS = {
  options: AgentSessionOptions.optional(),
  optionsMode: z.literal('replace-model-selection').optional(),
  claudeAccount: ClaudeAccountChoiceSchema.optional()
}
