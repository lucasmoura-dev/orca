/**
 * Fork-only: hands the download step to an external build script and the install step to a plain
 * relaunch of the AppImage that script installed. The update check stays on the official release feed.
 *
 * Enabled only when `<userData>/custom-updater.json` exists; without it the official updater runs untouched.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { app } from 'electron'

export const CUSTOM_UPDATER_CONFIG_FILE = 'custom-updater.json'

export type CustomUpdaterConfig = {
  /** Absolute path of the script that merges upstream, builds and installs the AppImage. */
  command: string
  /** Extra arguments placed before `--target <version>`. */
  args?: string[]
  /** Absolute path of the AppImage the script installs; relaunched after the update. */
  appImage: string
  cwd?: string
}

export type CustomUpdateProgress = { percent: number; step?: string; message?: string }

type CustomUpdateResultLine = { result: 'ok' | 'failed'; runDir?: string; error?: string }

function isAbsolutePathString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && isAbsolute(value)
}

export function parseCustomUpdaterConfig(raw: string): CustomUpdaterConfig | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  const { command, args, appImage, cwd } = parsed as Record<string, unknown>
  if (!isAbsolutePathString(command) || !isAbsolutePathString(appImage)) {
    return null
  }
  if (args !== undefined && !(Array.isArray(args) && args.every((a) => typeof a === 'string'))) {
    return null
  }
  if (cwd !== undefined && !isAbsolutePathString(cwd)) {
    return null
  }
  return { command, appImage, ...(args ? { args } : {}), ...(cwd ? { cwd } : {}) }
}

export function readCustomUpdaterConfig(
  userDataPath = app.getPath('userData')
): CustomUpdaterConfig | null {
  if (process.platform !== 'linux' || !app.isPackaged) {
    return null
  }
  let raw: string
  try {
    raw = readFileSync(join(userDataPath, CUSTOM_UPDATER_CONFIG_FILE), 'utf8')
  } catch {
    return null
  }
  const config = parseCustomUpdaterConfig(raw)
  if (!config) {
    console.warn('[updater] custom-updater.json is invalid; using the official updater')
  }
  return config
}

let installedVersion: string | null = null

/** Version the custom script already installed on disk, waiting for a relaunch. */
export function getCustomUpdateInstalledVersion(): string | null {
  return installedVersion
}

export function setCustomUpdateInstalledVersion(version: string | null): void {
  installedVersion = version
}

export function parseCustomUpdateLine(
  line: string
): { progress?: CustomUpdateProgress; result?: CustomUpdateResultLine } | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  const record = parsed as Record<string, unknown>
  if (record.result === 'ok' || record.result === 'failed') {
    return {
      result: {
        result: record.result,
        ...(typeof record.runDir === 'string' ? { runDir: record.runDir } : {}),
        ...(typeof record.error === 'string' ? { error: record.error } : {})
      }
    }
  }
  if (typeof record.percent === 'number' && Number.isFinite(record.percent)) {
    return {
      progress: {
        percent: Math.max(0, Math.min(100, record.percent)),
        ...(typeof record.step === 'string' ? { step: record.step } : {}),
        ...(typeof record.message === 'string' ? { message: record.message } : {})
      }
    }
  }
  return null
}

/** Runs the script until it exits; progress lines on stdout drive the download card. */
export function runCustomUpdate(
  config: CustomUpdaterConfig,
  version: string,
  onProgress: (progress: CustomUpdateProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      config.command,
      [...(config.args ?? []), '--target', version, '--progress-json'],
      {
        cwd: config.cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let stdoutBuffer = ''
    let lastResult: CustomUpdateResultLine | null = null
    let stderrTail = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const parsed = parseCustomUpdateLine(line)
        if (parsed?.progress) {
          onProgress(parsed.progress)
        } else if (parsed?.result) {
          lastResult = parsed.result
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-2000)
    })
    child.on('error', (error) => {
      reject(new Error(`Custom update script could not start: ${error.message}`))
    })
    child.on('close', (code, signal) => {
      const result: CustomUpdateResultLine | null = lastResult
      if (code === 0 && result?.result !== 'failed') {
        resolve()
        return
      }
      const reason =
        result?.error ?? (signal ? `terminated by ${signal}` : `exit code ${code ?? 'unknown'}`)
      const where = result?.runDir ? ` Logs: ${result.runDir}` : ''
      const stderrHint = stderrTail.trim().split('\n').slice(-3).join(' ')
      reject(
        new Error(
          `Custom update failed: ${reason}.${where}${stderrHint && !result?.error ? ` (${stderrHint})` : ''}`
        )
      )
    })
  })
}

export type CustomQuitAndInstallHooks = {
  /** Official pre-quit cleanup (profile flush, serve handoff). */
  prepare: () => Promise<void>
  /** Kill PTYs and drop window close guards, as the native installer path does. */
  release: () => void
  /** Mark the install committed and arm the exit watchdog. */
  commit: () => void
}

/** Runs the official pre-quit steps, schedules the relaunch and quits. Returns an error message on failure. */
export async function executeCustomQuitAndInstall(
  hooks: CustomQuitAndInstallHooks
): Promise<string | null> {
  const config = readCustomUpdaterConfig()
  if (!config) {
    return 'custom-updater.json disappeared before the restart; reopen Orca manually.'
  }
  try {
    await hooks.prepare()
    hooks.release()
    relaunchCustomAppImage(config.appImage)
    hooks.commit()
    setCustomUpdateInstalledVersion(null)
    app.quit()
    return null
  } catch (error) {
    return `Could not restart into the updated build: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Starts the installed AppImage once this process has exited, so the single-instance lock is free.
 * The AppImage runtime sets its own APPIMAGE/APPDIR; drop the inherited ones.
 */
export function relaunchCustomAppImage(appImage: string, pid = process.pid): void {
  const env = { ...process.env }
  delete env.APPIMAGE
  delete env.APPDIR
  delete env.OWD
  delete env.ARGV0
  const child = spawn(
    '/bin/sh',
    [
      '-c',
      'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; exec "$2"',
      'orca-custom-relaunch',
      String(pid),
      appImage
    ],
    { detached: true, stdio: 'ignore', env }
  )
  child.unref()
}
