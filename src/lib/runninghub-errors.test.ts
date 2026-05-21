import { describe, it, expect } from 'vitest'
import { formatRunningHubError, isRunningHubApiError } from './runninghub-errors'

describe('isRunningHubApiError', () => {
  it('detects errorCode', () => {
    expect(isRunningHubApiError({ errorCode: '1014', estimatedPrice: null })).toBe(true)
  })
})

describe('formatRunningHubError', () => {
  it('explains enterprise key requirement for 1014', () => {
    const msg = formatRunningHubError(
      '1014',
      'Access Denied: Standard Model API is restricted to Enterprise-Shared API Keys only.'
    )
    expect(msg).toContain('Enterprise-Shared')
    expect(msg).toContain('1014')
  })
})
