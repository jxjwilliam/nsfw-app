import { NextResponse } from 'next/server'

import {
  getWorkflowJson,
  listEditableNodesFromPromptJson,
} from '@/lib/runninghub-comfy'
import { formatComfyUiError } from '@/lib/runninghub-errors'
import { getWorkflowConfig, getWorkflowId } from '@/lib/workflow-config'

export async function GET() {
  try {
    const workflowId = getWorkflowId()
    if (!workflowId) {
      return NextResponse.json({
        ok: false,
        error:
          'RH_WORKFLOW_ID is not set. See workflows/README.md to import sdxl-txt2img-api.json on RunningHub.',
      })
    }

    const promptJson = await getWorkflowJson(workflowId)
    const nodes = listEditableNodesFromPromptJson(promptJson)
    const cfg = getWorkflowConfig()

    return NextResponse.json({
      ok: true,
      workflowId,
      nodeMapping: cfg?.nodes,
      nodes,
      hint: 'Set RH_WORKFLOW_ID in .env.local after importing workflows/sdxl-txt2img-api.json on RunningHub.',
    })
  } catch (e) {
    const raw = e instanceof Error ? e.message : 'workflow setup failed'
    const message = formatComfyUiError(raw)
    const status = message.includes('RH_API_KEY') ? 503 : 502
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
