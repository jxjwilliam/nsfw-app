const BASE = 'https://www.runninghub.cn'

export type NodeInfo = {
  nodeId: string
  fieldName: string
  fieldValue: string
}

export type ComfyCreateResponse = {
  code: number
  msg: string
  data?: {
    taskId?: string
    promptTips?: string
  } | null
}

export type ComfyOutputFile = {
  fileUrl?: string
  fileType?: string
  taskCostTime?: string
  nodeId?: string
}

export type ComfyOutputsResponse = {
  code: number
  msg: string
  data?: ComfyOutputFile[] | { failedReason?: Record<string, unknown> } | null
}

function getApiKey(): string {
  const key = process.env.RH_API_KEY
  if (!key) throw new Error('RH_API_KEY is not set in .env.local')
  return key
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
      Host: 'www.runninghub.cn',
    },
    body: JSON.stringify({ apiKey: getApiKey(), ...body }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`ComfyUI ${path} failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export async function getWorkflowJson(workflowId: string): Promise<string> {
  const res = await postJson<{
    code: number
    msg: string
    data?: { prompt?: string }
  }>('/api/openapi/getJsonApiFormat', { workflowId })

  if (res.code !== 0) {
    throw new Error(`getWorkflowJson: ${res.msg} (code ${res.code})`)
  }
  const prompt = res.data?.prompt
  if (!prompt) throw new Error('getWorkflowJson: no prompt JSON in response')
  return prompt
}

export async function submitComfyTask(
  workflowId: string,
  nodeInfoList: NodeInfo[]
): Promise<{ taskId: string }> {
  const res = await postJson<ComfyCreateResponse>('/task/openapi/create', {
    workflowId,
    nodeInfoList,
  })

  if (res.code !== 0) {
    throw new Error(`ComfyUI create: ${res.msg} (code ${res.code})`)
  }
  const taskId = res.data?.taskId
  if (!taskId) throw new Error('ComfyUI create returned no taskId')
  return { taskId }
}

/** Poll ComfyUI task via outputs endpoint (804 running, 813 queued, 805 failed, 0 done). */
export async function queryComfyOutputs(taskId: string): Promise<{
  status: 'RUNNING' | 'QUEUED' | 'SUCCESS' | 'FAILED'
  fileUrl?: string
  errorMessage?: string
  raw?: ComfyOutputsResponse
}> {
  const res = await postJson<ComfyOutputsResponse>('/task/openapi/outputs', {
    taskId,
  })

  if (res.code === 0 && Array.isArray(res.data) && res.data[0]?.fileUrl) {
    return { status: 'SUCCESS', fileUrl: res.data[0].fileUrl, raw: res }
  }

  if (res.code === 805) {
    const data = res.data
    let err = res.msg
    if (data && !Array.isArray(data) && data.failedReason) {
      const fr = data.failedReason as {
        node_name?: string
        exception_message?: string
      }
      err = [fr.node_name, fr.exception_message].filter(Boolean).join(': ') || err
    }
    return { status: 'FAILED', errorMessage: err, raw: res }
  }

  if (res.code === 804) {
    return { status: 'RUNNING', raw: res }
  }

  if (res.code === 813) {
    return { status: 'QUEUED', raw: res }
  }

  return {
    status: 'FAILED',
    errorMessage: res.msg || `unknown ComfyUI outputs code ${res.code}`,
    raw: res,
  }
}

export function listEditableNodesFromPromptJson(promptJson: string): NodeInfo[] {
  const graph = JSON.parse(promptJson) as Record<
    string,
    { class_type?: string; inputs?: Record<string, unknown> }
  >
  const list: NodeInfo[] = []

  for (const [nodeId, node] of Object.entries(graph)) {
    const inputs = node.inputs ?? {}
    for (const [fieldName, fieldValue] of Object.entries(inputs)) {
      if (Array.isArray(fieldValue) || typeof fieldValue === 'object') {
        continue
      }
      list.push({
        nodeId,
        fieldName,
        fieldValue: String(fieldValue),
      })
    }
  }

  return list
}
