import { createHash, createHmac } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildCanonicalRequest,
  fetchR2Image,
  isR2Enabled,
  r2Config,
  r2ImageKey,
  signR2Request,
  uploadR2Image,
} from './r2'

type CapturedRequest = {
  options: Record<string, unknown>
  headers: Record<string, string>
  body: Buffer
}

const httpMock = vi.hoisted(() => {
  const state: {
    requests: CapturedRequest[]
    responder: (req: CapturedRequest) => {
      status: number
      body: string | Buffer
    }
  } = {
    requests: [],
    responder: () => ({ status: 200, body: '' }),
  }

  function makeRequest(
    options: Record<string, unknown>,
    callback?: (res: unknown) => void
  ) {
    const req = new EventEmitter() as EventEmitter & {
      write: (chunk: unknown, cb?: () => void) => void
      end: (cb?: () => void) => void
    }
    const captured: CapturedRequest = {
      options,
      headers: (options.headers ?? {}) as Record<string, string>,
      body: Buffer.alloc(0),
    }
    state.requests.push(captured)
    req.write = (chunk: unknown, cb?: () => void) => {
      captured.body = Buffer.concat([captured.body, Buffer.from(chunk as Buffer)])
      if (typeof cb === 'function') cb()
    }
    req.end = (cb?: () => void) => {
      if (typeof cb === 'function') cb()
      const reply = state.responder(captured)
      const res = new EventEmitter() as EventEmitter & { statusCode: number }
      res.statusCode = reply.status
      if (callback) callback(res)
      const body = Buffer.from(reply.body)
      process.nextTick(() => {
        res.emit('data', body)
        res.emit('end')
      })
    }
    return req
  }

  return { state, makeRequest }
})

vi.mock('node:http', () => ({
  default: {
    request: (o: Record<string, unknown>, cb?: (res: unknown) => void) =>
      httpMock.makeRequest(o, cb),
  },
}))

vi.mock('node:https', () => ({
  default: {
    request: (o: Record<string, unknown>, cb?: (res: unknown) => void) =>
      httpMock.makeRequest(o, cb),
  },
}))

const ENV_KEYS = [
  'R2_ENDPOINT',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_ENABLED',
  'VERCEL',
]

let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnv = {}
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  httpMock.state.requests = []
  httpMock.state.responder = () => ({ status: 200, body: '' })
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

function setR2Env(extra: Record<string, string> = {}): void {
  process.env.R2_ENDPOINT = 'http://127.0.0.1:9999'
  process.env.R2_ACCESS_KEY_ID = 'test-access-key'
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key'
  process.env.R2_BUCKET_NAME = 'nfsw'
  for (const [key, value] of Object.entries(extra)) process.env[key] = value
}

describe('isR2Enabled gating', () => {
  it('is disabled by default (no credentials)', () => {
    expect(isR2Enabled()).toBe(false)
  })

  it('stays disabled locally even with credentials (port 4000 unaffected)', () => {
    process.env.R2_ACCESS_KEY_ID = 'key'
    process.env.R2_SECRET_ACCESS_KEY = 'secret'
    process.env.R2_ACCOUNT_ID = 'account'
    expect(isR2Enabled()).toBe(false)
  })

  it('enables on Vercel when credentials are present', () => {
    process.env.R2_ACCESS_KEY_ID = 'key'
    process.env.R2_SECRET_ACCESS_KEY = 'secret'
    process.env.R2_ACCOUNT_ID = 'account'
    process.env.VERCEL = '1'
    expect(isR2Enabled()).toBe(true)
  })

  it('enables locally only when explicitly opted in', () => {
    process.env.R2_ACCESS_KEY_ID = 'key'
    process.env.R2_SECRET_ACCESS_KEY = 'secret'
    process.env.R2_ACCOUNT_ID = 'account'
    process.env.R2_ENABLED = 'true'
    expect(isR2Enabled()).toBe(true)
  })

  it('stays disabled on Vercel when a credential is missing', () => {
    process.env.R2_ACCESS_KEY_ID = 'key'
    process.env.R2_ACCOUNT_ID = 'account'
    process.env.VERCEL = '1'
    expect(isR2Enabled()).toBe(false)
  })
})

describe('r2Config and object keys', () => {
  it('derives the R2 endpoint from the account id', () => {
    process.env.R2_ACCOUNT_ID = 'abc123'
    expect(r2Config().endpoint).toBe('https://abc123.r2.cloudflarestorage.com')
  })

  it('lets R2_ENDPOINT override the derived endpoint', () => {
    process.env.R2_ACCOUNT_ID = 'abc123'
    process.env.R2_ENDPOINT = 'https://r2.example.test'
    expect(r2Config().endpoint).toBe('https://r2.example.test')
  })

  it('defaults the bucket to nfsw', () => {
    process.env.R2_ACCOUNT_ID = 'abc123'
    expect(r2Config().bucket).toBe('nfsw')
  })

  it('builds deterministic object keys per job', () => {
    expect(r2ImageKey('job-1')).toBe('media-job-1.png')
  })
})

