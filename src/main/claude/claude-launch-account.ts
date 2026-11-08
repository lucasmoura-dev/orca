import type { ClaudeAccountRecipe } from '../../shared/agent-session/lifecycle/agent-session-acquired-account'
import type { ClaudeAccountChoice } from '../../shared/claude-account-choice'
import type { ClaudeProfileRouter } from '../claude-accounts/claude-profile-router'
import { applyClaudeEnvPatch } from '../claude-accounts/environment'
import { resolveStructuredClaudeAccountHomePath } from '../runtime/agent-session/environment/structured-agent-account-home'

/** The account a launch runs under is the chat's pinned choice, else the current selection; the
 *  receipt records what it used. */
export async function prepareClaudeLaunchAccount(
  router: ClaudeProfileRouter | undefined,
  env: Record<string, string>,
  recordHome: string,
  choice?: ClaudeAccountChoice
): Promise<ClaudeAccountRecipe> {
  if (!router) {
    return { route: 'system', home: recordHome, configDir: env.CLAUDE_CONFIG_DIR ?? null }
  }
  const preparation = await router.prepareLaunch(choice)
  const home =
    preparation.provenance === 'system'
      ? await resolveStructuredClaudeAccountHomePath({
          launchEnv: env,
          wslDistro: null,
          getClaudeConfigDirectory: () => router.systemDefaultHome(),
          ...(choice ? { choice } : {})
        })
      : preparation.configDir
  // An inherited token outranks the folder's login, so a pinned account must not inherit one.
  applyClaudeEnvPatch(env, preparation.envPatch, {
    stripAuthEnv: choice?.kind === 'managed' && preparation.provenance !== 'system'
  })
  return preparation.provenance.startsWith('profile:')
    ? { route: 'managed', accountId: preparation.provenance.slice('profile:'.length), home }
    : { route: 'system', home, configDir: env.CLAUDE_CONFIG_DIR ?? null }
}
