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

export const VIDEO_DEFAULT_CKPT = 'realisticVisionV51_v51VAE.safetensors'
export const VIDEO_DEFAULT_MOTION = 'mm_sd_v15_v2.ckpt'
const VIDEO_PROMPT_PREFIX = 'masterpiece, best quality, photorealistic, '
const VIDEO_NEGATIVE_EXTRA = 'static, no motion, flickering, jumpy motion, lowres'
const VIDEO_FPS = 8

const VIDEO_TIER: Record<QualityTier, { frames: number; steps: number }> = {
  low: { frames: 16, steps: 16 },
  medium: { frames: 24, steps: 20 },
  high: { frames: 32, steps: 24 },
}

export function resolveVideoDimensions(aspectRatio: string): {
  width: number
  height: number
} {
  if (aspectRatio === '1:1') return { width: 512, height: 512 }
  if (['9:16', '2:3', '3:4'].includes(aspectRatio)) {
    return { width: 512, height: 768 }
  }
  return { width: 768, height: 512 }
}

function resolveVideoCkpt(): string {
  return process.env.LOCAL_VIDEO_CKPT?.trim() || VIDEO_DEFAULT_CKPT
}

function resolveVideoMotion(): string {
  return process.env.LOCAL_VIDEO_MOTION?.trim() || VIDEO_DEFAULT_MOTION
}

export function buildLocalVideoWorkflow(
  request: PlanRequest,
  enhancedPrompt: string
): Record<string, unknown> {
  const ckpt = resolveVideoCkpt()
  const motion = resolveVideoMotion()
  const { width, height } = resolveVideoDimensions(request.aspectRatio)
  const { frames, steps } = VIDEO_TIER[request.qualityTier]
  const seed = Math.floor(Math.random() * 2 ** 32)
  const negative = [DEFAULT_NEGATIVE, VIDEO_NEGATIVE_EXTRA].join(', ')

  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        scheduler: 'karras',
        negative: ['8', 0],
        denoise: 1,
        latent_image: ['5', 0],
        seed,
        cfg: 7.5,
        sampler_name: 'dpmpp_2m',
        model: ['6', 0],
        positive: ['7', 0],
        steps,
      },
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: ckpt },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { batch_size: frames, width, height },
    },
    '6': {
      class_type: 'ADE_AnimateDiffLoaderGen1',
      inputs: {
        model: ['4', 0],
        model_name: motion,
        beta_schedule: 'sqrt_linear (AnimateDiff)',
      },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: `${VIDEO_PROMPT_PREFIX}${enhancedPrompt}`,
        clip: ['4', 1],
      },
    },
    '8': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negative, clip: ['4', 1] },
    },
    '9': {
      class_type: 'VAEDecode',
      inputs: { vae: ['4', 2], samples: ['3', 0] },
    },
    '10': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['9', 0],
        frame_rate: VIDEO_FPS,
        loop_count: 0,
        filename_prefix: 'nsfw/video/raw/nsfw-video',
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
      },
    },
  }
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
        filename_prefix: `nsfw/images/raw/nsfw-app-${request.style}`,
        images: ['37', 0],
      },
    },
  }
}

export async function createLocalPlan(
  request: PlanRequest
): Promise<PlanSnapshot> {
  await pingComfy()

  const enhanced = enhancePrompt(request.prompt, request.style)
  const planId = randomUUID()

  if ((request.mediaType ?? 'image') === 'video') {
    const ckpt = resolveVideoCkpt()
    const motion = resolveVideoMotion()
    const graph = buildLocalVideoWorkflow(request, enhanced)
    const { frames, steps } = VIDEO_TIER[request.qualityTier]
    const { width, height } = resolveVideoDimensions(request.aspectRatio)
    const seconds = (frames / VIDEO_FPS).toFixed(1)

    const snapshot: PlanSnapshot = {
      planId,
      createdAt: new Date().toISOString(),
      request,
      mediaType: 'video',
      mode: 'local-comfy',
      route: 'local/comfyui',
      modelId: ckpt,
      modelLabel: `Local AnimateDiff (${ckpt.replace('.safetensors', '')} + ${motion.replace('.ckpt', '')})`,
      localGraph: graph,
      params: {
        prompt: `${VIDEO_PROMPT_PREFIX}${enhanced}`.trim(),
        aspectRatio: request.aspectRatio,
        resolution: `${width}x${height}`,
        quality: request.qualityTier,
      },
      originalPrompt: request.prompt,
      estimatedPrice: 0,
      currency: 'CNY',
      reason: `${request.style} + ${request.qualityTier} → local AnimateDiff: ${frames} frames @ ${VIDEO_FPS}fps (~${seconds}s), ${steps} steps, ${width}x${height} — no cloud content filter, no cost`,
      alternatives: [],
    }

    await savePlan(snapshot)
    return snapshot
  }

  const spec = resolveCheckpoint(request.style)
  const graph = buildLocalWorkflow(request, enhanced)

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