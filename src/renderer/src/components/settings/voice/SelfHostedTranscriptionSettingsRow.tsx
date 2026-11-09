import { CheckCircle2, Server, Unlink } from 'lucide-react'
import { Button } from '../../ui/button'
import { Label } from '../../ui/label'
import { translate } from '@/i18n/i18n'

type SelfHostedTranscriptionSettingsRowProps = {
  configured: boolean
  url: string
  model: string
  onConfigure: () => void
  onClear: () => void
}

export function SelfHostedTranscriptionSettingsRow({
  configured,
  url,
  model,
  onConfigure,
  onClear
}: SelfHostedTranscriptionSettingsRowProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <Server className="size-4 shrink-0 text-muted-foreground" />
          <Label>
            {translate(
              'components.settings.voice.selfHosted.rowTitle',
              'Self-hosted Transcription'
            )}
          </Label>
          {configured && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5" />
              {translate('components.settings.voice.selfHosted.connected', 'Connected')}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {configured
            ? `${model} · ${url}`
            : translate(
                'components.settings.voice.selfHosted.rowDescription',
                'Set the URL and model of an OpenAI-compatible speech server running on your own hardware.'
              )}
        </p>
      </div>
      {configured ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={onConfigure}>
            {translate('components.settings.voice.selfHosted.edit', 'Edit')}
          </Button>
          <button
            onClick={onClear}
            aria-label={translate(
              'components.settings.voice.selfHosted.disconnectAria',
              'Disconnect self-hosted transcription server'
            )}
            className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:text-destructive"
          >
            <Unlink className="size-3.5" />
          </button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={onConfigure}>
          {translate('components.settings.voice.selfHosted.configure', 'Configure')}
        </Button>
      )}
    </div>
  )
}
