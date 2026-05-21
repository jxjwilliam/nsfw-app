import { NextResponse } from 'next/server'

import {
  ensureJobHydrated,
  getJob,
  getMeta,
  setJob,
} from '@/lib/jobs'
import { finalizeFailed, finalizeSuccess } from '@/lib/output-store'
import { queryComfyOutputs } from '@/lib/runninghub-comfy'
import { queryTask, type QueryResponse } from '@/lib/runninghub'

export const maxDuration = 120

const MAX_POLLS = 60

function isTerminalFailure(q: QueryResponse): boolean {
  if (q.results?.[0]?.url) return false
  if (q.errorMessage || q.errorCode) return true
  const s = (q.status ?? '').toUpperCase()
  return s === 'FAILED' || s === 'FAILURE' || s === 'ERROR' || s.includes('FAIL')
}

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get('jobId')
  if (!jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 })
  }

  await ensureJobHydrated(jobId)

  const job = getJob(jobId)
  if (!job?.outputDir) {
    return NextResponse.json({ error: 'job not found' }, { status: 404 })
  }

  if (job.status === 'SUCCESS') {
    const meta = getMeta(jobId)
    return NextResponse.json({
      status: 'SUCCESS' as const,
      imageUrl: `/api/image?jobId=${encodeURIComponent(jobId)}`,
      outputPath: job.outputDir,
      usage: meta?.actualUsage,
    })
  }

  if (job.status === 'FAILED') {
    return NextResponse.json({
      status: 'FAILED' as const,
      errorMessage: job.errorMessage ?? 'failed',
    })
  }

  const pollCount = job.pollCount ?? 0

  const meta = getMeta(jobId)

  try {
    if (pollCount >= MAX_POLLS) {
      const m = meta
      if (!m) {
        return NextResponse.json(
          { status: 'FAILED' as const, errorMessage: 'metadata missing' },
          { status: 500 }
        )
      }

      await finalizeFailed(
        job.outputDir,
        m,
        'Timed out after maximum polling attempts (6 minutes)'
      )
      job.status = 'FAILED'
      job.errorMessage =
        'Timed out waiting for RunningHub task — try again later'
      setJob(job)
      return NextResponse.json({
        status: 'FAILED' as const,
        errorMessage: job.errorMessage,
      })
    }

    job.pollCount = pollCount + 1
    setJob(job)

    const mFinal = meta
    if (!mFinal) {
      return NextResponse.json(
        { error: 'metadata missing', status: 'FAILED' as const },
        { status: 500 }
      )
    }

    const isComfy = mFinal.apiMode === 'comfy'

    if (isComfy) {
      const comfy = await queryComfyOutputs(job.taskId)

      if (comfy.status === 'FAILED') {
        await finalizeFailed(
          job.outputDir,
          mFinal,
          comfy.errorMessage ?? 'ComfyUI task failed'
        )
        job.status = 'FAILED'
        job.errorMessage = comfy.errorMessage ?? 'task failed'
        setJob(job)
        return NextResponse.json({
          status: 'FAILED' as const,
          errorMessage: job.errorMessage,
        })
      }

      if (comfy.status === 'SUCCESS' && comfy.fileUrl) {
        await finalizeSuccess(job.outputDir, mFinal, comfy.fileUrl, comfy.raw ?? undefined)
        job.status = 'SUCCESS'
        job.errorMessage = undefined
        setJob(job)
        return NextResponse.json({
          status: 'SUCCESS' as const,
          imageUrl: `/api/image?jobId=${encodeURIComponent(jobId)}`,
          outputPath: job.outputDir,
        })
      }

      return NextResponse.json({
        status: 'RUNNING' as const,
        progress: Math.min(95, Math.round(((pollCount + 1) / MAX_POLLS) * 100)),
      })
    }

    const q = await queryTask(job.taskId)

    if (isTerminalFailure(q)) {
      await finalizeFailed(
        job.outputDir,
        mFinal,
        q.errorMessage || q.errorCode || q.status || 'task failed'
      )
      job.status = 'FAILED'
      job.errorMessage = q.errorMessage || 'task failed'
      setJob(job)
      return NextResponse.json({
        status: 'FAILED' as const,
        errorMessage: job.errorMessage,
      })
    }

    const url = q.results?.[0]?.url
    if (url) {
      await finalizeSuccess(job.outputDir, mFinal, url, q.usage)
      job.status = 'SUCCESS'
      job.errorMessage = undefined
      setJob(job)

      return NextResponse.json({
        status: 'SUCCESS' as const,
        imageUrl: `/api/image?jobId=${encodeURIComponent(jobId)}`,
        outputPath: job.outputDir,
        usage: q.usage ?? undefined,
      })
    }

    return NextResponse.json({
      status: 'RUNNING' as const,
      progress: Math.min(95, Math.round(((pollCount + 1) / MAX_POLLS) * 100)),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'query failed'

    try {
      if (meta && job.outputDir) {
        await finalizeFailed(job.outputDir, meta, msg)
      }
    } catch {
      /* persist best-effort */
    }

    job.status = 'FAILED'
    job.errorMessage = msg
    setJob(job)

    const httpStatus = msg.includes('RH_API_KEY') ? 503 : 502
    return NextResponse.json(
      { status: 'FAILED', errorMessage: msg },
      { status: httpStatus }
    )
  }
}
