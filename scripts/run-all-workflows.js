#!/usr/bin/env node
/**
 * Run every API-format workflow under local-comfyui/workflows against the
 * local ComfyUI, wait for each one, and copy finished files into the output
 * root. Designed to be triggered in the background (Hermes, cron, or plain
 * shell) and to send a Telegram summary on completion via `hermes send`.
 *
 * Usage:
 *   node scripts/run-all-workflows.js                                  # everything
 *   node scripts/run-all-workflows.js --dry-run                        # list only
 *   node scripts/run-all-workflows.js --only=images                    # or =videos
 *   node scripts/run-all-workflows.js --pattern=pony                   # filename filter
 *   node scripts/run-all-workflows.js --i2v-image=./frame.png          # enable I2V
 *   node scripts/run-all-workflows.js --notify=telegram                # summary via hermes send
 *   node scripts/run-all-workflows.js --background --log=run.log       # detach + log
 *   node scripts/run-all-workflows.js --out=/path/to/comfyui-folder    # output root
 *
 * Defaults:
 *   workflows dir  = <repo>/local-comfyui/workflows (recursive)
 *   output root    = /Users/william.jiang/Samsung/playground-2026/comfyui/outputs
 *                    (images → <root>/images, videos → <root>/videos)
 *   ComfyUI        = http://127.0.0.1:8188
 *
 * Env: COMFYUI_URL, COMFYUI_OUTPUT, NSFW_OUT_ROOT, HERMES_BIN.
 * UI-format JSONs (no class_type) are skipped with a note; I2V workflows are
 * skipped unless --i2v-image is provided (the image is uploaded and wired in).
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  readdirSync,
  statSync,
  appendFileSync,
} from 'fs'
import { spawnSync } from 'child_process'
import { join, dirname, basename, extname, relative } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188'
const COMFYUI_OUTPUT =
  process.env.COMFYUI_OUTPUT || '/Volumes/SamsungT7/pinokio/api/comfy.git/app/output'
const DEFAULT_OUT_ROOT =
  process.env.NSFW_OUT_ROOT || '/Users/william.jiang/Samsung/playground-2026/comfyui/outputs'
const HERMES_BIN = process.env.HERMES_BIN || '/Users/william.jiang/.local/bin/hermes'

// --- arg parsing (supports bare flags) -------------------------------------
const args = process.argv.slice(2).reduce((acc, arg) => {
  const eq = arg.indexOf('=')
  if (eq === -1) {
    acc[arg.replace(/^--/, '')] = true
    return acc
  }
  acc[arg.slice(2, eq)] = arg.slice(eq + 1)
  return acc
}, {})

const WORKFLOWS_DIR = args.dir || join(REPO_ROOT, 'local-comfyui', 'workflows')
const OUT_ROOT = args.out || DEFAULT_OUT_ROOT
const dryRun = Boolean(args['dry-run'])
const only = args.only || 'all' // all | images | videos
const pattern = args.pattern ? String(args.pattern).toLowerCase() : null
const i2vImage = args['i2v-image'] || null
const notify = args.notify || (process.env.NSFW_NOTIFY || '') || null
const perFileTimeoutMs =
  parseInt(args.timeout, 10) * 60 * 1000 || 30 * 60 * 1000
const LOG_FILE = args.log ? join(REPO_ROOT, 'logs', basename(args.log)) : null

if (args.background && !process.env.NSFW_BG) {
  // Detach a fresh copy of ourselves with logging enabled.
  const logDir = join(REPO_ROOT, 'logs')
  mkdirSync(logDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = join(logDir, `comfyui-run-${stamp}.log`)
  const childArgs = process.argv.slice(2).filter((a) => !a.startsWith('--background'))
  childArgs.push(`--log=${logPath}`)
  const res = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...childArgs], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NSFW_BG: '1' },
  })
  if (res.error) {
    console.error(`Failed to start background run: ${res.error.message}`)
    process.exit(1)
  }
  console.log(`Started in background (pid ${res.pid}) — log: ${logPath}`)
  if (notify) {
    sendTelegram(`ComfyUI run started (pid ${res.pid})`, `Log: ${logPath}`)
  }
  process.exit(0)
}

function log(line) {
  const msg = `${new Date().toISOString()} ${line}`
  console.log(msg)
  if (LOG_FILE) {
    mkdirSync(dirname(LOG_FILE), { recursive: true })
    appendFileSync(LOG_FILE, msg + '\n')
  }
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (entry.startsWith('._')) continue
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (extname(p) === '.json') out.push(p)
  }
  return out
}

function classifyWorkflow(wf) {
  const classes = Object.values(wf)
    .filter((n) => n && typeof n === 'object' && n.class_type)
    .map((n) => n.class_type)
  const isApi = classes.length > 0
  const hasVHS = classes.includes('VHS_VideoCombine')
  const hasAnim = classes.includes('SaveAnimatedWEBP') || classes.includes('SaveWEBM')
  const isI2V = classes.includes('LTXVImgToVideo') || classes.includes('ADE_InjectI2VIntoAnimateDiffModel')
  return { isApi, kind: hasVHS || hasAnim ? 'video' : 'image', isI2V }
}

async function uploadImage(filePath) {
  const { readFileSync: rf } = await import('fs')
  const buf = rf(filePath)
  const form = new FormData()
  form.append('image', new Blob([buf]), basename(filePath))
  form.append('type', 'input')
  form.append('overwrite', 'true')
  const res = await fetch(`${COMFYUI_URL}/upload/image`, { method: 'POST', body: form })
  const data = await res.json()
  if (data.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error))
  return data.name || basename(filePath)
}

async function submitWorkflow(wf) {
  const res = await fetch(`${COMFYUI_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: wf, client_id: 'run-all-workflows' }),
  })
  const data = await res.json()
  if (data.error) {
    const firstErr = data.node_errors
      ? Object.values(data.node_errors)[0]?.errors?.[0]?.message
      : null
    throw new Error(firstErr ? `${data.error.message}: ${firstErr}` : data.error.message)
  }
  return data.prompt_id
}

async function waitForCompletion(promptId) {
  const start = Date.now()
  while (Date.now() - start < perFileTimeoutMs) {
    const res = await fetch(`${COMFYUI_URL}/history/${promptId}`)
    const history = await res.json()
    const entry = history[promptId]
    if (entry) {
      const status = entry.status?.status_str || entry.status
      if (status === 'success') return { ok: true, outputs: entry.outputs || {} }
      if (status === 'error') {
        const msg = entry.status.messages?.find((m) => m[0] === 'execution_error')
        throw new Error(msg?.[1]?.exception_message || 'execution failed (see ComfyUI logs)')
      }
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error(`timed out after ${perFileTimeoutMs / 60000} min`)
}

function copyOutputs(entryOutputs, kind, fileLabel) {
  const copied = []
  const seen = new Set()
  const destBase = join(OUT_ROOT, kind === 'image' ? 'images' : 'videos')
  for (const nodeOutput of Object.values(entryOutputs)) {
    const items = [
      ...(nodeOutput.images || []).map((f) => ({ ...f, isVideo: kind === 'video' && !f.filename?.endsWith('.png') && !f.filename?.endsWith('.jpg') })),
      ...(nodeOutput.videos || []).map((f) => ({ ...f, isVideo: true })),
      ...(nodeOutput.gifs || []).map((f) => ({ ...f, isVideo: true })),
    ]
    for (const item of items) {
      if (!item?.filename || item.filename.startsWith('._')) continue
      const src = item.fullpath || join(COMFYUI_OUTPUT, item.subfolder || '', item.filename)
      if (!existsSync(src)) {
        log(`   ⚠️  missing file on disk: ${src}`)
        continue
      }
      const dest = join(destBase, item.subfolder || '', item.filename)
      if (seen.has(dest)) continue
      seen.add(dest)
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(src, dest)
      copied.push({ file: relative(OUT_ROOT, dest), src })
    }
  }
  if (copied.length === 0 && Object.keys(entryOutputs).length > 0) {
    log(`   ⚠️  ${fileLabel}: success but no ${kind} files found in history`)
  }
  return copied
}

function sendTelegram(subject, body) {
  const res = spawnSync(HERMES_BIN, ['send', '--to', 'telegram', '--subject', subject, body], {
    timeout: 30000,
    encoding: 'utf8',
  })
  if (res.status !== 0) {
    log(`   ⚠️  telegram notify failed (${res.status}): ${(res.stderr || res.stdout || '').trim().slice(0, 300)}`)
  } else {
    log('   📨 telegram notification sent')
  }
}

async function main() {
  const startedAt = new Date()
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-')
  log('─'.repeat(56))
  log(`ComfyUI batch runner — ${startedAt.toLocaleString()}`)
  log(`   workflows: ${WORKFLOWS_DIR}`)
  log(`   output:    ${OUT_ROOT}`)
  log(`   comfyui:   ${COMFYUI_URL}`)
  log('─'.repeat(56))

  if (!existsSync(WORKFLOWS_DIR)) {
    log(`❌ Workflows dir not found: ${WORKFLOWS_DIR}`)
    process.exit(1)
  }

  const files = walk(WORKFLOWS_DIR).sort()
  const plans = []
  const skipped = []

  for (const file of files) {
    let wf
    try {
      wf = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      skipped.push({ file, reason: `invalid JSON: ${e.message}` })
      continue
    }
    const { isApi, kind, isI2V } = classifyWorkflow(wf)
    const label = basename(file)
    if (!isApi) {
      skipped.push({ file, reason: 'UI-format JSON (no class_type) — load it in the ComfyUI UI instead' })
      continue
    }
    const kindMatches =
      only === 'all' ||
      only === kind ||
      (only === 'images' && kind === 'image') ||
      (only === 'videos' && kind === 'video')
    if (!kindMatches) {
      skipped.push({ file, reason: `kind=${kind} not in --only=${only}` })
      continue
    }
    if (pattern && !label.toLowerCase().includes(pattern)) {
      skipped.push({ file, reason: `does not match --pattern=${pattern}` })
      continue
    }
    if (isI2V && !i2vImage) {
      skipped.push({ file, reason: 'image-to-video workflow — pass --i2v-image=/path/to/frame.png to run it' })
      continue
    }
    plans.push({ file, kind, isI2V, wf })
  }

  log(`\nFound ${files.length} JSON files → ${plans.length} to run, ${skipped.length} skipped`)
  for (const p of plans) log(`   ▶ [${p.kind}] ${basename(p.file)}`)
  for (const s of skipped) log(`   ⏭  ${basename(s.file)} — ${s.reason}`)

  if (dryRun) {
    log('\nDry run — nothing submitted.')
    return
  }
  if (plans.length === 0) {
    log('Nothing to run.')
    process.exit(1)
  }

  if (i2vImage) {
    log(`\n📤 uploading first frame: ${i2vImage}`)
    const uploaded = await uploadImage(i2vImage)
    log(`   ✅ uploaded as ${uploaded}`)
    for (const p of plans) {
      if (!p.isI2V) continue
      for (const node of Object.values(p.wf)) {
        if (node?.class_type === 'LoadImage') node.inputs.image = uploaded
      }
    }
  }

  const results = []
  let imagesCopied = 0
  let videosCopied = 0

  for (const p of plans) {
    const label = basename(p.file)
    log(`\n▶ ${label} [${p.kind}]`)
    try {
      const promptId = await submitWorkflow(p.wf)
      log(`   ✅ queued — prompt_id: ${promptId}`)
      const { outputs } = await waitForCompletion(promptId)
      const copied = copyOutputs(outputs, p.kind, label)
      if (p.kind === 'image') imagesCopied += copied.length
      else videosCopied += copied.length
      results.push({
        file: p.file,
        kind: p.kind,
        status: 'ok',
        promptId,
        outputs: copied,
      })
    } catch (e) {
      log(`   ❌ ${e.message}`)
      results.push({ file: p.file, kind: p.kind, status: 'error', error: e.message })
    }
  }

  const finishedAt = new Date()
  const ok = results.filter((r) => r.status === 'ok').length
  const failed = results.filter((r) => r.status === 'error')
  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSec: Math.round((finishedAt - startedAt) / 1000),
    comfyuiUrl: COMFYUI_URL,
    outputRoot: OUT_ROOT,
    results,
    skipped: skipped.map((s) => ({ file: s.file, reason: s.reason })),
    summary: { ok, failed: failed.length, imagesCopied, videosCopied },
  }
  const reportDir = join(REPO_ROOT, 'logs')
  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, `comfyui-run-${stamp}.json`)
  writeFileSync(reportPath, JSON.stringify(report, null, 2))

  log('\n' + '─'.repeat(56))
  log(`Done in ${Math.round(report.durationSec / 60)} min — ${ok} ok, ${failed.length} failed`)
  log(`   images copied: ${imagesCopied} → ${join(OUT_ROOT, 'images')}`)
  log(`   videos copied: ${videosCopied} → ${join(OUT_ROOT, 'videos')}`)
  log(`   report: ${reportPath}`)
  for (const f of failed) log(`   ❌ ${basename(f.file)}: ${f.error}`)

  if (notify) {
    const subject = failed.length === 0 ? '✅ ComfyUI run finished' : '⚠️ ComfyUI run finished with errors'
    const body = [
      `${ok} workflows ok, ${failed.length} failed`,
      `images: ${imagesCopied} → ${join(OUT_ROOT, 'images')}`,
      `videos: ${videosCopied} → ${join(OUT_ROOT, 'videos')}`,
      ...(failed.length ? ['', 'Failed:'] + failed.map((f) => `• ${basename(f.file)}: ${f.error}`) : []),
      '', `report: ${reportPath}`,
    ].join('\n')
    sendTelegram(subject, body)
  }

  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  log(`❌ ${e.message}`)
  if (notify) sendTelegram('❌ ComfyUI run failed', e.message)
  process.exit(1)
})
