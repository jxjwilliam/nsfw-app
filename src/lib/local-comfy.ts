const DEFAULT_URL = 'http://localhost:8188'

export function getLocalComfyUrl(): string {
  return process.env.LOCAL_COMFY_URL?.trim() || DEFAULT_URL
}

export type ComfyImageRef = {
  filename: string
  subfolder: string
  type: string
}

export type ComfyHistoryResult =
  | { status: 'SUCCESS'; image: ComfyImageRef }
  | { status: 'FAILED'; errorMessage: string }
  | { status: 'RUNNING' }

export async function pingComfy(base = getLocalComfyUrl()): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await fetch(`${base}/system_stats`, {
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`LocalComfy health check failed: HTTP ${res.status}`)
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`LocalComfy not reachable at ${base} (timeout)`)
    }
    if (e instanceof Error && e.message.startsWith('LocalComfy')) throw e
    throw new Error(
      `LocalComfy not reachable at ${base}: ${
        e instanceof Error ? e.message : String(e)
      }`
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function submitPrompt(
  graph: Record<string, unknown>,
  base = getLocalComfyUrl()
): Promise<string> {
  const res = await fetch(`${base}/api/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LocalComfy submit failed ${res.status}: ${text}`)
  }
  const data = (await res.json()) as {
    prompt_id?: string
    error?: { message?: string }
  }
  if (data.error) {
    throw new Error(
      `LocalComfy submit error: ${data.error.message ?? 'unknown error'}`
    )
  }
  if (!data.prompt_id) throw new Error('LocalComfy submit returned no prompt_id')
  return data.prompt_id
}

export function buildViewUrl(
  image: ComfyImageRef,
  base = getLocalComfyUrl()
): string {
  const params = new URLSearchParams({
    filename: image.filename,
    type: image.type,
  })
  if (image.subfolder) params.set('subfolder', image.subfolder)
  return `${base}/view?${params.toString()}`
}

function extractComfyError(entry: {
  status?: { messages?: unknown[] }
}): string {
  const messages = entry.status?.messages ?? []
  for (const msg of messages) {
    if (msg && typeof msg === 'object' && 'execution_error' in msg) {
      const err = (msg as { execution_error?: { exception_message?: string } })
        .execution_error
      if (err?.exception_message) return err.exception_message
    }
  }
  return 'LocalComfy execution error'
}

export async function getHistoryResult(
  promptId: string,
  base = getLocalComfyUrl()
): Promise<ComfyHistoryResult> {
  const res = await fetch(`${base}/api/history/${promptId}`)
  if (!res.ok) {
    throw new Error(`LocalComfy history failed ${res.status}`)
  }
  const data = (await res.json()) as Record<
    string,
    {
      outputs?: Record<string, { images?: ComfyImageRef[] }>
      status?: {
        status_str?: string
        completed?: boolean
        messages?: unknown[]
      }
    }
  >
  const entry = data[promptId]
  if (!entry?.status?.status_str) return { status: 'RUNNING' }

  const s = entry.status.status_str
  if (s === 'success') {
    for (const nodeOutput of Object.values(entry.outputs ?? {})) {
      const img = nodeOutput.images?.[0]
      if (img) return { status: 'SUCCESS', image: img }
    }
    return {
      status: 'FAILED',
      errorMessage: 'LocalComfy succeeded but produced no image',
    }
  }
  if (s === 'error') {
    return { status: 'FAILED', errorMessage: extractComfyError(entry) }
  }
  return { status: 'RUNNING' }
}