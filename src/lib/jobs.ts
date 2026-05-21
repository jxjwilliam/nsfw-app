import type { JobRecord, RunMetadata } from './types'

const jobs = new Map<string, JobRecord>()
const metaCache = new Map<string, RunMetadata>()

export function setJob(job: JobRecord): void {
  jobs.set(job.jobId, job)
}

export function getJob(jobId: string): JobRecord | undefined {
  return jobs.get(jobId)
}

export function setMeta(jobId: string, meta: RunMetadata): void {
  metaCache.set(jobId, meta)
}

export function getMeta(jobId: string): RunMetadata | undefined {
  return metaCache.get(jobId)
}
