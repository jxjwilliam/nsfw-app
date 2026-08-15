import { mkdir, writeFile, readFile, readdir } from 'fs/promises'
import type { Dirent } from 'fs'
import path from 'path'
import type { MediaType, PlanSnapshot, RunMetadata } from './types'
import { downloadImage } from './runninghub'
import { isR2Enabled, uploadR2Image } from './r2'

const OUTPUTS_BASE =
  process.env.VERCEL === '1' ? '/tmp' : process.cwd().replace(/\/$/, '')

function outputsRoot(): string {
  return path.join(OUTPUTS_BASE, 'outputs')
}

function isVisibleEntry(name: string): boolean {
  return !name.startsWith('.')
}

const DAY_DIR_RE = /^\d{4}-\d{2}-\d{2}$/

async function listDayDirs(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  return entries
    .filter((e: Dirent) => e.isDirectory() && DAY_DIR_RE.test(e.name))
    .map((e) => e.name)
}

function mediaSubdir(mediaType: MediaType): string {
  return mediaType === 'video' ? 'video' : 'images'
}

async function listJobDirs(dayPath: string): Promise<string[]> {
  const entries = await readdir(dayPath, { withFileTypes: true })
  return entries
    .filter((e: Dirent) => e.isDirectory() && isVisibleEntry(e.name))
    .map((e) => e.name)
}

export function outputDirForJob(
  jobId: string,
  mediaType: MediaType = 'image',
  root = outputsRoot()
): string {
  return path.join(root, mediaSubdir(mediaType), jobId)
}

export async function initJobDir(
  jobId: string,
  plan: PlanSnapshot,
  taskId: string,
  root = outputsRoot()
): Promise<string> {
  const mediaType = plan.mediaType ?? 'image'
  const dir = outputDirForJob(jobId, mediaType, root)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2))
  const meta: RunMetadata = {
    jobId,
    taskId,
    createdAt: new Date().toISOString(),
    apiMode: plan.mode ?? (plan.route.startsWith('comfyui') ? 'comfy' : 'standard'),
    mediaType,
    prompt: plan.originalPrompt,
    enhancedPrompt: plan.params.prompt,
    style: plan.request.style,
    aspectRatio: plan.request.aspectRatio,
    qualityTier: plan.request.qualityTier,
    route: plan.route,
    modelLabel: plan.modelLabel,
    estimatedPrice: plan.estimatedPrice,
    status: 'RUNNING',
  }
  await writeFile(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2))
  return dir
}

export async function finalizeSuccess(
  dir: string,
  meta: RunMetadata,
  fileUrl: string,
  usage?: Record<string, unknown> | null
): Promise<void> {
  const buf = await downloadImage(fileUrl)
  const isVideo = meta.mediaType === 'video'
  const file = isVideo ? 'video.mp4' : 'image.png'
  // The poll that resolves SUCCESS can land on a different serverless
  // instance than the one that ran initJobDir() — KV now restores the job
  // record (see jobs.ts) across instances, but not the actual /tmp
  // directory that instance never created. Recreate it before writing,
  // the same way finalizeFailed() already does below.
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, file), buf)
  meta.status = 'SUCCESS'
  if (isVideo) {
    meta.videoFile = file
  } else {
    meta.imageFile = file
  }
  meta.actualUsage = usage ?? undefined
  await writeFile(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2))

  // Cloud (Vercel) only: mirror the image to R2 so the run survives a cold
  // start wiping /tmp. Local dev never reaches this branch. (Video jobs are
  // local-only, so the mirror effectively applies to images only.)
  if (isR2Enabled()) {
    let persistError: string | undefined
    try {
      await uploadR2Image(meta.jobId, buf)
    } catch (e) {
      persistError = e instanceof Error ? e.message : String(e)
    }
    if (persistError) {
      meta.persistError = persistError
      // Keep the locally visible record in sync even when the mirror failed.
      await writeFile(
        path.join(dir, 'metadata.json'),
        JSON.stringify(meta, null, 2)
      )
    }
  }
}

export async function finalizeFailed(
  dir: string,
  meta: RunMetadata,
  errorMessage: string
): Promise<void> {
  await mkdir(dir, { recursive: true })
  meta.status = 'FAILED'
  meta.errorMessage = errorMessage
  await writeFile(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2))
}

async function scanJobDir(
  dir: string
): Promise<(RunMetadata & { outputDir: string }) | null> {
  try {
    const raw = await readFile(path.join(dir, 'metadata.json'), 'utf-8')
    const meta = JSON.parse(raw) as RunMetadata
    return { ...meta, outputDir: dir }
  } catch {
    return null
  }
}

async function scanParent(
  parentPath: string
): Promise<Array<RunMetadata & { outputDir: string }>> {
  const out: Array<RunMetadata & { outputDir: string }> = []
  let names: string[]
  try {
    names = await listJobDirs(parentPath)
  } catch {
    return out
  }
  for (const name of names) {
    if (name === 'raw') continue
    const hit = await scanJobDir(path.join(parentPath, name))
    if (hit) out.push(hit)
  }
  return out
}

export async function listHistory(
  limit = 50,
  root = outputsRoot()
): Promise<Array<RunMetadata & { outputDir: string }>> {
  const entries: Array<RunMetadata & { outputDir: string }> = []
  entries.push(...(await scanParent(path.join(root, 'images'))))
  entries.push(...(await scanParent(path.join(root, 'video'))))
  try {
    const days = await listDayDirs(root)
    for (const day of days) {
      entries.push(...(await scanParent(path.join(root, day))))
    }
  } catch {
    /* no readable root */
  }
  return entries
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

/** Direct lookup — avoids scanning full history (and survives exFAT AppleDouble junk). */
export async function findRunDirByJobId(
  jobId: string,
  root = outputsRoot()
): Promise<string | null> {
  const mediaDirs = [
    path.join(root, 'images', jobId),
    path.join(root, 'video', jobId),
  ]
  for (const dir of mediaDirs) {
    try {
      await readFile(path.join(dir, 'metadata.json'), 'utf-8')
      return dir
    } catch {
      /* try next */
    }
  }
  try {
    const days = (await listDayDirs(root)).sort().reverse()
    for (const day of days) {
      const dir = path.join(root, day, jobId)
      try {
        await readFile(path.join(dir, 'metadata.json'), 'utf-8')
        return dir
      } catch {
        /* try next day */
      }
    }
  } catch {
    return null
  }
  return null
}

export async function findRunByJobId(
  jobId: string,
  limit = 500
): Promise<(RunMetadata & { outputDir: string }) | null> {
  const outputDir = await findRunDirByJobId(jobId)
  if (outputDir) {
    try {
      const raw = await readFile(path.join(outputDir, 'metadata.json'), 'utf-8')
      const meta = JSON.parse(raw) as RunMetadata
      return { ...meta, outputDir }
    } catch {
      return null
    }
  }

  const entries = await listHistory(limit)
  return entries.find((e) => e.jobId === jobId) ?? null
}