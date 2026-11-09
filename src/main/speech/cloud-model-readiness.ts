import type { SpeechModelManifest } from '../../shared/speech-types'
import { hasOpenAiSpeechApiKey } from './openai-api-key-store'
import {
  EMPTY_SELF_HOSTED_TRANSCRIPTION,
  hasSelfHostedTranscriptionEndpoint,
  type SelfHostedTranscriptionConfig
} from './openai-transcription-client'

/** Whether a model that runs on a server (OpenAI or the user's own) can start dictating right now. */
export type CloudModelReadiness = (manifest: SpeechModelManifest) => boolean

export function cloudModelReadiness(
  readSelfHostedTranscription: () => SelfHostedTranscriptionConfig = () =>
    EMPTY_SELF_HOSTED_TRANSCRIPTION,
  hasOpenAiKey: () => boolean = hasOpenAiSpeechApiKey
): CloudModelReadiness {
  return (manifest) =>
    manifest.provider === 'self-hosted'
      ? hasSelfHostedTranscriptionEndpoint(readSelfHostedTranscription())
      : hasOpenAiKey()
}
