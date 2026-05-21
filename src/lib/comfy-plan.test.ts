import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { buildComfyNodeInfoList, resolveDimensions } from './comfy-plan'

describe('resolveDimensions', () => {
  it('maps 9:16 to portrait SDXL size', () => {
    expect(resolveDimensions('9:16')).toEqual({ width: 768, height: 1344 })
  })
})

describe('buildComfyNodeInfoList', () => {
  const prev = process.env.RH_WORKFLOW_ID

  beforeEach(() => {
    process.env.RH_WORKFLOW_ID = '1904136902449209346'
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.RH_WORKFLOW_ID
    else process.env.RH_WORKFLOW_ID = prev
  })

  it('includes prompt, size, and sampler overrides', () => {
    const list = buildComfyNodeInfoList(
      {
        prompt: 'test girl',
        style: 'hentai',
        aspectRatio: '1:1',
        qualityTier: 'high',
      },
      'test girl, anime art style'
    )

    const byKey = (nodeId: string, field: string) =>
      list.find((n) => n.nodeId === nodeId && n.fieldName === field)?.fieldValue

    expect(byKey('6', 'text')).toContain('anime art style')
    expect(byKey('5', 'width')).toBe('1024')
    expect(byKey('5', 'height')).toBe('1024')
    expect(byKey('3', 'steps')).toBe('32')
  })
})
