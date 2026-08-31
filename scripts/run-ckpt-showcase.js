#!/usr/bin/env node
/**
 * CKPT showcase runner (2026-08-30)
 *
 * Submits every workflow from local-comfyui/workflows/showcase-2026-08-30/
 * to the local ComfyUI API sequentially, polls each prompt to completion, and
 * copies the finished PNGs to outputs/images/ckpt-showcase-2026-08-30/<slug>.png.
 *
 * Usage:
 *   node scripts/run-ckpt-showcase.js
 *   COMFYUI_URL=http://127.0.0.1:8188 node scripts/run-ckpt-showcase.js
 */

import { readFileSync, readdirSync, copyFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188'
const WORKFLOWS_DIR = join(__dirname, '..', 'local-comfyui', 'workflows', 'showcase-2026-08-30')
const COMFYUI_OUTPUT = process.env.COMFYUI_OUTPUT || '/Volumes/SamsungT7/pinokio/api/comfy.git/app/output'
const DEST_DIR = join(__dirname, '..', 'outputs', 'images', 'ckpt-showcase-2026-08-30')
const POLL_MS = 15000
const MAX_WAIT_MS = 90 * 60 * 1000

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function submit(workflow) {
  const res = await fetch(`${COMFYUI_URL}/api/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  })
  return res.json()
}

async function fetchHistory(promptId) {
  const res = await fetch(`${COMFYUI_URL}/history/${promptId}`)
  if (!res.ok) return null
  return res.json()
}

async function main() {
  const files = readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.api.json'))
    .sort()

  if (files.length === 0) {
    console.error(`No .api.json workflows found in ${WORKFLOWS_DIR}`)
    process.exit(1)
  }

  console.log(`🎨 CKPT showcase runner`)
  console.log(`   URL: ${COMFYUI_URL}`)
  console.log(`   Workflows: ${files.length}`)
  console.log('─'.repeat(50))

  const jobs = []
  const failures = []

  for (const file of files) {
    const slug = basename(file, '.api.json').replace(/^ckpt_/, '')
    const workflow = JSON.parse(readFileSync(join(WORKFLOWS_DIR, file), 'utf-8'))
    console.log(`\n📤 Submitting: ${file}  (${slug})`)
    try {
      const result = await submit(workflow)
      if (result.prompt_id) {
        console.log(`   ✅ Queued! Prompt ID: ${result.prompt_id}`)
        jobs.push({ slug, file, promptId: result.prompt_id, status: 'pending', error: null })
      } else {
        const msg = result?.error?.message || JSON.stringify(result)
        console.error(`   ❌ Rejected: ${msg}`)
        failures.push({ slug, error: msg })
      }
    } catch (err) {
      console.error(`   ❌ Submit failed: ${err.message}`)
      failures.push({ slug, error: err.message })
    }
    await sleep(2000)
  }

  console.log('─'.repeat(50))
  console.log(`\n📊 Queued: ${jobs.length}/${files.length}`)
  if (failures.length > 0) {
    console.log(`⚠️  Rejected at submit time: ${failures.length}`)
    for (const f of failures) console.log(`   - ${f.slug}: ${f.error}`)
  }

  // Poll all queued prompts until they finish (or timeout)
  const start = Date.now()
  while (jobs.some((j) => j.status === 'pending') && Date.now() - start < MAX_WAIT_MS) {
    for (const j of jobs.filter((x) => x.status === 'pending')) {
      try {
        const h = await fetchHistory(j.promptId)
        const entry = h?.[j.promptId]
        if (entry?.status?.status_str) {
          j.status = entry.status.status_str
          if (j.status === 'error') {
            const msgs = entry.status.messages || []
            j.error = msgs
              .filter((m) => Array.isArray(m) && m[0] === 'execution_error')
              .map((m) => m[1]?.exception_message || 'execution error')
              .join(' | ')
          }
        }
      } catch (err) {
        // transient history read error — keep polling
      }
    }
    const running = jobs.filter((j) => j.status === 'pending').length
    const done = jobs.length - running
    console.log(
      `   ⏳ ${done}/${jobs.length} done, ${running} still running (elapsed ${Math.round((Date.now() - start) / 60000)} min)`
    )
    if (running > 0) await sleep(POLL_MS)
  }

  // Copy outputs
  mkdirSync(DEST_DIR, { recursive: true })
  let copied = 0
  console.log(`\n📁 Copying outputs → ${DEST_DIR}`)

  for (const j of jobs) {
    if (j.status !== 'success') {
      console.log(`   - ${j.slug}: ${j.status || 'timed out'}${j.error ? ` (${j.error})` : ''}`)
      continue
    }
    const h = await fetchHistory(j.promptId)
    const entry = h?.[j.promptId]
    const images = Object.values(entry?.outputs || {}).flatMap((o) => o?.images || [])
    const png = images.find((img) => String(img.filename).endsWith('.png')) || images[0]
    if (!png) {
      console.log(`   - ${j.slug}: success but no image in history`)
      continue
    }
    const srcPath = join(COMFYUI_OUTPUT, png.subfolder || '', png.filename)
    const destPath = join(DEST_DIR, `${j.slug}.png`)
    if (existsSync(srcPath)) {
      copyFileSync(srcPath, destPath)
      console.log(`   ✅ ${j.slug} → ${destPath}`)
      copied++
    } else {
      console.log(`   ⚠️ ${j.slug}: source missing ${srcPath}`)
    }
  }

  console.log(`\n✅ Copied ${copied}/${jobs.length} images`)
  if (failures.length > 0 || jobs.some((j) => j.status !== 'success')) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
