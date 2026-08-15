/**
 * Minimal Upstash Redis REST API client — no external SDK, plain fetch.
 * Used to make plan/job state survive Vercel's per-instance /tmp and memory.
 * No-ops when KV_REST_API_URL / KV_REST_API_TOKEN are not set.
 *
 * IMPORTANT: Upstash's REST API requires the Redis command in the path
 * itself, e.g. GET /get/<key> and POST /set/<key> (with the value as the
 * POST body). A bare GET/PUT on `${baseUrl}/${key}` — which is what the
 * old, now-retired native Vercel KV proxy (*.kv.vercel-storage.com)
 * accepted — is NOT valid against a real Upstash endpoint and will fail
 * silently if the caller swallows errors (see jobs.ts).
 *
 * Docs: https://upstash.com/docs/redis/features/restapi
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
  const res = await fetch(`${kvBaseUrl()}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${kvToken()}` },
  })
  if (!res.ok) throw new Error(`KV get failed (HTTP ${res.status})`)
  // Upstash always wraps the reply as { result: <value> | null }.
  // Missing keys come back as HTTP 200 with result: null, not a 404.
  const data = (await res.json()) as { result: string | null }
  if (data.result == null) return null
  return JSON.parse(data.result) as T
}

export async function kvSet(
  key: string,
  value: unknown,
  ttlSeconds?: number
): Promise<void> {
  if (!isKvEnabled()) return
  // Extra command params (like EX) go in the query string; the value
  // itself is sent as the raw POST body and Upstash appends it as the
  // last positional arg of the SET command.
  const qs = ttlSeconds ? `?EX=${ttlSeconds}` : ''
  const res = await fetch(
    `${kvBaseUrl()}/set/${encodeURIComponent(key)}${qs}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken()}` },
      body: JSON.stringify(value),
    }
  )
  if (!res.ok) throw new Error(`KV set failed (HTTP ${res.status})`)
}