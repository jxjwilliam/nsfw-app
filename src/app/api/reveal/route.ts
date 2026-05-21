import { execFile } from 'child_process'
import { realpath } from 'fs/promises'
import path from 'path'

import { NextResponse } from 'next/server'

import { ensureJobHydrated, getJob } from '@/lib/jobs'
import { findRunByJobId } from '@/lib/output-store'

export async function GET(req: Request) {
  if (process.platform !== 'darwin') {
    return NextResponse.json(
      { error: 'reveal is only supported on macOS' },
      { status: 501 }
    )
  }

  const jobId = new URL(req.url).searchParams.get('jobId')
  if (!jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 })
  }

  await ensureJobHydrated(jobId)

  let rawDir = getJob(jobId)?.outputDir
  if (!rawDir) {
    const row = await findRunByJobId(jobId)
    rawDir = row?.outputDir
  }

  if (!rawDir) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  try {
    const outsRoot = await realpath(path.join(process.cwd(), 'outputs'))
    const targetDir = await realpath(path.resolve(rawDir))

    const prefix = outsRoot.endsWith(path.sep) ? outsRoot : outsRoot + path.sep
    if (
      !(targetDir === outsRoot || targetDir.startsWith(prefix))
    ) {
      return NextResponse.json({ error: 'invalid path' }, { status: 400 })
    }

    await execFile('/usr/bin/open', [targetDir], { cwd: process.cwd() })
    return NextResponse.json({ ok: true, path: targetDir })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'failed to open folder'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
