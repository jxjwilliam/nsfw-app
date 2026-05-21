import { NextResponse } from 'next/server'

import { createPlan } from '@/lib/router'
import type { PlanRequest, QualityTier, Style } from '@/lib/types'

const styles: Style[] = ['anime', 'realistic', 'hentai', 'hassaku']
const tiers: QualityTier[] = ['low', 'medium', 'high']

function isStyle(s: unknown): s is Style {
  return typeof s === 'string' && styles.includes(s as Style)
}

function isTier(t: unknown): t is QualityTier {
  return typeof t === 'string' && tiers.includes(t as QualityTier)
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const prompt =
      typeof body.prompt === 'string' ? body.prompt.trim() : ''
    const style = body.style
    const aspectRatio =
      typeof body.aspectRatio === 'string' ? body.aspectRatio.trim() : ''
    const qualityTier = body.qualityTier

    if (!prompt) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
    }
    if (!isStyle(style)) {
      return NextResponse.json({ error: 'invalid style' }, { status: 400 })
    }
    if (!aspectRatio) {
      return NextResponse.json(
        { error: 'aspectRatio is required' },
        { status: 400 }
      )
    }
    if (!isTier(qualityTier)) {
      return NextResponse.json({ error: 'invalid qualityTier' }, { status: 400 })
    }

    const request: PlanRequest = {
      prompt,
      style,
      aspectRatio,
      qualityTier,
    }

    const plan = await createPlan(request)
    return NextResponse.json(plan)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'plan failed'
    const status =
      message.includes('RH_API_KEY') ||
      message.includes('price previews failed')
        ? 503
        : message.includes('No NSFW')
          ? 422
          : 502

    return NextResponse.json({ error: message }, { status })
  }
}
