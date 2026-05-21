import { describe, it, expect } from 'vitest'
import { enhancePrompt, rankCandidates } from './router'
import type { ModelEntry } from './types'

describe('enhancePrompt', () => {
  it('appends realistic suffix', () => {
    expect(enhancePrompt('a woman', 'realistic')).toContain('photorealistic')
  })
})

describe('rankCandidates', () => {
  const models: ModelEntry[] = [
    {
      id: 'a',
      label: 'A',
      route: 'a/text-to-image',
      nsfwOk: true,
      styles: ['realistic'],
      tierMap: {
        low: { resolution: '1k', quality: 'low' },
        medium: { resolution: '2k', quality: 'medium' },
        high: { resolution: '4k', quality: 'high' },
      },
      priority: 10,
    },
    {
      id: 'b',
      label: 'B',
      route: 'b/text-to-image',
      nsfwOk: true,
      styles: ['realistic'],
      tierMap: {
        low: { resolution: '1k', quality: 'low' },
        medium: { resolution: '2k', quality: 'medium' },
        high: { resolution: '2k', quality: 'medium' },
      },
      priority: 5,
    },
  ]

  it('picks lowest price for low tier', () => {
    const ranked = rankCandidates(
      models,
      [
        { modelId: 'a', estimatedPrice: 0.9, priority: 10 },
        { modelId: 'b', estimatedPrice: 0.4, priority: 5 },
      ],
      'low'
    )
    expect(ranked[0].modelId).toBe('b')
  })

  it('picks highest priority for high tier', () => {
    const ranked = rankCandidates(
      models,
      [
        { modelId: 'a', estimatedPrice: 0.9, priority: 10 },
        { modelId: 'b', estimatedPrice: 0.4, priority: 5 },
      ],
      'high'
    )
    expect(ranked[0].modelId).toBe('a')
  })

  it('medium tier balances priority and price', () => {
    const ranked = rankCandidates(
      models,
      [
        { modelId: 'a', estimatedPrice: 1.0, priority: 10 },
        { modelId: 'b', estimatedPrice: 0.2, priority: 5 },
      ],
      'medium'
    )
    expect(ranked[0].modelId).toBe('a')
    const ranked2 = rankCandidates(
      models,
      [
        { modelId: 'a', estimatedPrice: 2.0, priority: 5 },
        { modelId: 'b', estimatedPrice: 0.5, priority: 10 },
      ],
      'medium'
    )
    expect(ranked2[0].modelId).toBe('b')
  })
})
