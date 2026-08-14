import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildViewUrl,
  getHistoryResult,
  pingComfy,
  submitPrompt,
} from './local-comfy'

const BASE = 'http://localhost:8188'

function fakeFetch(
  impl: (url: string, init?: RequestInit) => Promise<unknown>
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const data = await impl(url, init)
      return {
        ok: true,
        status: 200,
        json: async () => data,
        text: async () => JSON.stringify(data),
      } as unknown as Response
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('submitPrompt', () => {
  it('posts the graph and returns prompt_id', async () => {
    let sent: unknown
    fakeFetch(async (url, init) => {
      sent = init?.body
      return { prompt_id: 'abc-123' }
    })
    await expect(
      submitPrompt({ '4': { class_type: 'X' } }, BASE)
    ).resolves.toBe('abc-123')
    expect(sent).toContain('"prompt"')
  })

  it('maps ComfyUI error payloads to LocalComfy errors', async () => {
    fakeFetch(async () => ({ error: { message: 'ckpt not found' } }))
    await expect(submitPrompt({}, BASE)).rejects.toThrow(
      'LocalComfy submit error: ckpt not found'
    )
  })
})

describe('pingComfy', () => {
  it('succeeds when system_stats is reachable', async () => {
    fakeFetch(async () => ({ system: {} }))
    await expect(pingComfy(BASE)).resolves.toBeUndefined()
  })
})

describe('buildViewUrl', () => {
  it('encodes filename, subfolder and type', () => {
    expect(
      buildViewUrl(
        { filename: 'a b.png', subfolder: 'sub/f', type: 'output' },
        BASE
      )
    ).toBe(
      'http://localhost:8188/view?filename=a+b.png&type=output&subfolder=sub%2Ff'
    )
  })
})

describe('getHistoryResult', () => {
  it('returns RUNNING when no history entry exists', async () => {
    fakeFetch(async () => ({}))
    await expect(getHistoryResult('p1', BASE)).resolves.toEqual({
      status: 'RUNNING',
    })
  })

  it('returns SUCCESS with the first image', async () => {
    fakeFetch(async () => ({
      p1: {
        outputs: {
          '9': {
            images: [{ filename: 'x.png', subfolder: '', type: 'output' }],
          },
        },
        status: { status_str: 'success', completed: true },
      },
    }))
    await expect(getHistoryResult('p1', BASE)).resolves.toEqual({
      status: 'SUCCESS',
      image: { filename: 'x.png', subfolder: '', type: 'output' },
    })
  })

  it('returns FAILED with the execution error message', async () => {
    fakeFetch(async () => ({
      p1: {
        outputs: {},
        status: {
          status_str: 'error',
          completed: false,
          messages: [{ execution_error: { exception_message: 'OOM' } }],
        },
      },
    }))
    await expect(getHistoryResult('p1', BASE)).resolves.toEqual({
      status: 'FAILED',
      errorMessage: 'OOM',
    })
  })
})