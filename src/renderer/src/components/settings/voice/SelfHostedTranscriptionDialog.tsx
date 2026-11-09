import { useEffect, useState } from 'react'
import type { VoiceSettings } from '../../../../../shared/speech-types'
import { Button } from '../../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../ui/dialog'
import { Input } from '../../ui/input'
import { Label } from '../../ui/label'
import { Textarea } from '../../ui/textarea'
import { translate } from '@/i18n/i18n'

export type SelfHostedTranscriptionDraft = Pick<
  VoiceSettings,
  'selfHostedTranscriptionUrl' | 'selfHostedTranscriptionModel' | 'selfHostedTranscriptionPrompt'
>

export function isSelfHostedTranscriptionConfigured(draft: SelfHostedTranscriptionDraft): boolean {
  return (
    draft.selfHostedTranscriptionUrl.trim() !== '' &&
    draft.selfHostedTranscriptionModel.trim() !== ''
  )
}

type SelfHostedTranscriptionDialogProps = {
  open: boolean
  current: SelfHostedTranscriptionDraft
  onOpenChange: (open: boolean) => void
  onSave: (draft: SelfHostedTranscriptionDraft) => void
  onClear: () => void
}

export function SelfHostedTranscriptionDialog({
  open,
  current,
  onOpenChange,
  onSave,
  onClear
}: SelfHostedTranscriptionDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState<SelfHostedTranscriptionDraft>(current)
  // Reopening discards unsaved edits, like the OpenAI key dialog does.
  useEffect(() => {
    if (open) {
      setDraft(current)
    }
  }, [open, current])
  const configured = isSelfHostedTranscriptionConfigured(current)
  const canSave = isSelfHostedTranscriptionConfigured(draft)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {translate(
              'components.settings.voice.selfHosted.dialogTitle',
              'Self-hosted Transcription'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'components.settings.voice.selfHosted.dialogDescription',
              'Audio is posted to this server’s OpenAI-compatible /v1/audio/transcriptions endpoint. Works with Speaches, whisper.cpp server, vLLM and similar.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="self-hosted-transcription-url">
              {translate('components.settings.voice.selfHosted.urlLabel', 'Server URL')}
            </Label>
            <Input
              id="self-hosted-transcription-url"
              type="url"
              value={draft.selfHostedTranscriptionUrl}
              placeholder={translate(
                'components.settings.voice.selfHosted.urlPlaceholder',
                'http://localhost:8000'
              )}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, selfHostedTranscriptionUrl: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="self-hosted-transcription-model">
              {translate('components.settings.voice.selfHosted.modelLabel', 'Model')}
            </Label>
            <Input
              id="self-hosted-transcription-model"
              value={draft.selfHostedTranscriptionModel}
              placeholder={translate(
                'components.settings.voice.selfHosted.modelPlaceholder',
                'deepdml/faster-whisper-large-v3-turbo-ct2'
              )}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, selfHostedTranscriptionModel: event.target.value }))
              }
            />
            <p className="text-[11px] text-muted-foreground/70">
              {translate(
                'components.settings.voice.selfHosted.modelHint',
                'The model id exactly as the server exposes it.'
              )}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="self-hosted-transcription-prompt">
              {translate(
                'components.settings.voice.selfHosted.promptLabel',
                'Vocabulary hint (optional)'
              )}
            </Label>
            <Textarea
              id="self-hosted-transcription-prompt"
              value={draft.selfHostedTranscriptionPrompt}
              rows={3}
              placeholder={translate(
                'components.settings.voice.selfHosted.promptPlaceholder',
                'React, TypeScript, pnpm, commit, merge, deploy, Supabase'
              )}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  selfHostedTranscriptionPrompt: event.target.value
                }))
              }
            />
            <p className="text-[11px] text-muted-foreground/70">
              {translate(
                'components.settings.voice.selfHosted.promptHint',
                'Sent as the Whisper prompt with every dictation, so names and technical terms come out spelled this way.'
              )}
            </p>
          </div>
        </div>
        <DialogFooter>
          {configured && (
            <Button variant="outline" onClick={onClear}>
              {translate('components.settings.voice.selfHosted.disconnect', 'Disconnect')}
            </Button>
          )}
          <Button disabled={!canSave} onClick={() => onSave(draft)}>
            {translate('components.settings.voice.selfHosted.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
