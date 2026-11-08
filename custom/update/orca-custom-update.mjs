#!/usr/bin/env node
// Atualiza o Orca custom: merge da tag do upstream no branch custom/main, verificação, build do
// AppImage, backup e instalação. Chamado pelo updater do app (--progress-json) ou pelo terminal.
// Sem dependências além do Node 24, git, pnpm e (opcional) claude.
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { commitClaudeFix, finishMergeAfterClaude, runClaude } from './claude-step.mjs'
import {
  APPIMAGE,
  BACKUPS_DIR,
  BRANCH,
  DATA_DIR,
  DESKTOP_FILE,
  KEEP_BUILD_LOGS,
  KEEP_PROFILE_BACKUPS,
  MIN_APPIMAGE_BYTES,
  ORIGIN,
  RUNS_DIR,
  SOURCE_REPO,
  StepError,
  UPSTREAM,
  USER_DATA,
  WORKTREE,
  exec,
  git,
  readPackageVersion,
  timestamp
} from './shared.mjs'

const USAGE = `Uso: orca-custom-update --target <vX.Y.Z> [opções]

  --target <tag>      tag do upstream para mesclar (v1.4.253 ou 1.4.253)
  --progress-json     emite progresso em JSON no stdout (modo usado pelo app)
  --no-ai             não chama o Claude em conflito ou falha de verificação
  --no-install        só faz merge, verificação e build; não troca o AppImage
  --no-push           não envia custom/main nem a tag de backup para o origin
  --setup             cria o worktree e instala dependências (uma vez)
  --reset             desfaz um merge pendente e volta o worktree para origin/${BRANCH}
  --help

Variáveis: ORCA_CUSTOM_UPDATE_HOME, ORCA_CUSTOM_WORKTREE, ORCA_CUSTOM_SOURCE_REPO,
ORCA_CUSTOM_APPIMAGE, ORCA_CUSTOM_USER_DATA, ORCA_CUSTOM_BRANCH, ORCA_CUSTOM_CLAUDE`

function parseArgs(argv) {
  const options = {
    target: null,
    progressJson: false,
    ai: true,
    install: true,
    push: true,
    setup: false,
    reset: false,
    help: false
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--target') {
      options.target = argv[++i] ?? null
    } else if (arg.startsWith('--target=')) {
      options.target = arg.slice('--target='.length)
    } else if (arg === '--progress-json') {
      options.progressJson = true
    } else if (arg === '--no-ai') {
      options.ai = false
    } else if (arg === '--no-install') {
      options.install = false
    } else if (arg === '--no-push') {
      options.push = false
    } else if (arg === '--setup') {
      options.setup = true
    } else if (arg === '--reset') {
      options.reset = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`Argumento desconhecido: ${arg}\n${USAGE}`)
    }
  }
  return options
}

function runIdFor(target) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${date}-${time}-${target}`
}

function createContext(options, target) {
  const runId = runIdFor(target)
  const runDir = path.join(RUNS_DIR, runId)
  mkdirSync(runDir, { recursive: true })
  mkdirSync(path.join(runDir, 'claude'), { recursive: true })
  const runLog = path.join(runDir, 'run.log')
  const result = {
    runId,
    target,
    startedAt: timestamp(),
    finishedAt: null,
    status: 'running',
    failedStep: null,
    error: null,
    fromVersion: null,
    toVersion: null,
    backupTag: null,
    mergeCommit: null,
    alreadyMerged: false,
    intersectionFiles: 0,
    conflicts: [],
    aiRuns: [],
    steps: [],
    appImage: options.install ? APPIMAGE : null,
    profileBackup: null,
    pushed: null,
    worktree: WORKTREE,
    runDir
  }
  const ctx = {
    options,
    target,
    runId,
    runDir,
    runLog,
    result,
    percent: 0,
    log(message) {
      const line = `[${timestamp()}] ${message}`
      appendFileSync(runLog, `${line}\n`)
      process.stderr.write(`[orca-custom-update] ${message}\n`)
    },
    progress(percent, step, message) {
      ctx.percent = Math.max(ctx.percent, percent)
      if (options.progressJson) {
        process.stdout.write(`${JSON.stringify({ percent: ctx.percent, step, message })}\n`)
      }
      ctx.log(`${step}: ${message} (${ctx.percent}%)`)
    },
    writeResult() {
      writeFileSync(path.join(runDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
    }
  }
  return ctx
}

async function timedStep(ctx, name, fn) {
  const startedAt = Date.now()
  try {
    const value = await fn()
    ctx.result.steps.push({ name, ok: true, ms: Date.now() - startedAt })
    ctx.writeResult()
    return value
  } catch (error) {
    ctx.result.steps.push({ name, ok: false, ms: Date.now() - startedAt })
    ctx.writeResult()
    throw error
  }
}

function normalizeTarget(raw) {
  const trimmed = String(raw ?? '').trim()
  if (!/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(trimmed)) {
    throw new Error(`Alvo inválido: "${raw}". Use uma tag como v1.4.253.`)
  }
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`
}

