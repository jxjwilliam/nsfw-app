import { createHash, createHmac } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import { Buffer } from 'node:buffer'

const SERVICE = 's3'
const REGION = 'auto'

export type R2Config = {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export function r2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() ?? ''
  const endpoint =
    process.env.R2_ENDPOINT?.trim() ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')
  return {
    endpoint,
    accessKeyId: process.env.R2_ACCESS_KEY_ID?.trim() ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim() ?? '',
    bucket: process.env.R2_BUCKET_NAME?.trim() || 'nfsw',
  }
}

/**
 * Cloud-only by default: enabled on Vercel when all keys are present.
 * Local dev (port 4000 / BACKEND=local) is unaffected unless the user
 * explicitly opts in with R2_ENABLED=true (e.g. a local smoke test).
 */
export function isR2Enabled(): boolean {
  const cfg = r2Config()
  const hasCreds = Boolean(
    cfg.endpoint && cfg.accessKeyId && cfg.secretAccessKey
  )
  if (!hasCreds) return false
  const explicitlyEnabled =
    process.env.R2_ENABLED?.trim().toLowerCase() === 'true'
  const onVercel = process.env.VERCEL === '1'
  return explicitlyEnabled || onVercel
}

/** Flat key — the bucket holds media files only, no folders or metadata. */
export function r2ImageKey(jobId: string): string {
  return `media-${jobId}.png`
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function signingKey(secret: string, dateStamp: string): Buffer {
  const kDate = hmac(Buffer.from(`AWS4${secret}`, 'utf8'), dateStamp)
  const kRegion = hmac(kDate, REGION)
  const kService = hmac(kRegion, SERVICE)
  return hmac(kService, 'aws4_request')
}

function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function canonicalQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&')
}

export type R2Request = {
  method: string
  path: string
  query?: Record<string, string>
  headers: Record<string, string>
  body?: Buffer
}

export function buildCanonicalRequest(req: R2Request): string {
  const canonicalHeaders = Object.keys(req.headers)
    .map((k) => k.toLowerCase())
    .sort()
    .map((k) => `${k}:${(req.headers[k] ?? '').trim()}\n`)
    .join('')
  const signedHeaders = Object.keys(req.headers)
    .map((k) => k.toLowerCase())
    .sort()
    .join(';')
  const payloadHash = req.body ? sha256Hex(req.body) : sha256Hex('')
  return [
    req.method,
    req.path,
    req.query ? canonicalQuery(req.query) : '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
}

export function signR2Request(
  opts: {
    endpoint: string
    accessKeyId: string
    secretAccessKey: string
    method: string
    path: string
    query?: Record<string, string>
    body?: Buffer
    contentType?: string
    date?: Date
  }
): Record<string, string> {
  const now = opts.date ?? new Date()
  const amzDateValue = amzDate(now)
  const dateStamp = amzDateValue.slice(0, 8)
  const host = new URL(opts.endpoint).host
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': opts.body ? sha256Hex(opts.body) : sha256Hex(''),
    'x-amz-date': amzDateValue,
  }
  if (opts.contentType) headers['content-type'] = opts.contentType

  const canonical = buildCanonicalRequest({
    method: opts.method,
    path: opts.path,
    query: opts.query,
    headers,
    body: opts.body,
  })
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDateValue,
    `${dateStamp}/${REGION}/${SERVICE}/aws4_request`,
    sha256Hex(canonical),
  ].join('\n')
  const signature = hmac(
    signingKey(opts.secretAccessKey, dateStamp),
    stringToSign
  ).toString('hex')
  const signedHeaders = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
    .join(';')

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/` +
    `${dateStamp}/${REGION}/${SERVICE}/aws4_request, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  return headers
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

async function r2Fetch(
  method: string,
  objectPath: string,
  query: Record<string, string> | undefined,
  body: Buffer | undefined,
  contentType: string | undefined
): Promise<{ status: number; buffer: Buffer }> {
  const cfg = r2Config()
  const url = new URL(cfg.endpoint)
  const client = url.protocol === 'https:' ? https : http
  const path = objectPath + (query ? `?${new URLSearchParams(query)}` : '')
  const headers = signR2Request({
    endpoint: cfg.endpoint,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    method,
    path: objectPath,
    query,
    body,
    contentType,
  })

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, buffer: Buffer.concat(chunks) })
        )
      }
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function r2ObjectPath(key: string): string {
  return `/${r2Config().bucket}/${encodePath(key)}`
}

export async function uploadR2Image(
  jobId: string,
  image: Buffer
): Promise<void> {
  if (!isR2Enabled()) throw new Error('R2 is not enabled')
  const res = await r2Fetch(
    'PUT',
    r2ObjectPath(r2ImageKey(jobId)),
    undefined,
    image,
    'image/png'
  )
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`R2 upload failed (HTTP ${res.status})`)
  }
}

/** Returns the image buffer, or null when the object does not exist. */
export async function fetchR2Image(jobId: string): Promise<Buffer | null> {
  if (!isR2Enabled()) return null
  const res = await r2Fetch(
    'GET',
    r2ObjectPath(r2ImageKey(jobId)),
    undefined,
    undefined,
    undefined
  )
  if (res.status === 404) return null
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`R2 fetch failed (HTTP ${res.status})`)
  }
  return res.buffer
}
