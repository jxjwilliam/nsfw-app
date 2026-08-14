export function formatRunningHubError(errorCode?: string, errorMessage?: string): string {
  if (!errorMessage?.trim()) {
    return errorCode ? `RunningHub error ${errorCode}` : 'RunningHub API error'
  }
  const msg = errorMessage.trim()
  if (errorCode === '1014' || msg.includes('Enterprise-Shared')) {
    return (
      'Your API key cannot call Standard Model APIs (e.g. 全能图片G-2). ' +
      'RunningHub requires an Enterprise-Shared API key for this endpoint. ' +
      'Upgrade in RunningHub API console, or use a ComfyUI workflow API instead. ' +
      `(RH ${errorCode ?? '1014'})`
    )
  }
  if (
    errorCode === '1501' ||
    msg.includes('Content security') ||
    msg.includes('内容安全')
  ) {
    return (
      'RunningHub content safety blocked this prompt (RH 1501). ' +
      'There is no API flag to disable this on Standard Model APIs. ' +
      'Try softer wording, a ComfyUI uncensored workflow, or another provider. ' +
      (errorCode ? `(${msg})` : '')
    )
  }
  if (errorCode === '1505' || msg.includes('Real people') || msg.includes('真人')) {
    return (
      'RunningHub blocked real-person content (RH 1505). Use anime/illustration style or a different workflow.'
    )
  }
  return errorCode ? `${msg} (RH ${errorCode})` : msg
}

/** ComfyUI task API errors (code in message like "… (code 810)"). */
export function formatComfyUiError(message: string): string {
  const codeMatch = message.match(/\(code (\d+)\)/)
  const code = codeMatch?.[1]

  if (
    code === '810' ||
    message.includes('WORKFLOW_NOT_SAVED_OR_NOT_RUNNING')
  ) {
    return (
      'RunningHub workflow is not ready (RH 810). Open the workflow on runninghub.cn, save it, run it once in the UI, then retry. ' +
      'Verify with GET /api/workflow-setup (see runninghub/workflows/README.md).'
    )
  }

  if (code === '801' || message.includes('WORKFLOW_NOT_FOUND')) {
    return (
      'RunningHub workflow ID not found (RH 801). Re-import runninghub/workflows/sdxl-txt2img-api.json and update RH_WORKFLOW_ID in .env.local.'
    )
  }

  return formatRunningHubError(code, message.replace(/^ComfyUI [^:]+: /, '').replace(/ \(code \d+\)$/, ''))
}

export function comfyErrorStatus(message: string): number {
  if (message.includes('RH_API_KEY')) return 503
  if (message.startsWith('ComfyUI') || message.includes('RunningHub')) return 502
  return 500
}

export function isRunningHubApiError(payload: {
  errorCode?: string
  errorMessage?: string
  estimatedPrice?: number | null
}): boolean {
  if (payload.errorCode && payload.errorCode !== '0' && payload.errorCode !== '') {
    return true
  }
  if (payload.errorMessage?.trim()) return true
  if (payload.estimatedPrice == null || Number.isNaN(payload.estimatedPrice)) {
    return true
  }
  return false
}
