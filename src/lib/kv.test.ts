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
    const storedValue = JSON.stringify({ jobId: 'j1' })
    const fn = mockFetch(200, JSON.stringify({ result: storedValue }))
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
