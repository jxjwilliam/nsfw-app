import { readFile } from 'fs/promises'
import path from 'path'

const OUTPUTS_BASE =
  process.env.VERCEL === '1' ? '/tmp' : process.cwd().replace(/\/$/, '')

import { NextResponse } from 'next/server'

import { ensureJobHydrated, getJob, getMeta } from '@/lib/jobs'
import { findRunByJobId } from '@/lib/output-store'
import { fetchR2Image, isR2Enabled } from '@/lib/r2'
import type { RunMetadata } from '@/lib/types'

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get('jobId')
  if (!jobId) {
    return new NextResponse('jobId required', { status: 400 })
  }

  await ensureJobHydrated(jobId)

  let dir = getJob(jobId)?.outputDir
  let row: (RunMetadata & { outputDir: string }) | null = null
  if (!dir) {
    row = await findRunByJobId(jobId)
    dir = row?.outputDir
  }

  if (!dir) {
    if (isR2Enabled()) {
      const r2Buf = await fetchR2Image(jobId)
      if (r2Buf) {
        return new NextResponse(new Uint8Array(r2Buf), {
          headers: { 'Content-Type': 'image/png' },
        })
      }
      console.error('R2 fallback miss for job', jobId)
    }
    return new NextResponse('Not found', { status: 404 })
  }

  const outsRoot = path.resolve(OUTPUTS_BASE, 'outputs')
  const resolvedDir = path.resolve(dir)
  if (!(resolvedDir === outsRoot || resolvedDir.startsWith(outsRoot + path.sep))) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const meta = getMeta(jobId) ?? row ?? undefined
  const file = meta?.videoFile ?? meta?.imageFile ?? 'image.png'
  const contentType = file.endsWith('.mp4') ? 'video/mp4' : 'image/png'

  try {
    const buf = await readFile(path.join(resolvedDir, file))
    return new NextResponse(buf, {
      headers: { 'Content-Type': contentType },
    })
  } catch {
    if (isR2Enabled()) {
      const r2Buf = await fetchR2Image(jobId)
      if (r2Buf) {
        return new NextResponse(new Uint8Array(r2Buf), {
          headers: { 'Content-Type': 'image/png' },
        })
      }
      console.error('R2 fallback miss for job', jobId)
    }
    return new NextResponse('Not found', { status: 404 })
  }
}
