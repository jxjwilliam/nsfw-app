import {
  formatRunningHubError,
  isRunningHubApiError,
} from './runninghub-errors'

const BASE = 'https://www.runninghub.cn'

function getApiKey(): string {
  const key = process.env.RH_API_KEY
  if (!key) throw new Error('RH_API_KEY is not set in .env.local')
  return key
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  }
}

export type SubmitBody = {
  prompt: string
  aspectRatio: string
  resolution: string
  quality: string
}

export type SubmitResponse = {
  taskId: string
  status: string
  errorCode?: string
  errorMessage?: string
  results?: Array<{ url?: string | null }> | null
}

export type QueryResponse = SubmitResponse & {
  usage?: Record<string, unknown> | null
}

export type PricePreviewResponse = {
  estimatedPrice: number
  currency: string
  errorCode?: string
  errorMessage?: string
}

export async function pricePreview(
  route: string,
  body: SubmitBody
): Promise<PricePreviewResponse> {
  const res = await fetch(`${BASE}/openapi/v2/price-preview/${route}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`price-preview failed ${res.status}: ${text}`)
  }
  const data = (await res.json()) as PricePreviewResponse
  if (isRunningHubApiError(data)) {
    throw new Error(formatRunningHubError(data.errorCode, data.errorMessage))
  }
  return data
}

export async function submitTask(
  route: string,
  body: SubmitBody
): Promise<SubmitResponse> {
  const res = await fetch(`${BASE}/openapi/v2/${route}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`submit failed ${res.status}: ${text}`)
  }
  const data = (await res.json()) as SubmitResponse
  if (data.errorCode || data.errorMessage) {
    throw new Error(formatRunningHubError(data.errorCode, data.errorMessage))
  }
  if (!data.taskId) {
    throw new Error('RunningHub submit returned no taskId')
  }
  return data
}

export async function queryTask(taskId: string): Promise<QueryResponse> {
  const res = await fetch(`${BASE}/openapi/v2/query`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ taskId }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`query failed ${res.status}: ${text}`)
  }
  return res.json()
}

export async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
