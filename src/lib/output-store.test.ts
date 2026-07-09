import { describe, it, expect } from 'vitest'

import { findRunByJobId, listHistory } from './output-store'

describe('output-store on symlinked exFAT outputs', () => {
  it('listHistory skips AppleDouble entries', async () => {
    const items = await listHistory(500)
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((e) => !e.jobId.startsWith('._'))).toBe(true)
  })

  it('findRunByJobId resolves a known job folder', async () => {
    const items = await listHistory(1)
    if (items.length === 0) return

    const found = await findRunByJobId(items[0].jobId)
    expect(found?.jobId).toBe(items[0].jobId)
    expect(found?.outputDir).toBeTruthy()
  })
})
