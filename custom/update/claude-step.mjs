// Etapa do Claude: resolve conflitos de merge ou falhas de verificação com o manifesto do custom.
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BRANCH, CLAUDE_BIN, StepError, WORKTREE, exec, git, tailOfFile } from './shared.mjs'

function buildPrompt(ctx, mode, failure) {
  const manifest =
    tailOfFile(path.join(WORKTREE, 'custom/README.md'), 60000) ||
    '(custom/README.md não encontrado)'
  const intersection = tailOfFile(path.join(ctx.runDir, 'intersection.txt'), 20000)
  const header = `Você está no worktree ${WORKTREE}, branch ${BRANCH}, um fork do Orca (stablyai/orca) com customizações próprias. O script orca-custom-update (execução ${ctx.runId}, logs em ${ctx.runDir}) está mesclando a tag ${ctx.target} do upstream e precisa da sua ajuda.`
  const rules = `Regras:
- Preserve todas as customizações descritas no manifesto abaixo. Em dúvida entre o upstream e o fork num ponto de encaixe, mantenha o comportamento do fork adaptado à nova estrutura do upstream.
- Aceite as refatorações do upstream: se ele moveu ou renomeou algo, reaplique a mudança do fork no novo lugar.
- Não reverta mudanças do upstream fora dos pontos de encaixe do fork.
- Não faça commit. Deixe os arquivos resolvidos no working tree (pode usar git add).
- Ao final, rode o typecheck (pnpm run typecheck) e os testes do custom listados em ${path.join(ctx.runDir, 'custom-tests.txt')} com: pnpm exec vitest run --config config/vitest.config.ts <arquivos>. Corrija até passarem.
- Responda ao final com um resumo curto do que mudou e por quê.`
  const situation =
    mode === 'conflict'
      ? `Situação: o git merge parou com conflitos nestes arquivos:\n${ctx.result.conflicts.join('\n')}\n\nOs trechos em conflito estão em ${path.join(ctx.runDir, 'conflicts.txt')} e nos próprios arquivos (marcadores <<<<<<<). Resolva todos os conflitos, remova os marcadores e deixe o merge pronto para commit.`
      : `Situação: o merge foi concluído sem conflitos, mas a etapa "${failure.step}" falhou. Saída (final):\n\n${tailOfFile(failure.logFile)}\n\nDescubra o que o upstream mudou nos pontos de encaixe do fork e adapte o código do fork para a nova estrutura.`
  return `${header}\n\n${situation}\n\n${rules}\n\nArquivos que o fork altera e o upstream também mudou nesta atualização (diff do upstream neles em ${path.join(ctx.runDir, 'upstream.diff')}):\n${intersection || '(nenhum)'}\n\n--- MANIFESTO DO CUSTOM (custom/README.md) ---\n${manifest}`
}

function snapshotWorkingTree(ctx, label) {
  const dir = path.join(ctx.runDir, 'claude', label)
  mkdirSync(dir, { recursive: true })
  return dir
}

async function copyChangedFiles(ctx, step, dir) {
  const files = (await git(ctx, step, ['ls-files', '-m', '-o', '--exclude-standard']))
    .split('\n')
    .filter(Boolean)
  for (const file of files) {
    const source = path.join(WORKTREE, file)
    if (!existsSync(source) || statSync(source).isDirectory()) {
      continue
    }
    const target = path.join(dir, file)
    mkdirSync(path.dirname(target), { recursive: true })
    copyFileSync(source, target)
  }
  return files
}