describe('SigV4 signing', () => {
  it('builds a canonical request with sorted headers and payload hash', () => {
    const body = Buffer.from('png-data')
    const canonical = buildCanonicalRequest({
      method: 'PUT',
      path: '/nfsw/media-job-1.png',
      headers: {
        host: 'account.r2.cloudflarestorage.com',
        'x-amz-content-sha256': sha256('png-data'),
        'x-amz-date': '20260814T000000Z',
        'content-type': 'image/png',
      },
      body,
    })
    const lines = canonical.split('\n')
    expect(lines[0]).toBe('PUT')
    expect(lines[1]).toBe('/nfsw/media-job-1.png')
    expect(canonical).toContain('content-type:image/png\n')
    expect(canonical).toContain('host:account.r2.cloudflarestorage.com\n')
    expect(canonical).toContain('x-amz-date:20260814T000000Z\n')
    expect(lines[8]).toBe('content-type;host;x-amz-content-sha256;x-amz-date')
    expect(canonical.endsWith(sha256('png-data'))).toBe(true)
  })

  it('cross-checks the signature against an independent HMAC chain', () => {
    const headers = signR2Request({
      endpoint: 'https://account.r2.cloudflarestorage.com',
      accessKeyId: 'AKID',
      secretAccessKey: 'SECRET',
      method: 'PUT',
      path: '/nfsw/media-job-1.png',
      body: Buffer.from('png-data'),
      contentType: 'image/png',
      date: new Date('2026-08-14T00:00:00.000Z'),
    })
    expect(headers['x-amz-date']).toBe('20260814T000000Z')
    expect(headers['x-amz-content-sha256']).toBe(sha256('png-data'))

    const canonical = [
      'PUT',
      '/nfsw/media-job-1.png',
      '',
      'content-type:image/png\n' +
        'host:account.r2.cloudflarestorage.com\n' +
        'x-amz-content-sha256:' + sha256('png-data') + '\n' +
        'x-amz-date:20260814T000000Z\n',
      'content-type;host;x-amz-content-sha256;x-amz-date',
      sha256('png-data'),
    ].join('\n')
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      '20260814T000000Z',
      '20260814/auto/s3/aws4_request',
      sha256(canonical),
    ].join('\n')
    let key: Buffer = createHmac('sha256', 'AWS4SECRET')
      .update('20260814')
      .digest()
    for (const part of ['auto', 's3', 'aws4_request']) {
      key = createHmac('sha256', key).update(part).digest()
    }
    const expectedSignature = createHmac('sha256', key)
      .update(stringToSign)
      .digest('hex')
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKID/20260814/auto/s3/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, ' +
        `Signature=${expectedSignature}`
    )
  })
})

describe('R2 HTTP client (node:http mocked)', () => {
  it('uploads an image with a signed PUT to the nfsw bucket', async () => {
    setR2Env({ R2_ENABLED: 'true' })
    await uploadR2Image('job-1', Buffer.from('png-data'))

    expect(httpMock.state.requests).toHaveLength(1)
    const req = httpMock.state.requests[0]
    expect(req.options.method).toBe('PUT')
    expect(req.options.path).toBe('/nfsw/media-job-1.png')
    expect(req.body.toString('utf8')).toBe('png-data')
    expect(req.headers['content-type']).toBe('image/png')
    expect(req.headers['x-amz-content-sha256']).toBe(sha256('png-data'))
    expect(req.headers['x-amz-date']).toBeTruthy()
    expect(req.headers.authorization).toMatch(/AWS4-HMAC-SHA256 Credential=/)
    expect(req.headers.host).toContain('127.0.0.1')
  })

  it('throws a readable error when the upload is rejected', async () => {
    setR2Env({ R2_ENABLED: 'true' })
    httpMock.state.responder = () => ({ status: 500, body: 'oops' })
    await expect(uploadR2Image('job-1', Buffer.from('x'))).rejects.toThrow(
      'R2 upload failed (HTTP 500)'
    )
  })

  it('fetches an image and returns null on 404', async () => {
    setR2Env({ R2_ENABLED: 'true' })
    httpMock.state.responder = (req) =>
      (req.options.path as string).includes('/media-job-1.png')
        ? { status: 200, body: Buffer.from('img-bytes') }
        : { status: 404, body: '' }

    const buf = await fetchR2Image('job-1')
    expect(buf?.toString('utf8')).toBe('img-bytes')
    expect(await fetchR2Image('missing')).toBeNull()
  })
})
