import { mkdir, writeFile, readFile, readdir } from 'fs/promises'
import path from 'path'
import type { PlanSnapshot, RunMetadata } from './types'
import { downloadImage } from './runninghub'

export function outputDirForJob(jobId: string): string {
  const day = new Date().toISOString().slice(0, 10)
  return path.join(process.cwd(), 'outputs', day, jobId)
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
  const buf = await downloadImage(imageUrl)
  await writeFile(path.join(dir, 'image.png'), buf)
  meta.status = 'SUCCESS'
  meta.imageFile = 'image.png'
  meta.actualUsage = usage ?? undefined
  await writeFile(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2))
}

export async function finalizeFailed(
  dir: string,
  meta: RunMetadata,
  errorMessage: string
): Promise<void> {
  meta.status = 'FAILED'
  meta.errorMessage = errorMessage
  await writeFile(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2))
}

export async function listHistory(
  limit = 50
): Promise<Array<RunMetadata & { outputDir: string }>> {
  const root = path.join(process.cwd(), 'outputs')
  const entries: Array<RunMetadata & { outputDir: string }> = []
  try {
    const days = await readdir(root)
    for (const day of days) {
      const dayPath = path.join(root, day)
      const jobs = await readdir(dayPath)
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

export async function findRunByJobId(
  jobId: string,
  limit = 500
): Promise<(RunMetadata & { outputDir: string }) | null> {
  const entries = await listHistory(limit)
  return entries.find((e) => e.jobId === jobId) ?? null
}
