import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildLocalVideoWorkflow,
  buildLocalWorkflow,
  resolveCheckpoint,
  resolveVideoDimensions,
  stepsForTier,
} from './local-plan'
import type { PlanRequest } from './types'

type Graph = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>

function videoRequest(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    prompt: 'a woman dancing',
    style: 'realistic',
    aspectRatio: '1:1',
    qualityTier: 'medium',
    mediaType: 'video',
    ...overrides,
  }
}

const REQ = {
  prompt: 'test girl',
  style: 'hentai' as const,
  aspectRatio: '9:16',
  qualityTier: 'medium' as const,
}

describe('resolveCheckpoint', () => {
  const prev = process.env.LOCAL_CKPT_REALISTIC

  afterEach(() => {
    if (prev === undefined) delete process.env.LOCAL_CKPT_REALISTIC
    else process.env.LOCAL_CKPT_REALISTIC = prev
  })

  it('maps hentai to ponyDiffusion with score prefix', () => {
    const spec = resolveCheckpoint('hentai')
    expect(spec.file).toBe('ponyDiffusionV6XL_v6StartWithThisOne.safetensors')
    expect(spec.prefix).toContain('score_9')
  })

  it('maps realistic to juggernautXL', () => {
    expect(resolveCheckpoint('realistic').file).toBe(
      'juggernautXL_ragnarokBy.safetensors'
    )
  })

  it('honors LOCAL_CKPT_<STYLE> env override', () => {
    process.env.LOCAL_CKPT_REALISTIC = 'realvisxlV50_v50LightningBakedvae.safetensors'
    expect(resolveCheckpoint('realistic').file).toBe(
      'realvisxlV50_v50LightningBakedvae.safetensors'
    )
  })
})

describe('stepsForTier', () => {
  const pony = resolveCheckpoint('hentai')

  it('adjusts steps by tier with a floor of 4', () => {
    expect(stepsForTier(pony, 'low')).toBe(18)
    expect(stepsForTier(pony, 'medium')).toBe(28)
    expect(stepsForTier(pony, 'high')).toBe(34)
  })
})

describe('buildLocalWorkflow', () => {
  it('builds the 7-node graph with correct links and pony prefix', () => {
    const graph = buildLocalWorkflow(REQ, 'test girl, anime art style')
    expect(Object.keys(graph)).toHaveLength(7)
    const sampler = graph['3'] as { inputs: Record<string, unknown> }
    expect(sampler.inputs.model).toEqual(['4', 0])
    expect(sampler.inputs.positive).toEqual(['6', 0])
    expect(sampler.inputs.negative).toEqual(['7', 0])
    const positive = graph['6'] as { inputs: { text: string } }
    expect(positive.inputs.text).toMatch(
      /^score_9, score_8_up, score_7_up, .*test girl/
    )
    const negative = graph['7'] as { inputs: { text: string } }
    expect(negative.inputs.text).toContain('score_4')
    const size = graph['5'] as { inputs: { width: number; height: number } }
    expect(size.inputs).toEqual({ batch_size: 1, width: 768, height: 1344 })
    const ckpt = graph['4'] as { inputs: { ckpt_name: string } }
    expect(ckpt.inputs.ckpt_name).toBe(
      'ponyDiffusionV6XL_v6StartWithThisOne.safetensors'
    )
  })
})

describe('resolveVideoDimensions', () => {
  it('maps aspect ratios to AnimateDiff-safe sizes', () => {
    expect(resolveVideoDimensions('1:1')).toEqual({ width: 512, height: 512 })
    expect(resolveVideoDimensions('9:16')).toEqual({ width: 512, height: 768 })
    expect(resolveVideoDimensions('2:3')).toEqual({ width: 512, height: 768 })
    expect(resolveVideoDimensions('3:4')).toEqual({ width: 512, height: 768 })
    expect(resolveVideoDimensions('16:9')).toEqual({ width: 768, height: 512 })
    expect(resolveVideoDimensions('3:2')).toEqual({ width: 768, height: 512 })
    expect(resolveVideoDimensions('4:3')).toEqual({ width: 768, height: 512 })
  })
})

