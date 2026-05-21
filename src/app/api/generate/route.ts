import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import path from 'path'

import { NextResponse } from 'next/server'

import { setJob, setMeta } from '@/lib/jobs'
import { initJobDir } from '@/lib/output-store'
import { loadPlan } from '@/lib/plans'
import { submitComfyTask } from '@/lib/runninghub-comfy'
import { submitTask } from '@/lib/runninghub'
import type { RunMetadata } from '@/lib/types'

export async function POST(req: Request) {
  try {
    const { planId } = (await req.json()) as { planId?: unknown }
    if (typeof planId !== 'string' || !planId.trim()) {
      return NextResponse.json({ error: 'planId is required' }, { status: 400 })
    }

    const plan = await loadPlan(planId.trim())
    if (!plan) {
      return NextResponse.json(
        { error: 'plan expired or not found' },
        { status: 404 }
      )
    }

    let taskId: string

    if (plan.mode === 'comfy' && plan.workflowId && plan.nodeInfoList) {
      const comfy = await submitComfyTask(plan.workflowId, plan.nodeInfoList)
      taskId = comfy.taskId
    } else {
      const result = await submitTask(plan.route, plan.params)
      if (result.errorMessage || !result.taskId) {
        return NextResponse.json(
          { error: result.errorMessage ?? 'submit failed' },
          { status: 502 }
        )
      }
      taskId = result.taskId
    }

    const jobId = randomUUID()
    const outputDir = await initJobDir(jobId, plan, taskId)
    const metaRaw = await readFile(
      path.join(outputDir, 'metadata.json'),
      'utf-8'
    )
    const meta = JSON.parse(metaRaw) as RunMetadata

    setJob({
      jobId,
      planId: plan.planId,
      taskId,
      status: 'RUNNING',
      createdAt: new Date().toISOString(),
      outputDir,
    })
    setMeta(jobId, meta)

    return NextResponse.json({
      jobId,
      taskId,
      status: 'RUNNING' as const,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'generate failed'
    const hint =
      message.includes('RH_API_KEY') ?
        ` — configure RH_API_KEY in .env.local`
      : ''

    const status =
      message.includes('RH_API_KEY')
        ? 503
        : message.includes('submit failed')
          ? 502
          : 500

    return NextResponse.json({ error: message + hint }, { status })
  }
}
