import type { ComponentProps } from 'react'
import { RepositoryClaudeAccountSection } from './RepositoryClaudeAccountSection'
import { RepositoryGitHubAccountSection } from './RepositoryGitHubAccountSection'

/** The accounts this project's work runs on: GitHub calls and new Claude chats. */
export function RepositoryAccountSections(
  props: ComponentProps<typeof RepositoryGitHubAccountSection> &
    ComponentProps<typeof RepositoryClaudeAccountSection>
): React.JSX.Element {
  return (
    <>
      <RepositoryGitHubAccountSection {...props} />
      <RepositoryClaudeAccountSection {...props} />
    </>
  )
}
