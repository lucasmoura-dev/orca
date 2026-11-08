import type { AgentPickerEdit } from '../../../../shared/agent-launch/picker/agent-launch-picker-edits'
import type { agentPickerPanelArguments } from '../../../../shared/agent-launch/picker/agent-launch-picker-arguments'
import { agentPickerPermissions } from '../../../../shared/agent-launch/picker/agent-launch-picker-catalog'
import type { AgentLaunchSetupPanelProps } from './AgentLaunchSetupButton'
import { AgentPermissionMenu } from './launch-settings/AgentPermissionChoiceControls'
import { ClaudeLaunchAccountRow } from './launch-settings/ClaudeLaunchAccountRow'

/** What a launch may do and, for a Claude chat, which account it runs on. */
export function AgentLaunchSetupAccessRows({
  entry,
  draft,
  getDraft,
  onDraftChange,
  editDraft,
  disabled,
  defaultsPending,
  argumentsView,
  argumentsKnown
}: Pick<
  AgentLaunchSetupPanelProps,
  'entry' | 'draft' | 'getDraft' | 'onDraftChange' | 'disabled'
> & {
  editDraft: (edit: AgentPickerEdit) => void
  defaultsPending: boolean | undefined
  argumentsView: ReturnType<typeof agentPickerPanelArguments>
  argumentsKnown: boolean
}): React.JSX.Element {
  return (
    <>
      {!entry.textGeneration ? (
        <div>
          <AgentPermissionMenu
            agentId={entry.agent}
            label={entry.label}
            layout="row"
            showInherited={false}
            rawValue={argumentsView.selectedPermission ? undefined : argumentsView.permission}
            disabled={
              disabled ||
              defaultsPending ||
              !argumentsView.permission ||
              (entry.surfaces.includes('terminal') && !argumentsKnown)
            }
            permission={{
              choice: argumentsView.selectedPermission ?? 'own',
              defaultChoice: argumentsView.selectedPermission ?? 'own',
              choices: agentPickerPermissions(entry.agent, draft.surface),
              source: 'agent',
              flag: '',
              argsSetPermission: false,
              onSelect: (choice) => {
                if (choice !== 'default') {
                  editDraft({ kind: 'permission', value: choice })
                }
              }
            }}
          />
        </div>
      ) : null}
      {entry.agent === 'claude' ? (
        <ClaudeLaunchAccountRow
          worktreeId={entry.worktreeId}
          value={draft.claudeAccount}
          disabled={disabled}
          onChange={(claudeAccount) => {
            const current = getDraft()
            if (current) {
              onDraftChange({ ...current, claudeAccount })
            }
          }}
        />
      ) : null}
    </>
  )
}