async function setup(ctx) {
  mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(path.join(WORKTREE, '.git'))) {
    ctx.log(`criando worktree em ${WORKTREE} a partir de ${SOURCE_REPO} (${BRANCH})`)
    await exec(ctx, 'setup', 'git', ['-C', SOURCE_REPO, 'worktree', 'add', WORKTREE, BRANCH], {
      cwd: SOURCE_REPO
    })
  }
  await exec(ctx, 'setup', 'pnpm', ['install', '--frozen-lockfile'])
  await exec(ctx, 'setup', 'pnpm', ['-C', 'mobile', 'install', '--frozen-lockfile'])
  ctx.log('setup concluído')
}

async function reset(ctx) {
  await exec(ctx, 'reset', 'git', ['merge', '--abort'], { allowFailure: true })
  await git(ctx, 'reset', ['fetch', ORIGIN, BRANCH])
  await git(ctx, 'reset', ['checkout', '-B', BRANCH, `${ORIGIN}/${BRANCH}`])
  await git(ctx, 'reset', ['clean', '-fd'])
  ctx.log(`worktree de volta a ${ORIGIN}/${BRANCH}`)
}

async function preflight(ctx) {
  ctx.progress(2, 'preflight', 'verificando worktree e buscando o upstream')
  if (!existsSync(path.join(WORKTREE, '.git'))) {
    throw new StepError('preflight', `worktree não existe em ${WORKTREE}; rode --setup`)
  }
  const dirty = await git(ctx, 'preflight', ['status', '--porcelain'])
  if (dirty) {
    throw new StepError(
      'preflight',
      'worktree com alterações pendentes (uma atualização anterior falhou?); resolva ou rode --reset'
    )
  }
  await git(ctx, 'preflight', ['fetch', UPSTREAM, '--tags', '--force', '--prune'])
  await git(ctx, 'preflight', ['fetch', ORIGIN, '--prune'])
  const head = await git(ctx, 'preflight', ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (head !== BRANCH) {
    await git(ctx, 'preflight', ['checkout', BRANCH])
  }
  const originBranch = await git(
    ctx,
    'preflight',
    ['rev-parse', '--verify', '--quiet', `${ORIGIN}/${BRANCH}`],
    { allowFailure: true }
  )
  if (originBranch) {
    await git(ctx, 'preflight', ['merge', '--ff-only', `${ORIGIN}/${BRANCH}`])
  }
  const tagRef = await git(
    ctx,
    'preflight',
    ['rev-parse', '--verify', '--quiet', `refs/tags/${ctx.target}^{commit}`],
    { allowFailure: true }
  )
  if (!tagRef) {
    throw new StepError('preflight', `tag ${ctx.target} não existe no ${UPSTREAM}`)
  }
  ctx.result.fromVersion = readPackageVersion()
  const { code } = await exec(
    ctx,
    'preflight',
    'git',
    ['merge-base', '--is-ancestor', ctx.target, 'HEAD'],
    { allowFailure: true }
  )
  ctx.result.alreadyMerged = code === 0
  if (ctx.result.alreadyMerged) {
    ctx.log(`${ctx.target} já está mesclada em ${BRANCH}; só verificação e build`)
  }
}

async function createBackupTag(ctx) {
  ctx.progress(4, 'backup-tag', 'marcando o estado atual')
  const tag = `custom/antes-${ctx.target}-${ctx.runId.slice(0, 15)}`
  await git(ctx, 'backup-tag', ['tag', tag])
  ctx.result.backupTag = tag
}

async function computeIntersection(ctx) {
  ctx.progress(6, 'intersection', 'calculando os arquivos que o custom e o upstream tocam')
  const base = await git(ctx, 'intersection', ['merge-base', 'HEAD', ctx.target])
  const customFiles = (await git(ctx, 'intersection', ['diff', '--name-only', base, 'HEAD']))
    .split('\n')
    .filter(Boolean)
  const upstreamFiles = new Set(
    (await git(ctx, 'intersection', ['diff', '--name-only', base, ctx.target]))
      .split('\n')
      .filter(Boolean)
  )
  const intersection = customFiles.filter((file) => upstreamFiles.has(file))
  writeFileSync(path.join(ctx.runDir, 'custom-files.txt'), `${customFiles.join('\n')}\n`)
  writeFileSync(path.join(ctx.runDir, 'intersection.txt'), `${intersection.join('\n')}\n`)
  if (intersection.length > 0) {
    await exec(ctx, 'intersection', 'git', ['diff', base, ctx.target, '--', ...intersection], {
      logFile: path.join(ctx.runDir, 'upstream.diff'),
      tailBytes: 0
    })
  }
  ctx.result.intersectionFiles = intersection.length
  ctx.log(
    `custom: ${customFiles.length} arquivos; interseção com ${ctx.target}: ${intersection.length}`
  )
  return { base, customFiles, intersection }
}

async function merge(ctx) {
  ctx.progress(10, 'merge', `mesclando ${ctx.target} em ${BRANCH}`)
  const message = `Merge upstream ${ctx.target} into ${BRANCH} (orca-custom-update ${ctx.runId})`
  const { code } = await exec(
    ctx,
    'merge',
    'git',
    ['merge', '--no-ff', '--no-edit', '-m', message, ctx.target],
    { allowFailure: true }
  )
  if (code === 0) {
    ctx.result.mergeCommit = await git(ctx, 'merge', ['rev-parse', 'HEAD'])
    return { conflicts: [] }
  }
  const conflicts = (await git(ctx, 'merge', ['diff', '--name-only', '--diff-filter=U']))
    .split('\n')
    .filter(Boolean)
  if (conflicts.length === 0) {
    throw new StepError('merge', `git merge falhou sem conflitos; veja ${ctx.runLog}`)
  }
  ctx.result.conflicts = conflicts
  const conflictDiff = await git(ctx, 'merge', ['diff', '--', ...conflicts])
  writeFileSync(
    path.join(ctx.runDir, 'conflicts.txt'),
    `${conflicts.join('\n')}\n\n${conflictDiff}\n`
  )
  ctx.log(`conflitos em ${conflicts.length} arquivo(s): ${conflicts.join(', ')}`)
  return { conflicts }
}

function customTestFiles(customFiles) {
  const fromCustom = customFiles.filter((file) => /\.test\.tsx?$/.test(file))
  const updaterDir = path.join(WORKTREE, 'src/main/updater/custom')
  const updaterTests = existsSync(updaterDir)
    ? readdirSync(updaterDir)
        .filter((f) => f.endsWith('.test.ts'))
        .map((f) => `src/main/updater/custom/${f}`)
    : []
  return [...new Set([...fromCustom, ...updaterTests])].filter((file) =>
    existsSync(path.join(WORKTREE, file))
  )
}

/** Dependências, typecheck e testes do custom. Devolve null se tudo passou, ou a falha. */
async function verify(ctx, customFiles) {
  const attempt = async (step, percent, message, fn) => {
    ctx.progress(percent, step, message)
    try {
      await fn()
      return null
    } catch (error) {
      if (error instanceof StepError) {
        return error
      }
      throw error
    }
  }
  let failure = await attempt('deps', 18, 'instalando dependências', async () => {
    const logFile = path.join(ctx.runDir, 'deps.log')
    await exec(ctx, 'deps', 'pnpm', ['install', '--frozen-lockfile'], { logFile })
    await exec(ctx, 'deps', 'pnpm', ['-C', 'mobile', 'install', '--frozen-lockfile'], { logFile })
  })
  if (failure) {
    return failure
  }
  failure = await attempt('typecheck', 28, 'typecheck', () =>
    exec(ctx, 'typecheck', 'pnpm', ['run', 'typecheck'], {
      logFile: path.join(ctx.runDir, 'typecheck.log')
    })
  )
  if (failure) {
    return failure
  }
  const tests = customTestFiles(customFiles)
  writeFileSync(path.join(ctx.runDir, 'custom-tests.txt'), `${tests.join('\n')}\n`)
  if (tests.length === 0) {
    ctx.log('nenhum teste do custom encontrado; pulando')
    return null
  }
  return attempt('tests', 40, `rodando ${tests.length} arquivo(s) de teste do custom`, async () => {
    const logFile = path.join(ctx.runDir, 'tests.log')
    await exec(
      ctx,
      'tests',
      'node',
      ['config/scripts/workspace-package-build/build-workspace-packages.mjs'],
      { logFile }
    )
    await exec(
      ctx,
      'tests',
      'node',
      ['config/scripts/native-build/node-addons/ensure-native-runtime.mjs', '--runtime=node'],
      { logFile }
    )
    await exec(
      ctx,
      'tests',
      'pnpm',
      ['exec', 'vitest', 'run', '--config', 'config/vitest.config.ts', ...tests],
      { logFile }
    )
  })
}

async function build(ctx) {
  const logFile = path.join(ctx.runDir, 'build.log')
  ctx.progress(50, 'build', 'compilando o app (build:desktop)')
  await exec(ctx, 'build', 'pnpm', ['run', 'build:desktop'], { logFile })
  ctx.progress(78, 'build', 'preparando o runtime do Electron')
  await exec(ctx, 'build', 'pnpm', ['run', 'ensure:electron-runtime'], { logFile })
  ctx.progress(82, 'build', 'empacotando o AppImage')
  await exec(
    ctx,
    'build',
    'pnpm',
    [
      'exec',
      'electron-builder',
      '--config',
      'config/electron-builder.config.cjs',
      '--linux',
      'AppImage',
      '--x64'
    ],
    { logFile }
  )
  const artifact = path.join(WORKTREE, 'dist/orca-linux.AppImage')
  if (!existsSync(artifact) || statSync(artifact).size < MIN_APPIMAGE_BYTES) {
    throw new StepError('build', `AppImage não foi gerado em ${artifact}`, logFile)
  }
  ctx.result.toVersion = readPackageVersion()
  return artifact
}

function pruneProfileBackups() {
  const backups = readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith('profiles-') && f.endsWith('.tar.gz'))
    .sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_PROFILE_BACKUPS))) {
    rmSync(path.join(BACKUPS_DIR, old), { force: true })
  }
}

