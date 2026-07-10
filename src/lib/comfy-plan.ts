import { randomUUID } from 'crypto'

import { enhancePrompt } from './router'
import type { NodeInfo } from './runninghub-comfy'
import { getWorkflowConfig } from './workflow-config'
import type { PlanRequest, QualityTier } from './types'
import { savePlan } from './plans'

const SIZE_BY_RATIO: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1344, height: 768 },
  '9:16': { width: 768, height: 1344 },
  '2:3': { width: 832, height: 1216 },
  '3:2': { width: 1216, height: 832 },
  '4:3': { width: 1152, height: 896 },
  '3:4': { width: 896, height: 1152 },
}

const STEPS_BY_TIER: Record<QualityTier, number> = {
  low: 18,
  medium: 25,
  high: 32,
}

const CFG_BY_TIER: Record<QualityTier, number> = {
  low: 7,
  medium: 7.5,
  high: 8,
}

const DEFAULT_NEGATIVE =
  'low quality, blurry, watermark, text, bad anatomy, deformed'

export function resolveDimensions(aspectRatio: string): { width: number; height: number } {
  return SIZE_BY_RATIO[aspectRatio] ?? SIZE_BY_RATIO['1:1']
}

export function buildComfyNodeInfoList(
  request: PlanRequest,
  enhancedPrompt: string,
  cfg = getWorkflowConfig()
): NodeInfo[] {
  if (!cfg) throw new Error('RH_WORKFLOW_ID is not configured')

  const { width, height } = resolveDimensions(request.aspectRatio)
  const steps = STEPS_BY_TIER[request.qualityTier]
  const cfgScale = CFG_BY_TIER[request.qualityTier]
  const seed = String(Math.floor(Math.random() * 2 ** 32))

  const { nodes } = cfg
  return [
    { nodeId: nodes.prompt, fieldName: 'text', fieldValue: enhancedPrompt },
    { nodeId: nodes.negative, fieldName: 'text', fieldValue: DEFAULT_NEGATIVE },
    { nodeId: nodes.size, fieldName: 'width', fieldValue: String(width) },
    { nodeId: nodes.size, fieldName: 'height', fieldValue: String(height) },
    { nodeId: nodes.sampler, fieldName: 'steps', fieldValue: String(steps) },
    { nodeId: nodes.sampler, fieldName: 'cfg', fieldValue: String(cfgScale) },
    { nodeId: nodes.sampler, fieldName: 'seed', fieldValue: seed },
  ]
}

export async function createComfyPlan(request: PlanRequest) {
  const wf = getWorkflowConfig()
  if (!wf) {
    throw new Error(
      'RH_WORKFLOW_ID is not set. Import workflows/sdxl-txt2img-api.json on RunningHub, then add the workflow ID from the URL to .env.local (see workflows/README.md).'
    )
  }
  const enhanced = enhancePrompt(request.prompt, request.style)
  const nodeInfoList = buildComfyNodeInfoList(request, enhanced, wf)
  const planId = randomUUID()

  const snapshot = {
    planId,
    createdAt: new Date().toISOString(),
    request,
    mode: 'comfy' as const,
    route: 'comfyui/workflow',
    modelId: 'comfy-workflow',
    modelLabel: 'ComfyUI workflow (RH_WORKFLOW_ID)',
    workflowId: wf.workflowId,
    nodeInfoList,
    params: {
      prompt: enhanced,
      aspectRatio: request.aspectRatio,
      resolution: 'workflow',
      quality: request.qualityTier,
    },
    originalPrompt: request.prompt,
    estimatedPrice: 0,
    currency: 'CNY',
    reason: `${request.style} + ${request.qualityTier} → ComfyUI workflow ${wf.workflowId} (no G-2 content filter; price shown at billing)`,
    alternatives: [] as Array<{
      modelId: string
      modelLabel: string
      route: string
      estimatedPrice: number
      reason: string
    }>,
  }

  await savePlan(snapshot)
  return snapshot
}
