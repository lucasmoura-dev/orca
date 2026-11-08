// Constantes, erros e execução de processos compartilhados pelo orca-custom-update.
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const HOME = homedir()
export const env = process.env
export const DATA_DIR =
  env.ORCA_CUSTOM_UPDATE_HOME ?? path.join(HOME, '.local/share/orca-custom-update')
export const WORKTREE = env.ORCA_CUSTOM_WORKTREE ?? path.join(DATA_DIR, 'worktree')
export const RUNS_DIR = path.join(DATA_DIR, 'runs')
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups')
export const SOURCE_REPO = env.ORCA_CUSTOM_SOURCE_REPO ?? path.join(HOME, 'Projects/orca')
export const APPIMAGE = env.ORCA_CUSTOM_APPIMAGE ?? path.join(HOME, 'Applications/Orca.AppImage')
export const USER_DATA = env.ORCA_CUSTOM_USER_DATA ?? path.join(HOME, '.config/orca')
export const DESKTOP_FILE = path.join(HOME, '.local/share/applications/orca-ide.desktop')
export const BRANCH = env.ORCA_CUSTOM_BRANCH ?? 'custom/main'
export const UPSTREAM = 'upstream'
export const ORIGIN = 'origin'
export const CLAUDE_BIN = env.ORCA_CUSTOM_CLAUDE ?? 'claude'
export const KEEP_PROFILE_BACKUPS = 3
export const KEEP_BUILD_LOGS = 5
export const MIN_APPIMAGE_BYTES = 50 * 1024 * 1024

export class StepError extends Error {
  constructor(step, message, logFile = null) {
    super(message)
    this.step = step
    this.logFile = logFile
  }
}

export function timestamp() {
  return new Date().toISOString()
}

/** Executa um comando, copiando stdout e stderr para run.log e, se pedido, para um log próprio. */
export function exec(
  ctx,
  step,
  command,
  args,
  {
    cwd = WORKTREE,
    logFile = null,
    extraEnv = {},
    allowFailure = false,
    input = null,
    tailBytes = 8000
  } = {}
) {
  return new Promise((resolve, reject) => {
    ctx.log(`$ ${command} ${args.join(' ')}`)
    const child = spawn(command, args, {
      cwd,
      env: { ...env, ...extraEnv },
      stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const sink = (chunk) => {
      appendFileSync(ctx.runLog, chunk)
      if (logFile) {
        appendFileSync(logFile, chunk)
      }
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-tailBytes)
      sink(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-tailBytes)
      sink(chunk)
    })
    child.on('error', (error) =>
      reject(new StepError(step, `${command}: ${error.message}`, logFile))
    )
    child.on('close', (code) => {
      ctx.log(`exit=${code}`)
      if (code !== 0 && !allowFailure) {
        reject(
          new StepError(
            step,
            `${command} ${args.slice(0, 3).join(' ')} saiu com código ${code}`,
            logFile
          )
        )
        return
      }
      resolve({ code, stdout, stderr })
    })
    if (input !== null) {
      child.stdin.end(input)
    }
  })
}

export async function git(ctx, step, args, options = {}) {
  const { stdout } = await exec(ctx, step, 'git', args, { tailBytes: 400000, ...options })
  return stdout.trim()
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function readPackageVersion() {
  return readJson(path.join(WORKTREE, 'package.json'), {}).version ?? null
}

export function tailOfFile(file, maxChars = 12000) {
  if (!file || !existsSync(file)) {
    return ''
  }
  const content = readFileSync(file, 'utf8')
  return content.length > maxChars ? `…\n${content.slice(-maxChars)}` : content
}
