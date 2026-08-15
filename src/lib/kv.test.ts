
Claude finished the response

Investigated deployment caching and environment variable configuration issues
Investigated deployment caching and environment variable configuration issues
Let's check what the actual code expects — the docs said "recommended" env vars, but I should verify the code reads KV_REST_API_URL/KV_REST_API_TOKEN correctly and check if the redeploy actually picked them up.


Searched the web, ran 3 commands
Searched the web, ran 3 commands
There's a dedicated kv.ts — let's see exactly what env vars and logic it expects, plus how jobs.ts and /api/status use it.


Diagnosed API format mismatch and architected corrective solution
Diagnosed API format mismatch and architected corrective solution
Found it — and it's not a config problem, it's a code bug that predates your Upstash setup.

Root cause: Your src/lib/kv.ts talks to KV like this:

ts
// kvGet
fetch(`${kvBaseUrl()}/${key}`, ...)
// kvSet
fetch(`${kvBaseUrl()}/${key}?EX=${ttl}`, { method: 'PUT', ... })
That's the URL shape of the old, now-retired native Vercel KV proxy (*.kv.vercel-storage.com), which let you GET/PUT a bare key path. But the database you just connected is genuinely Upstash for Redis (shown in your first screenshot: "Upstash for Redis / nsfw-app-kv") via the Vercel Marketplace — Vercel keeps the same env var names (KV_REST_API_URL/KV_REST_API_TOKEN) for backward compatibility, but the URL now points straight at Upstash's real REST API, which requires the Redis command in the path: /get/<key> and /set/<key>, not a bare key.

So right now every kvGet/kvSet call hits an invalid path, Upstash rejects it, jobs.ts swallows the error (console.error only), and the app silently falls back to /tmp — which is exactly why it still says "job not found" even though your env vars are correct and redeployed.

Fix — replace src/lib/kv.ts with:

ts
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
Key changes: /get/ and /set/ command prefixes, POST instead of PUT, and unwrapping Upstash's {"result": "..."} envelope (Upstash never 404s on a missing key — it returns 200 with result: null).

You'll also need to update src/lib/kv.test.ts — its mocked assertions check for the old bare-key URLs (https://demo.kv.vercel-storage.com/job%3Aj1, PUT method), so they'll fail against the new implementation. Want me to write the corrected test file too, or are you good to update it yourself and push?

is it posible you direct operate https://github.com/jxjwilliam/rh-comfyui-app to do the change? I give you permission

I don't have push/write access to GitHub (no GitHub connector is set up in this chat, and my network access here is read-only/sandboxed — I can't authenticate as you even with permission). So I can't commit directly to your repo.

What I can do: write the corrected files locally and hand them to you ready to drop in and push. Let me do that now.


Created 2 files, ran a command, read a file
Created 2 files, ran a command, read a file
To apply:

bash
cp kv.ts src/lib/kv.ts
cp kv.test.ts src/lib/kv.test.ts
npm test          # confirm kv.test.ts passes
git add src/lib/kv.ts src/lib/kv.test.ts
git commit -m "fix: use real Upstash REST API command paths in kv.ts"
git push
Vercel will auto-deploy on push. Once it's live, run through Plan → Confirm → poll again — /api/status should resolve across instances instead of 404ing.

If you want, I can also poke at src/app/api/status/route.ts to add a clearer error message (e.g. surface "KV get failed" instead of a generic "job not found") so this class of bug is easier to spot next time — let me know.


Kv
TS 

Kv.test
TS 





Claude is AI and can make mistakes. Please double-check responses.
Kv.test · TS
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
 
import { isKvEnabled, kvGet, kvSet } from './kv'
 
const ENV_KEYS = ['KV_REST_API_URL', 'KV_REST_API_TOKEN']
 
let savedEnv: Record<string, string | undefined> = {}
 
beforeEach(() => {
  savedEnv = {}
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})
 
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  vi.unstubAllGlobals()
})
 
function enableKv(): void {
  process.env.KV_REST_API_URL = 'https://us1-example-1234.upstash.io'
  process.env.KV_REST_API_TOKEN = 'test-token'
}
 
function mockFetch(status: number, body: string) {
  const fn = vi.fn(async () => new Response(body, { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}
 
describe('isKvEnabled', () => {
  it('is disabled without env vars', () => {
    expect(isKvEnabled()).toBe(false)
  })
 
  it('is enabled when both vars are present', () => {
    enableKv()
    expect(isKvEnabled()).toBe(true)
  })
})
 
describe('kvGet', () => {
  it('hits /get/<key> and unwraps + parses the JSON result', async () => {
    enableKv()
    const fn = mockFetch(200, '{"result":"{\\"jobId\\":\\"j1\\"}"}')
    expect(await kvGet('job:j1')).toEqual({ jobId: 'j1' })
    expect(fn).toHaveBeenCalledWith(
      'https://us1-example-1234.upstash.io/get/job%3Aj1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    )
  })
 
  it('returns null when result is null (missing key, HTTP 200)', async () => {
    enableKv()
    mockFetch(200, '{"result":null}')
    expect(await kvGet('job:missing')).toBeNull()
  })
 
  it('throws on non-OK statuses', async () => {
    enableKv()
    mockFetch(500, 'oops')
    await expect(kvGet('job:j1')).rejects.toThrow('KV get failed (HTTP 500)')
  })
 
  it('is a no-op when KV is disabled', async () => {
    const fn = mockFetch(200, '{"result":null}')
    expect(await kvGet('job:j1')).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })
})
 
describe('kvSet', () => {
  it('POSTs to /set/<key> with the JSON value as the body and EX in the query string', async () => {
    enableKv()
    const fn = mockFetch(200, '{"result":"OK"}')
    await kvSet('plan:p1', { planId: 'p1' }, 300)
    expect(fn).toHaveBeenCalledWith(
      'https://us1-example-1234.upstash.io/set/plan%3Ap1?EX=300',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
        body: '{"planId":"p1"}',
      })
    )
  })
 
  it('JSON-encodes string values with no TTL suffix', async () => {
    enableKv()
    const fn = mockFetch(200, '{"result":"OK"}')
    await kvSet('k', 'hello')
    expect(fn).toHaveBeenCalledWith(
      'https://us1-example-1234.upstash.io/set/k',
      expect.objectContaining({ body: '"hello"' })
    )
  })
 
  it('throws on non-OK statuses', async () => {
    enableKv()
    mockFetch(403, 'denied')
    await expect(kvSet('k', 'v')).rejects.toThrow('KV set failed (HTTP 403)')
  })
 
  it('is a no-op when KV is disabled', async () => {
    const fn = mockFetch(200, '{"result":"OK"}')
    await kvSet('k', 'v')
    expect(fn).not.toHaveBeenCalled()
  })
})
 
