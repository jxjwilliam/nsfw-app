import { randomUUID } from 'crypto'

import { DEFAULT_NEGATIVE, resolveDimensions } from './comfy-plan'
import { pingComfy } from './local-comfy'
import { savePlan } from './plans'
import { enhancePrompt } from './router'
import type { PlanRequest, PlanSnapshot, QualityTier, Style } from './types'

export type CheckpointSpec = {
  file: string
  prefix: string
  steps: number
  cfg: number
  negativeExtra: string
}

const CHECKPOINT_BY_STYLE: Record<Style, string> = {
  anime: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
  hentai: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
  hassaku: 'iniverseMixSFWNSFW_realXLV1.safetensors',
  realistic: 'juggernautXL_ragnarokBy.safetensors',
}

const SPEC_BY_FILE: Record<string, CheckpointSpec> = {
  'ponyDiffusionV6XL_v6StartWithThisOne.safetensors': {
    file: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
    prefix: 'score_9, score_8_up, score_7_up, score_6_up, ',
    steps: 28,
    cfg: 7.5,
    negativeExtra: 'score_4, score_3, score_2, score_1',
  },
  'iniverseMixSFWNSFW_realXLV1.safetensors': {
    file: 'iniverseMixSFWNSFW_realXLV1.safetensors',
    prefix: '',
    steps: 28,
    cfg: 6.5,
    negativeExtra: '',
  },
  'juggernautXL_ragnarokBy.safetensors': {
    file: 'juggernautXL_ragnarokBy.safetensors',
    prefix: 'masterpiece, best quality, photorealistic, ',
    steps: 28,
    cfg: 6.5,
    negativeExtra: '',
  },
}

export function resolveCheckpoint(style: Style): CheckpointSpec {
  const override = process.env[`LOCAL_CKPT_${style.toUpperCase()}`]?.trim()
  const file = override || CHECKPOINT_BY_STYLE[style]
  return (
    SPEC_BY_FILE[file] ?? {
      file,
      prefix: '',
      steps: 28,
      cfg: 7,
      negativeExtra: '',
    }
  )
}

export function stepsForTier(spec: CheckpointSpec, tier: QualityTier): number {
  const base = spec.steps
  const steps = tier === 'low' ? base - 10 : tier === 'high' ? base + 6 : base
  return Math.max(4, steps)
}

export function buildLocalWorkflow(
  request: PlanRequest,
  enhancedPrompt: string
): Record<string, unknown> {
  const spec = resolveCheckpoint(request.style)
  const { width, height } = resolveDimensions(request.aspectRatio)
  const steps = stepsForTier(spec, request.qualityTier)
  const seed = Math.floor(Math.random() * 2 ** 32)
  const negative = [DEFAULT_NEGATIVE, spec.negativeExtra]
    .filter(Boolean)
    .join(', ')

  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        scheduler: 'karras',
        negative: ['7', 0],
        denoise: 1,
        latent_image: ['5', 0],
        seed,
        cfg: spec.cfg,
        sampler_name: 'dpmpp_2m',
        model: ['4', 0],
        positive: ['6', 0],
        steps,
      },
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: spec.file },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { batch_size: 1, width, height },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: `${spec.prefix}${enhancedPrompt}`, clip: ['4', 1] },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negative, clip: ['4', 1] },
    },
    '37': {
      class_type: 'VAEDecode',
      inputs: { vae: ['4', 2], samples: ['3', 0] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: `nsfw-app-${request.style}`,
        images: ['37', 0],
      },
    },
  }
}

export async function createLocalPlan(
  request: PlanRequest
): Promise<PlanSnapshot> {
  await pingComfy()

  const spec = resolveCheckpoint(request.style)
  const enhanced = enhancePrompt(request.prompt, request.style)
  const graph = buildLocalWorkflow(request, enhanced)
  const planId = randomUUID()

  const snapshot: PlanSnapshot = {
    planId,
    createdAt: new Date().toISOString(),
    request,
    mode: 'local-comfy',
    route: 'local/comfyui',
    modelId: spec.file,
    modelLabel: `Local ComfyUI (${spec.file.replace('.safetensors', '')})`,
    localGraph: graph,
    params: {
      prompt: `${spec.prefix}${enhanced}`.trim(),
      aspectRatio: request.aspectRatio,
      resolution: 'workflow',
      quality: request.qualityTier,
    },
    originalPrompt: request.prompt,
    estimatedPrice: 0,
    currency: 'CNY',
    reason: `${request.style} + ${request.qualityTier} → local ComfyUI (${spec.file}) — no cloud content filter, no cost`,
    alternatives: [],
  }

  await savePlan(snapshot)
  return snapshot
}