describe('buildLocalVideoWorkflow', () => {
  const prevCkpt = process.env.LOCAL_VIDEO_CKPT
  const prevMotion = process.env.LOCAL_VIDEO_MOTION

  beforeEach(() => {
    delete process.env.LOCAL_VIDEO_CKPT
    delete process.env.LOCAL_VIDEO_MOTION
  })

  afterEach(() => {
    if (prevCkpt === undefined) delete process.env.LOCAL_VIDEO_CKPT
    else process.env.LOCAL_VIDEO_CKPT = prevCkpt
    if (prevMotion === undefined) delete process.env.LOCAL_VIDEO_MOTION
    else process.env.LOCAL_VIDEO_MOTION = prevMotion
  })

  it('builds the AnimateDiff graph with defaults', () => {
    const g = buildLocalVideoWorkflow(videoRequest(), 'enhanced prompt') as Graph

    expect(g['4'].class_type).toBe('CheckpointLoaderSimple')
    expect(g['4'].inputs.ckpt_name).toBe('realisticVisionV51_v51VAE.safetensors')

    expect(g['6'].class_type).toBe('ADE_AnimateDiffLoaderGen1')
    expect(g['6'].inputs.model_name).toBe('mm_sd_v15_v2.ckpt')
    expect(g['6'].inputs.beta_schedule).toBe('sqrt_linear (AnimateDiff)')
    expect(g['6'].inputs.model).toEqual(['4', 0])

    expect(g['5'].inputs.batch_size).toBe(24)
    expect(g['5'].inputs.width).toBe(512)
    expect(g['5'].inputs.height).toBe(512)

    expect(g['3'].inputs.steps).toBe(20)
    expect(g['3'].inputs.cfg).toBe(7.5)
    expect(g['3'].inputs.model).toEqual(['6', 0])
    expect(g['3'].inputs.positive).toEqual(['7', 0])
    expect(g['3'].inputs.negative).toEqual(['8', 0])

    expect(String(g['7'].inputs.text)).toContain(
      'masterpiece, best quality, photorealistic, enhanced prompt'
    )
    expect(String(g['8'].inputs.text)).toContain(
      'static, no motion, flickering, jumpy motion, lowres'
    )

    expect(g['10'].class_type).toBe('VHS_VideoCombine')
    expect(g['10'].inputs.filename_prefix).toBe('nsfw/video/raw/nsfw-video')
    expect(g['10'].inputs.format).toBe('video/h264-mp4')
    expect(g['10'].inputs.frame_rate).toBe(8)
    expect(g['10'].inputs.save_output).toBe(true)
  })

  it('maps quality tiers to frames/steps', () => {
    const low = buildLocalVideoWorkflow(
      videoRequest({ qualityTier: 'low' }),
      'x'
    ) as Graph
    expect(low['5'].inputs.batch_size).toBe(16)
    expect(low['3'].inputs.steps).toBe(16)

    const high = buildLocalVideoWorkflow(
      videoRequest({ qualityTier: 'high' }),
      'x'
    ) as Graph
    expect(high['5'].inputs.batch_size).toBe(32)
    expect(high['3'].inputs.steps).toBe(24)
  })

  it('honors LOCAL_VIDEO_CKPT and LOCAL_VIDEO_MOTION overrides', () => {
    process.env.LOCAL_VIDEO_CKPT = 'customSd15.safetensors'
    process.env.LOCAL_VIDEO_MOTION = 'custom_motion.ckpt'
    const g = buildLocalVideoWorkflow(videoRequest(), 'x') as Graph
    expect(g['4'].inputs.ckpt_name).toBe('customSd15.safetensors')
    expect(g['6'].inputs.model_name).toBe('custom_motion.ckpt')
  })

  it('uses portrait dimensions for 2:3', () => {
    const g = buildLocalVideoWorkflow(
      videoRequest({ aspectRatio: '2:3' }),
      'x'
    ) as Graph
    expect(g['5'].inputs.width).toBe(512)
    expect(g['5'].inputs.height).toBe(768)
  })
})

describe('buildLocalWorkflow raw output redirect', () => {
  it('writes SaveImage output under nsfw/images/raw', () => {
    const req: PlanRequest = {
      prompt: 'p',
      style: 'anime',
      aspectRatio: '1:1',
      qualityTier: 'medium',
    }
    const g = buildLocalWorkflow(req, 'enhanced') as Graph
    expect(g['9'].inputs.filename_prefix).toBe('nsfw/images/raw/nsfw-app-anime')
  })
})