async function backupProfiles(ctx) {
  const profiles = path.join(USER_DATA, 'profiles')
  if (!existsSync(profiles)) {
    ctx.log(`sem pasta de perfis em ${profiles}; pulando backup`)
    return null
  }
  mkdirSync(BACKUPS_DIR, { recursive: true })
  const file = path.join(BACKUPS_DIR, `profiles-${ctx.runId}.tar.gz`)
  await exec(
    ctx,
    'install',
    'tar',
    ['-czf', file, '-C', USER_DATA, 'profiles', 'orca-profile-index.json'],
    { allowFailure: false }
  )
  pruneProfileBackups()
  return file
}

function updateDesktopFileVersion(version) {
  if (!version || !existsSync(DESKTOP_FILE)) {
    return
  }
  const content = readFileSync(DESKTOP_FILE, 'utf8')
  const updated = content.replace(/^X-AppImage-Version=.*$/m, `X-AppImage-Version=${version}`)
  if (updated !== content) {
    writeFileSync(DESKTOP_FILE, updated)
  }
}

async function install(ctx, artifact) {
  ctx.progress(92, 'install', 'backup do perfil e troca do AppImage')
  ctx.result.profileBackup = await backupProfiles(ctx)
  mkdirSync(path.dirname(APPIMAGE), { recursive: true })
  if (existsSync(APPIMAGE)) {
    copyFileSync(APPIMAGE, `${APPIMAGE}.prev`)
  }
  const staged = `${APPIMAGE}.new`
  copyFileSync(artifact, staged)
  chmodSync(staged, 0o755)
  renameSync(staged, APPIMAGE)
  updateDesktopFileVersion(ctx.result.toVersion)
  ctx.log(`AppImage instalado em ${APPIMAGE} (anterior em ${APPIMAGE}.prev)`)
}