export async function runClaude(ctx, mode, failure) {
  if (!ctx.options.ai) {
    throw new StepError(
      mode === 'conflict' ? 'merge' : failure.step,
      `${mode === 'conflict' ? 'conflito no merge' : `falha em ${failure.step}`} e --no-ai ativo; resolva manualmente em ${WORKTREE}`
    )
  }
  const index = ctx.result.aiRuns.length + 1
  ctx.progress(ctx.percent, 'claude', `chamando o Claude (${mode}, tentativa ${index})`)
  const prompt = buildPrompt(ctx, mode, failure)
  const promptFile = path.join(ctx.runDir, 'claude', `prompt-${index}.md`)
  writeFileSync(promptFile, prompt)
  const beforeDir = snapshotWorkingTree(ctx, `before-${index}`)
  const beforeFiles = await copyChangedFiles(ctx, 'claude', beforeDir)
  const startedAt = Date.now()
  const transcript = path.join(ctx.runDir, 'claude', `transcript-${index}.jsonl`)
  const { code } = await exec(
    ctx,
    'claude',
    CLAUDE_BIN,
    [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      '--no-session-persistence',
      '--allowedTools',
      'Read,Edit,MultiEdit,Write,Grep,Glob,Bash(git diff:*),Bash(git status:*),Bash(git add:*),Bash(git log:*),Bash(git show:*),Bash(git blame:*),Bash(pnpm run typecheck:*),Bash(pnpm exec vitest:*),Bash(pnpm run build:packages:*),Bash(node config/scripts/*)'
    ],
    {
      input: prompt,
      logFile: transcript,
      allowFailure: true,
      tailBytes: 0,
      extraEnv: { CLAUDECODE: '' }
    }
  )
  const afterDir = snapshotWorkingTree(ctx, `after-${index}`)
  const afterFiles = await copyChangedFiles(ctx, 'claude', afterDir)
  const changed = [...new Set([...beforeFiles, ...afterFiles])].sort()
  const { stdout: changesDiff } = await exec(
    ctx,
    'claude',
    'diff',
    [
      '-ruN',
      '--label',
      'antes',
      '--label',
      'depois',
      path.relative(ctx.runDir, beforeDir),
      path.relative(ctx.runDir, afterDir)
    ],
    {
      cwd: ctx.runDir,
      allowFailure: true,
      tailBytes: 2_000_000
    }
  )
  writeFileSync(path.join(ctx.runDir, 'claude', `changes-${index}.diff`), changesDiff)
  rmSync(beforeDir, { recursive: true, force: true })
  rmSync(afterDir, { recursive: true, force: true })
  ctx.result.aiRuns.push({
    index,
    mode,
    exitCode: code,
    ms: Date.now() - startedAt,
    filesTouched: changed.length,
    transcript,
    prompt: promptFile
  })
  ctx.writeResult()
  if (code !== 0) {
    throw new StepError('claude', `claude saiu com código ${code}; transcript em ${transcript}`)
  }
}

export async function finishMergeAfterClaude(ctx) {
  const unresolved = (await git(ctx, 'merge', ['diff', '--name-only', '--diff-filter=U']))
    .split('\n')
    .filter(Boolean)
  if (unresolved.length > 0) {
    throw new StepError(
      'merge',
      `conflitos ainda não resolvidos após o Claude: ${unresolved.join(', ')}`
    )
  }
  const { stdout: markers } = await exec(
    ctx,
    'merge',
    'git',
    ['grep', '-l', '-E', '^(<<<<<<<|=======|>>>>>>>) ', '--', ...ctx.result.conflicts],
    { allowFailure: true }
  )
  if (markers.trim()) {
    throw new StepError(
      'merge',
      `marcadores de conflito ainda presentes em: ${markers.trim().replace(/\n/g, ', ')}`
    )
  }
  await git(ctx, 'merge', ['add', '-A'])
  await git(ctx, 'merge', ['commit', '--no-edit'])
  ctx.result.mergeCommit = await git(ctx, 'merge', ['rev-parse', 'HEAD'])
}

export async function commitClaudeFix(ctx, failure) {
  const dirty = await git(ctx, 'claude', ['status', '--porcelain'])
  if (!dirty) {
    throw new StepError(
      failure.step,
      `o Claude não alterou nada e "${failure.step}" continua falhando`
    )
  }
  await git(ctx, 'claude', ['add', '-A'])
  await git(ctx, 'claude', [
    'commit',
    '-m',
    `fix(custom): adapt to upstream ${ctx.target} after ${failure.step} failure\n\nResolved by Claude during orca-custom-update ${ctx.runId}.`
  ])
}
