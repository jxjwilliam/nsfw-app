import { mkdir, writeFile, readFile, readdir } from 'fs/promises'
import type { Dirent } from 'fs'
import path from 'path'
import type { PlanSnapshot, RunMetadata } from './types'
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

async function listDayDirs(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  return entries
    .filter((e: Dirent) => e.isDirectory() && isVisibleEntry(e.name))
    .map((e) => e.name)
}

async function listJobDirs(dayPath: string): Promise<string[]> {
  const entries = await readdir(dayPath, { withFileTypes: true })
  return entries
    .filter((e: Dirent) => e.isDirectory() && isVisibleEntry(e.name))
    .map((e) => e.name)
}

export function outputDirForJob(jobId: string): string {
  const day = new Date().toISOString().slice(0, 10)
  return path.join(outputsRoot(), day, jobId)
}

export async function initJobDir(
  jobId: string,
  plan: PlanSnapshot,
  taskId: string
): Promise<string> {
  const dir = outputDirForJob(jobId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2))
  const meta: RunMetadata = {
    jobId,
    taskId,
    createdAt: new Date().toISOString(),
    apiMode: plan.mode ?? (plan.route.startsWith('comfyui') ? 'comfy' : 'standard'),
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
  imageUrl: string,
  usage?: Record<string, unknown> | null
): Promise<void> {
  await mkdir(dir, { recursive: true })
  const buf = await downloadImage(imageUrl)
  await writeFile(path.join(dir, 'image.png'), buf)
  meta.status = 'SUCCESS'
  meta.imageFile = 'image.png'
  meta.actualUsage = usage ?? undefined
  await writeFile(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2))

  // Cloud (Vercel) only: mirror the image to R2 so the run survives a cold
  // start wiping /tmp. Local dev never reaches this branch.
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

export async function listHistory(
  limit = 50
): Promise<Array<RunMetadata & { outputDir: string }>> {
  const root = outputsRoot()
  const entries: Array<RunMetadata & { outputDir: string }> = []
  try {
    const days = await listDayDirs(root)
    for (const day of days) {
      const dayPath = path.join(root, day)
      const jobs = await listJobDirs(dayPath)
      for (const jobId of jobs) {
        const metaPath = path.join(dayPath, jobId, 'metadata.json')
        try {
          const raw = await readFile(metaPath, 'utf-8')
          const meta = JSON.parse(raw) as RunMetadata
          entries.push({ ...meta, outputDir: path.join(dayPath, jobId) })
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    return []
  }
  return entries
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

/** Direct lookup — avoids scanning full history (and survives exFAT AppleDouble junk). */
export async function findRunDirByJobId(jobId: string): Promise<string | null> {
  const root = outputsRoot()
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
