import { readFile } from 'fs/promises'
import path from 'path'

import { findRunByJobId } from './output-store'
import type { JobRecord, PlanSnapshot, RunMetadata } from './types'

export type HydratedPollState = JobRecord & { pollCount: number }

const jobs = new Map<string, HydratedPollState>()
const metaCache = new Map<string, RunMetadata>()

export function setJob(job: JobRecord): void {
  const prev = jobs.get(job.jobId)
  jobs.set(job.jobId, {
    pollCount: prev?.pollCount ?? 0,
    ...job,
  })
}

export function getJob(jobId: string): HydratedPollState | undefined {
  return jobs.get(jobId)
}

/**
 * Recover job/task/outputDir from outputs/** after restart or cold cache (image/status/reveal).
 */
export async function ensureJobHydrated(jobId: string): Promise<boolean> {
  if (jobs.has(jobId)) return true

  const found = await findRunByJobId(jobId)
  if (!found) return false

  const { outputDir, ...metaRest } = found
  let planId = ''
  try {
    const raw = await readFile(path.join(outputDir, 'plan.json'), 'utf-8')
    const plan = JSON.parse(raw) as PlanSnapshot
    planId = plan.planId
  } catch {
    planId = ''
  }

  const jobStatus =
    metaRest.status === 'SUCCESS'
      ? 'SUCCESS'
      : metaRest.status === 'FAILED'
        ? 'FAILED'
        : 'RUNNING'

  setJob({
    jobId,
    planId,
    taskId: metaRest.taskId,
    status: jobStatus,
    createdAt: metaRest.createdAt,
    outputDir,
    errorMessage: metaRest.errorMessage,
  })
  setMeta(jobId, metaRest)

  return true
}

export function setMeta(jobId: string, meta: RunMetadata): void {
  metaCache.set(jobId, meta)
}

export function getMeta(jobId: string): RunMetadata | undefined {
  return metaCache.get(jobId)
}