async function push(ctx) {
  ctx.progress(97, 'push', `enviando ${BRANCH} para ${ORIGIN}`)
  const refs = [BRANCH, ...(ctx.result.backupTag ? [ctx.result.backupTag] : [])]
  const { code } = await exec(ctx, 'push', 'git', ['push', ORIGIN, ...refs], { allowFailure: true })
  ctx.result.pushed = code === 0
  if (code !== 0) {
    ctx.log('push falhou (sem rede?); a atualização local está completa, envie depois com git push')
  }
}

function pruneBuildLogs() {
  if (!existsSync(RUNS_DIR)) {
    return
  }
  const runs = readdirSync(RUNS_DIR).sort()
  for (const old of runs.slice(0, Math.max(0, runs.length - KEEP_BUILD_LOGS))) {
    rmSync(path.join(RUNS_DIR, old, 'build.log'), { force: true })
  }
}

async function update(ctx) {
  await timedStep(ctx, 'preflight', () => preflight(ctx))
  await timedStep(ctx, 'backup-tag', () => createBackupTag(ctx))
  const { customFiles } = await timedStep(ctx, 'intersection', () => computeIntersection(ctx))
  if (!ctx.result.alreadyMerged) {
    const { conflicts } = await timedStep(ctx, 'merge', () => merge(ctx))
    if (conflicts.length > 0) {
      await timedStep(ctx, 'claude-conflict', () => runClaude(ctx, 'conflict', null))
      await timedStep(ctx, 'merge-finish', () => finishMergeAfterClaude(ctx))
    }
  }
  let failure = await timedStep(ctx, 'verify', () => verify(ctx, customFiles))
  if (failure) {
    await timedStep(ctx, 'claude-verify', () => runClaude(ctx, 'verify-failed', failure))
    await timedStep(ctx, 'claude-commit', () => commitClaudeFix(ctx, failure))
    failure = await timedStep(ctx, 'verify-again', () => verify(ctx, customFiles))
    if (failure) {
      throw new StepError(
        failure.step,
        `"${failure.step}" continua falhando após a intervenção do Claude; veja ${failure.logFile ?? ctx.runLog}`,
        failure.logFile
      )
    }
  }
  const artifact = await timedStep(ctx, 'build', () => build(ctx))
  if (ctx.options.install) {
    await timedStep(ctx, 'install', () => install(ctx, artifact))
  } else {
    ctx.log(`--no-install: AppImage pronto em ${artifact}`)
  }
  if (ctx.options.push) {
    await timedStep(ctx, 'push', () => push(ctx))
  }
  pruneBuildLogs()
  ctx.progress(100, 'done', `atualizado para ${ctx.result.toVersion ?? ctx.target}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  if (options.setup || options.reset) {
    const ctx = createContext(options, options.setup ? 'setup' : 'reset')
    try {
      await (options.setup ? setup(ctx) : reset(ctx))
      ctx.result.status = 'ok'
      ctx.result.finishedAt = timestamp()
      ctx.writeResult()
      return 0
    } catch (error) {
      ctx.result.status = 'failed'
      ctx.result.error = error.message
      ctx.result.finishedAt = timestamp()
      ctx.writeResult()
      ctx.log(`falhou: ${error.message}`)
      return 1
    }
  }
  if (!options.target) {
    console.error(USAGE)
    return 2
  }
  const target = normalizeTarget(options.target)
  const ctx = createContext(options, target)
  ctx.log(`início: alvo ${target}, worktree ${WORKTREE}, AppImage ${APPIMAGE}`)
  try {
    await update(ctx)
    ctx.result.status = 'ok'
    ctx.result.finishedAt = timestamp()
    ctx.writeResult()
    if (options.progressJson) {
      process.stdout.write(`${JSON.stringify({ result: 'ok', runDir: ctx.runDir })}\n`)
    }
    ctx.log(`concluído: ${ctx.result.fromVersion} → ${ctx.result.toVersion}`)
    return 0
  } catch (error) {
    const step = error instanceof StepError ? error.step : 'unexpected'
    ctx.result.status = 'failed'
    ctx.result.failedStep = step
    ctx.result.error = error.message
    ctx.result.finishedAt = timestamp()
    ctx.writeResult()
    ctx.log(`falhou na etapa ${step}: ${error.message}`)
    if (options.progressJson) {
      process.stdout.write(
        `${JSON.stringify({ result: 'failed', runDir: ctx.runDir, error: `${step}: ${error.message}` })}\n`
      )
    }
    return 1
  }
}

process.exitCode = await main()
