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
