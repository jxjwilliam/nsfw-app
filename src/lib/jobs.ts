import { readFile } from 'fs/promises'
import path from 'path'

import { findRunByJobId } from './output-store'
import type { JobRecord, PlanSnapshot, RunMetadata } from './types'
import { isKvEnabled, kvGet, kvSet } from './kv'

const JOB_KV_TTL_SECONDS = 60 * 60

export type HydratedPollState = JobRecord & { pollCount: number }

const jobs = new Map<string, HydratedPollState>()
const metaCache = new Map<string, RunMetadata>()

function kvJobKey(jobId: string): string {
  return `job:${jobId}`
}

/** Fire-and-forget mirror to KV so any serverless instance can resume a job. */
function persistJobState(jobId: string): void {
  if (!isKvEnabled()) return
  const job = jobs.get(jobId)
  if (!job) return
  const meta = metaCache.get(jobId)
  void kvSet(kvJobKey(jobId), { job, meta }, JOB_KV_TTL_SECONDS).catch((e) =>
    console.error('KV job persist failed', e)
  )
}

export function setJob(job: JobRecord & { pollCount?: number }): void {
  const prev = jobs.get(job.jobId)
  jobs.set(job.jobId, {
    pollCount: job.pollCount ?? prev?.pollCount ?? 0,
    ...job,
  })
  persistJobState(job.jobId)
}

/**
 * Set the job record and its metadata together, then persist once.
 *
 * Use this at job creation time (instead of calling setJob() followed by
 * setMeta()) whenever both are known at once. setJob() and setMeta() each
 * fire their own independent, unawaited KV write to the SAME key — if two
 * separate writes are in flight for a brand-new job, whichever one lands
 * last on the KV server wins, and the earlier setJob() call always writes
 * `meta: undefined` (since metaCache hasn't been populated yet at that
 * point). That race intermittently overwrites a good record with one
 * missing metadata, which later poll-time code reports as
 * "metadata missing" (500). Writing both fields before the single
 * persistJobState() call removes the race entirely.
 */
export function setJobAndMeta(
  job: JobRecord & { pollCount?: number },
  meta: RunMetadata
): void {
  const prev = jobs.get(job.jobId)
  jobs.set(job.jobId, {
    pollCount: job.pollCount ?? prev?.pollCount ?? 0,
    ...job,
  })
  metaCache.set(job.jobId, meta)
  persistJobState(job.jobId)
}

export function getJob(jobId: string): HydratedPollState | undefined {
  return jobs.get(jobId)
}

/**
 * Recover job/task/outputDir from outputs/** after restart or cold cache (image/status/reveal).
 */
export async function ensureJobHydrated(jobId: string): Promise<boolean> {
  if (jobs.has(jobId)) return true

  if (isKvEnabled()) {
    try {
      const state = await kvGet<{
        job?: JobRecord
        meta?: RunMetadata
      }>(kvJobKey(jobId))
      if (state?.job) {
        setJob({ pollCount: 0, ...state.job })
        if (state.meta) setMeta(jobId, state.meta)
        return true
      }
    } catch (e) {
      console.error('KV job hydrate failed', e)
    }
  }

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

  setJobAndMeta(
    {
      jobId,
      planId,
      taskId: metaRest.taskId,
      status: jobStatus,
      createdAt: metaRest.createdAt,
      outputDir,
      errorMessage: metaRest.errorMessage,
    },
    metaRest
  )

  return true
}

export function setMeta(jobId: string, meta: RunMetadata): void {
  metaCache.set(jobId, meta)
  persistJobState(jobId)
}

export function getMeta(jobId: string): RunMetadata | undefined {
  return metaCache.get(jobId)
}
