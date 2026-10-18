/**
 * 生成一份干净的开源快照，并按需推送到 GitHub。
 *
 * 默认只生成快照（不联网、不推送）：
 *   node scripts/publish-github.mjs
 *
 * 创建公开仓库并推送（需要 GITHUB_TOKEN，需有 repo 权限）：
 *   GITHUB_TOKEN=... node scripts/publish-github.mjs --push --create
 *
 * 只推送到已存在的仓库：
 *   GITHUB_TOKEN=... node scripts/publish-github.mjs --push
 *
 * 远端历史与本地不一致时（例如旧快照仓库），可加 --force 覆盖远端 main。
 * 该仓库只用于发布快照，不承载日常协作历史。
 *
 * 不会把 token 写入任何文件，也不会打印出来。
 */

import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const OWNER = process.env.GITHUB_OWNER ?? 'neon9809'
const REPO = process.env.GITHUB_REPO ?? 'ai-app-portal-android'
const BRANCH = 'main'

const args = new Set(process.argv.slice(2))
const shouldPush = args.has('--push')
const shouldCreate = args.has('--create')
const shouldForce = args.has('--force')
const token = process.env.GITHUB_TOKEN?.trim()

const root = process.cwd()
const EXCLUDED_TOP = new Set([
  '.git',
  '.open-source-snapshot',
  'node_modules',
  'dist',
  'dist-ssr',
  '.vite',
  '.env',
  '.env.local',
  '.app-login',
  '.product-type',
  '.project-type',
  '.project-basekit',
  'AGENTS.md',
  'CLAUDE.md',
])

function keep(relative) {
  if (!relative) return true
  const parts = relative.split(path.sep)
  if (EXCLUDED_TOP.has(parts[0])) return false
  if (relative.endsWith('.log') || relative.endsWith('.local')) return false
  if (relative === path.join('capsule', 'signing')) return true
  if (relative.startsWith(`${path.join('capsule', 'signing')}${path.sep}`)) {
    // 只放行占位文件与示例配置；证书、口令与真实签名一律不进快照
    const name = path.basename(relative)
    return name === '.gitkeep' || name.endsWith('.example')
  }
  return true
}

async function countFiles(dir) {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await countFiles(full)
    else total += 1
  }
  return total
}

function runGit(cwd, gitArgs) {
  try {
    return execFileSync('git', gitArgs, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
  } catch (error) {
    const raw = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
    throw new Error(raw.trim() || `git ${gitArgs[0]} 失败`)
  }
}

async function createRepo() {
  const response = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: REPO,
      description: '用一句话描述需求，在手机上生成一个打开就能用的小工具。',
      private: false,
      has_issues: true,
      has_projects: false,
      has_wiki: false,
      license_template: 'gpl-3.0',
    }),
  })
  if (response.ok) return 'created'
  if (response.status === 422) return 'exists'
  const text = await response.text()
  throw new Error(`创建仓库失败（${response.status}）：${text.slice(0, 300)}`)
}

async function main() {
  if (shouldPush && !token) {
    throw new Error('推送需要 GITHUB_TOKEN 环境变量（不要把它写进文件或提交）')
  }

  // 放到系统临时目录：既不能复制到仓库子目录，也不该被工程门禁当成源码扫描
  const outDir = await mkdtemp(path.join(tmpdir(), 'ai-app-portal-android-'))
  await cp(root, outDir, {
    recursive: true,
    filter: (source) => keep(path.relative(root, source)),
  })

  const files = await countFiles(outDir)
  console.log(`✓ 已生成开源快照：${outDir}（${files} 个文件）`)

  const expected = ['README.md', 'LICENSE', 'NOTICE', 'package.json', 'src', 'capsule']
  for (const name of expected) {
    await stat(path.join(outDir, name)).catch(() => {
      throw new Error(`快照缺少 ${name}`)
    })
  }

  runGit(outDir, ['init', '-b', BRANCH])
  runGit(outDir, ['add', '-A'])

  const author = process.env.GIT_AUTHOR_NAME ?? 'AI应用门户'
  const email = process.env.GIT_AUTHOR_EMAIL ?? 'noreply@localhost'
  runGit(outDir, [
    '-c',
    `user.name=${author}`,
    '-c',
    `user.email=${email}`,
    'commit',
    '-m',
    'Initial open source release: AI应用门户 (Android)',
  ])
  console.log('✓ 已创建首个提交')

  if (!shouldPush) {
    console.log('\n接下来：')
    console.log(`  1. 在 GitHub 创建仓库 ${OWNER}/${REPO}`)
    console.log(`  2. git -C ${outDir} remote add origin git@github.com:${OWNER}/${REPO}.git`)
    console.log(`  3. git -C ${outDir} push -u origin ${BRANCH}`)
    console.log('或设置 GITHUB_TOKEN 后加 --push（--create 可自动创建公开仓库）。')
    return
  }

  if (shouldCreate) {
    const status = await createRepo()
    console.log(status === 'created' ? '✓ 已创建公开仓库' : '· 仓库已存在，继续推送')
  }

  const remote = `https://x-access-token:${token}@github.com/${OWNER}/${REPO}.git`
  runGit(outDir, ['remote', 'add', 'origin', remote])
  try {
    // 已有仓库：把快照接到远端历史上，避免 non-fast-forward（首次发布时 fetch 会失败）
    try {
      runGit(outDir, ['fetch', remote, BRANCH])
      runGit(outDir, ['reset', '--soft', 'FETCH_HEAD'])
      runGit(outDir, [
        '-c',
        `user.name=${author}`,
        '-c',
        `user.email=${email}`,
        'commit',
        '-m',
        process.env.GIT_COMMIT_MESSAGE ?? 'Update open source snapshot',
      ])
      console.log('· 已接到远端历史之上')
    } catch {
      // 空仓库或首次推送：保留刚才的初始提交
    }
    runGit(outDir, ['push', '-u', 'origin', BRANCH, ...(shouldForce ? ['--force'] : [])])
  } catch (error) {
    const message = String(error.message).split(token ?? '\u0000').join('***')
    throw new Error(`推送失败：${message.slice(0, 500)}`)
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
  console.log(`✓ 已推送到 github.com/${OWNER}/${REPO}`)
}

main().catch((error) => {
  const message = String(error.message).split(token ?? '\u0000').join('***')
  console.error(`✗ ${message}`)
  process.exit(1)
})
