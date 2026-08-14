import { afterEach, describe, expect, it } from 'vitest'

import {
  buildLocalWorkflow,
  resolveCheckpoint,
  stepsForTier,
} from './local-plan'

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