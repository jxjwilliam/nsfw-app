import { readFileSync } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { ModelEntry, PlanRequest, QualityTier, Style } from './types'
import { pricePreview, type SubmitBody } from './runninghub'
import { savePlan } from './plans'

const STYLE_SUFFIX: Record<Style, string> = {
  anime: ', anime style, vibrant colors, detailed illustration',
  realistic: ', photorealistic, natural lighting, high detail',
  hentai: ', anime art style, mature themes',
  hassaku: ', soft anime shading, clean lineart',
}

export function loadCatalog(): ModelEntry[] {
  const p = path.join(process.cwd(), 'data', 'models.json')
  return JSON.parse(readFileSync(p, 'utf-8')) as ModelEntry[]
}

export function enhancePrompt(prompt: string, style: Style): string {
  return `${prompt.trim()}${STYLE_SUFFIX[style]}`
}

export function filterCandidates(catalog: ModelEntry[], style: Style): ModelEntry[] {
  return catalog.filter((m) => {
    if (!m.nsfwOk) return false
    const s = m.styles as readonly string[]
    if (s.includes('all')) return true
    return (m.styles as Style[]).includes(style)
  })
}

export type ScoredCandidate = {
  modelId: string
  modelLabel: string
  route: string
  estimatedPrice: number
  currency: string
  priority: number
  params: SubmitBody
}

/** Minimal fields required for ranking; tests may pass partial objects. */
export type RankableCandidate = Pick<
  ScoredCandidate,
  'modelId' | 'estimatedPrice' | 'priority'
> &
  Partial<Omit<ScoredCandidate, 'modelId' | 'estimatedPrice' | 'priority'>>

export function rankCandidates<T extends RankableCandidate>(
  _models: ModelEntry[],
  scored: T[],
  tier: QualityTier
): T[] {
  const copy = [...scored]
  if (tier === 'low') {
    return copy.sort((a, b) => a.estimatedPrice - b.estimatedPrice)
  }
  if (tier === 'high') {
    return copy.sort(
      (a, b) =>
        b.priority - a.priority || a.estimatedPrice - b.estimatedPrice
    )
  }
  return copy.sort(
    (a, b) =>
      b.priority -
      a.priority +
      b.estimatedPrice -
      (a.priority + a.estimatedPrice)
  )
}

function buildReason(
  winner: ScoredCandidate,
  tier: QualityTier,
  style: Style
): string {
  return `${style} + ${tier} → ${winner.modelLabel} (¥${winner.estimatedPrice.toFixed(2)} via ${winner.route})`
}

export async function createPlan(request: PlanRequest) {
  const catalog = loadCatalog()
  const candidates = filterCandidates(catalog, request.style)
  if (candidates.length === 0) {
    throw new Error('No NSFW-ok models match this style')
  }

  const enhanced = enhancePrompt(request.prompt, request.style)
  const previews: ScoredCandidate[] = []

  for (const model of candidates.slice(0, 4)) {
    const tierParams = model.tierMap[request.qualityTier]
    const params: SubmitBody = {
      prompt: enhanced,
      aspectRatio: request.aspectRatio,
      resolution: tierParams.resolution,
      quality: tierParams.quality,
    }
    try {
      const price = await pricePreview(model.route, params)
      if (price.errorMessage) continue
      previews.push({
        modelId: model.id,
        modelLabel: model.label,
        route: model.route,
        estimatedPrice: price.estimatedPrice,
        currency: price.currency,
        priority: model.priority,
        params,
      })
    } catch {
      continue
    }
  }

  if (previews.length === 0) {
    throw new Error('All price previews failed — check RH_API_KEY and membership')
  }

  const ranked = rankCandidates(catalog, previews, request.qualityTier)
  const winner = ranked[0] as ScoredCandidate
  const alternatives = ranked.slice(1, 3).map((a) => ({
    modelId: a.modelId,
    modelLabel: a.modelLabel ?? '',
    route: a.route ?? '',
    estimatedPrice: a.estimatedPrice,
    reason: `Alternative: ¥${a.estimatedPrice.toFixed(2)}`,
  }))

  const planId = randomUUID()
  const snapshot = {
    planId,
    createdAt: new Date().toISOString(),
    request,
    route: winner.route,
    modelId: winner.modelId,
    modelLabel: winner.modelLabel,
    params: winner.params,
    originalPrompt: request.prompt,
    estimatedPrice: winner.estimatedPrice,
    currency: winner.currency,
    reason: buildReason(winner, request.qualityTier, request.style),
    alternatives,
  }

  await savePlan(snapshot)
  return snapshot
}
