/**
 * Minimal Vercel KV (Upstash REST API) client — no external SDK, plain fetch.
 * Used to make plan/job state survive Vercel's per-instance /tmp and memory.
 * No-ops when KV_REST_API_URL / KV_REST_API_TOKEN are not set.
 */
function kvBaseUrl(): string {
  return (process.env.KV_REST_API_URL ?? '').trim()
}

function kvToken(): string {
  return (process.env.KV_REST_API_TOKEN ?? '').trim()
}

export function isKvEnabled(): boolean {
  return Boolean(kvBaseUrl() && kvToken())
}

export async function kvGet<T>(key: string): Promise<T | null> {
  if (!isKvEnabled()) return null
  const res = await fetch(`${kvBaseUrl()}/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${kvToken()}` },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`KV get failed (HTTP ${res.status})`)
  return (await res.json()) as T
}

export async function kvSet(
  key: string,
  value: unknown,
  ttlSeconds?: number
): Promise<void> {
  if (!isKvEnabled()) return
  const ttl = ttlSeconds ? `?EX=${ttlSeconds}` : ''
  const res = await fetch(`${kvBaseUrl()}/${encodeURIComponent(key)}${ttl}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${kvToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  })
  if (!res.ok) throw new Error(`KV set failed (HTTP ${res.status})`)
}
