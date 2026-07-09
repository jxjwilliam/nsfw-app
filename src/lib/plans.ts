import type { PlanSnapshot } from './types'

/** Plan snapshots expire after this interval (confirm-within window). */
export const TTL_MS = 5 * 60 * 1000

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
}

export async function loadPlan(planId: string): Promise<PlanSnapshot | null> {
  const { readFile } = await import('fs/promises')
  const pathMod = await import('path')
  try {
    const raw = await readFile(
      pathMod.join(BASE_DIR, '.plans', `${planId}.json`),
      'utf-8'
    )
    const plan = JSON.parse(raw) as PlanSnapshot
    if (
      Number.isNaN(new Date(plan.createdAt).getTime()) ||
      Date.now() - new Date(plan.createdAt).getTime() > TTL_MS
    ) {
      return null
    }
    return plan
  } catch {
    return null
  }
}
