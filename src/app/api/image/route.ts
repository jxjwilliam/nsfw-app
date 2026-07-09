import { readFile } from 'fs/promises'
import path from 'path'

const OUTPUTS_BASE =
  process.env.VERCEL === '1' ? '/tmp' : process.cwd().replace(/\/$/, '')

import { NextResponse } from 'next/server'

import { ensureJobHydrated, getJob } from '@/lib/jobs'
import { findRunByJobId } from '@/lib/output-store'

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get('jobId')
  if (!jobId) {
    return new NextResponse('jobId required', { status: 400 })
  }

  await ensureJobHydrated(jobId)

  let dir = getJob(jobId)?.outputDir
  if (!dir) {
    const row = await findRunByJobId(jobId)
    dir = row?.outputDir
  }

  if (!dir) {
    return new NextResponse('Not found', { status: 404 })
  }

  const outsRoot = path.resolve(OUTPUTS_BASE, 'outputs')
  const resolvedDir = path.resolve(dir)
  if (!(resolvedDir === outsRoot || resolvedDir.startsWith(outsRoot + path.sep))) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const buf = await readFile(path.join(resolvedDir, 'image.png'))
    return new NextResponse(buf, {
      headers: { 'Content-Type': 'image/png' },
    })
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
}
