import type { PlanSnapshot } from './types'
import { isKvEnabled, kvGet, kvSet } from './kv'

/** Plan snapshots expire after this interval (confirm-within window). */
export const TTL_MS = 5 * 60 * 1000

const PLAN_KV_TTL_SECONDS = Math.ceil(TTL_MS / 1000)

/** Writable base dir — `/tmp` on Vercel (serverless), `process.cwd()` elsewhere. */
const BASE_DIR =
  process.env.VERCEL === '1' ? '/tmp' : process.cwd().replace(/\/$/, '')

export async function savePlan(plan: PlanSnapshot): Promise<void> {
  const { writeFile, mkdir } = await import('fs/promises')
  const pathMod = await import('path')
  const dir = pathMod.join(BASE_DIR, '.plans')
  await mkdir(dir, { recursive: true })
  await writeFile(
    pathMod.join(dir, `${plan.planId}.json`),
    JSON.stringify(plan, null, 2),
    'utf-8'
  )
  if (isKvEnabled()) {
    try {
      await kvSet(`plan:${plan.planId}`, plan, PLAN_KV_TTL_SECONDS)
    } catch (e) {
      console.error('KV plan save failed', e)
    }
  }
}

export async function loadPlan(planId: string): Promise<PlanSnapshot | null> {
  if (isKvEnabled()) {
    try {
      const plan = await kvGet<PlanSnapshot>(`plan:${planId}`)
      if (plan && isFreshPlan(plan)) return plan
    } catch (e) {
      console.error('KV plan load failed', e)
    }
  }
  const { readFile } = await import('fs/promises')
  const pathMod = await import('path')
  try {
    const raw = await readFile(
      pathMod.join(BASE_DIR, '.plans', `${planId}.json`),
      'utf-8'
    )
    const plan = JSON.parse(raw) as PlanSnapshot
    return isFreshPlan(plan) ? plan : null
  } catch {
    return null
  }
}

function isFreshPlan(plan: PlanSnapshot): boolean {
  const createdAt = new Date(plan.createdAt).getTime()
  if (Number.isNaN(createdAt)) return false
  return Date.now() - createdAt <= TTL_MS
}
