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
  process.env.KV_REST_API_URL = 'https://demo.kv.vercel-storage.com'
  process.env.KV_REST_API_TOKEN = 'test-token'
}

function mockFetch(status: number, body: string) {
  const fn = vi.fn(
    async () => new Response(body, { status })
  )
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
  it('returns null on 404 and parses JSON values', async () => {
    enableKv()
    const fn = mockFetch(200, '{"jobId":"j1"}')
    expect(await kvGet('job:j1')).toEqual({ jobId: 'j1' })
    expect(fn).toHaveBeenCalledWith(
      'https://demo.kv.vercel-storage.com/job%3Aj1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    )
    mockFetch(404, '')
    expect(await kvGet('job:missing')).toBeNull()
  })

  it('throws on non-OK statuses', async () => {
    enableKv()
    mockFetch(500, 'oops')
    await expect(kvGet('job:j1')).rejects.toThrow('KV get failed (HTTP 500)')
  })

  it('is a no-op when KV is disabled', async () => {
    const fn = mockFetch(200, '"x"')
    expect(await kvGet('job:j1')).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('kvSet', () => {
  it('PUTs a JSON value with auth and optional TTL', async () => {
    enableKv()
    const fn = mockFetch(200, 'OK')
    await kvSet('plan:p1', { planId: 'p1' }, 300)
    expect(fn).toHaveBeenCalledWith(
      'https://demo.kv.vercel-storage.com/plan%3Ap1?EX=300',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
        body: '{"planId":"p1"}',
      })
    )
  })

  it('JSON-encodes string values', async () => {
    enableKv()
    const fn = mockFetch(200, 'OK')
    await kvSet('k', 'hello')
    expect(fn).toHaveBeenCalledWith(
      'https://demo.kv.vercel-storage.com/k',
      expect.objectContaining({ body: '"hello"' })
    )
  })

  it('throws on non-OK statuses', async () => {
    enableKv()
    mockFetch(403, 'denied')
    await expect(kvSet('k', 'v')).rejects.toThrow('KV set failed (HTTP 403)')
  })

  it('is a no-op when KV is disabled', async () => {
    const fn = mockFetch(200, 'OK')
    await kvSet('k', 'v')
    expect(fn).not.toHaveBeenCalled()
  })
})
