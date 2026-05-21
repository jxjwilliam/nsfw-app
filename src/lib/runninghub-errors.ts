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
