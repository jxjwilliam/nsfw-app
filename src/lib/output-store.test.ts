import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

vi.mock('./runninghub', () => ({
  downloadImage: vi.fn(async () => Buffer.from('file-bytes')),
}))

vi.mock('./r2', () => ({
  isR2Enabled: vi.fn(() => true),
  uploadR2Image: vi.fn(async () => {
    throw new Error('R2 upload failed (HTTP 411)')
  }),
}))

import {
  initJobDir,
  listHistory,
  findRunDirByJobId,
  finalizeSuccess,
  findRunByJobId,
} from './output-store'
import type { PlanSnapshot, RunMetadata } from './types'

function makePlan(mediaType?: 'image' | 'video'): PlanSnapshot {
  return {
    planId: 'plan-1',
    createdAt: new Date().toISOString(),
    request: { prompt: 'p', style: 'anime', aspectRatio: '1:1', qualityTier: 'low', mediaType },
    mediaType,
    mode: 'local-comfy',
    route: 'local/comfyui',
    modelId: 'm.safetensors',
    modelLabel: 'Local',
    params: { prompt: 'p', aspectRatio: '1:1', resolution: 'workflow', quality: 'low' },
    originalPrompt: 'p',
    estimatedPrice: 0,
    currency: 'CNY',
    reason: 'r',
    alternatives: [],
  }
}

function makeMeta(jobId: string, createdAt: string): RunMetadata {
  return {
    jobId,
    taskId: 't',
    createdAt,
    prompt: 'p',
    enhancedPrompt: 'p',
    style: 'anime',
    aspectRatio: '1:1',
    qualityTier: 'low',
    route: 'local/comfyui',
    modelLabel: 'Local',
    estimatedPrice: 0,
    status: 'SUCCESS',
  }
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'output-store-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

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

describe('initJobDir media routing', () => {
  it('routes image jobs to images/<jobId>', async () => {
    const dir = await initJobDir('job-img', makePlan('image'), 'task-1', root)
    expect(dir).toBe(path.join(root, 'images', 'job-img'))
    const meta = JSON.parse(await readFile(path.join(dir, 'metadata.json'), 'utf-8')) as RunMetadata
    expect(meta.mediaType).toBe('image')
  })

  it('routes video jobs to video/<jobId>', async () => {
    const dir = await initJobDir('job-vid', makePlan('video'), 'task-2', root)
    expect(dir).toBe(path.join(root, 'video', 'job-vid'))
    const meta = JSON.parse(await readFile(path.join(dir, 'metadata.json'), 'utf-8')) as RunMetadata
    expect(meta.mediaType).toBe('video')
  })

  it('defaults to images when plan has no mediaType', async () => {
    const dir = await initJobDir('job-old', makePlan(undefined), 'task-3', root)
    expect(dir).toBe(path.join(root, 'images', 'job-old'))
  })
})

describe('listHistory layout', () => {
  it('merges media dirs and legacy day dirs, newest first, skipping raw and dotfiles', async () => {
    const vidDir = path.join(root, 'video', 'job-vid')
    const imgDir = path.join(root, 'images', 'job-img')
    const legacyDir = path.join(root, '2026-08-01', 'job-legacy')
    const rawDir = path.join(root, 'images', 'raw')
    await mkdir(vidDir, { recursive: true })
    await mkdir(imgDir, { recursive: true })
    await mkdir(legacyDir, { recursive: true })
    await mkdir(rawDir, { recursive: true })
    await writeFile(path.join(vidDir, 'metadata.json'), JSON.stringify(makeMeta('job-vid', '2026-08-14T03:00:00.000Z')))
    await writeFile(path.join(imgDir, 'metadata.json'), JSON.stringify(makeMeta('job-img', '2026-08-14T02:00:00.000Z')))
    await writeFile(path.join(legacyDir, 'metadata.json'), JSON.stringify(makeMeta('job-legacy', '2026-08-01T01:00:00.000Z')))
    await writeFile(path.join(rawDir, '._junk'), 'x')

    const items = await listHistory(50, root)
    expect(items.map((i) => i.jobId)).toEqual(['job-vid', 'job-img', 'job-legacy'])
  })

  it('returns [] when the root does not exist', async () => {
    expect(await listHistory(50, path.join(root, 'missing'))).toEqual([])
  })
})

describe('findRunDirByJobId', () => {
  it('finds jobs in video dir and legacy day dirs', async () => {
    const vidDir = path.join(root, 'video', 'job-vid')
    const legacyDir = path.join(root, '2026-08-01', 'job-legacy')
    await mkdir(vidDir, { recursive: true })
    await mkdir(legacyDir, { recursive: true })
    await writeFile(path.join(vidDir, 'metadata.json'), JSON.stringify(makeMeta('job-vid', '2026-08-14T03:00:00.000Z')))
    await writeFile(path.join(legacyDir, 'metadata.json'), JSON.stringify(makeMeta('job-legacy', '2026-08-01T01:00:00.000Z')))

    expect(await findRunDirByJobId('job-vid', root)).toBe(vidDir)
    expect(await findRunDirByJobId('job-legacy', root)).toBe(legacyDir)
    expect(await findRunDirByJobId('nope', root)).toBeNull()
  })
})

describe('finalizeSuccess media file', () => {
  it('writes video.mp4 and sets videoFile for video jobs', async () => {
    const dir = await initJobDir('job-vid', makePlan('video'), 'task-9', root)
    const meta = makeMeta('job-vid', '2026-08-14T03:00:00.000Z')
    meta.mediaType = 'video'
    await finalizeSuccess(dir, meta, 'http://localhost:8188/view?x=1')
    const written = JSON.parse(await readFile(path.join(dir, 'metadata.json'), 'utf-8')) as RunMetadata
    expect(written.videoFile).toBe('video.mp4')
    expect(written.imageFile).toBeUndefined()
    expect(written.status).toBe('SUCCESS')
  })

  it('writes image.png and sets imageFile for image jobs', async () => {
    const dir = await initJobDir('job-img', makePlan('image'), 'task-10', root)
    const meta = makeMeta('job-img', '2026-08-14T02:00:00.000Z')
    await finalizeSuccess(dir, meta, 'http://localhost:8188/view?x=2')
    const written = JSON.parse(await readFile(path.join(dir, 'metadata.json'), 'utf-8')) as RunMetadata
    expect(written.imageFile).toBe('image.png')
    expect(written.videoFile).toBeUndefined()
  })

  it('records and logs persistError when the R2 mirror fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const dir = await initJobDir('job-img', makePlan('image'), 'task-11', root)
      const meta = makeMeta('job-img', '2026-08-14T02:00:00.000Z')
      await finalizeSuccess(dir, meta, 'http://localhost:8188/view?x=3')

      const written = JSON.parse(
        await readFile(path.join(dir, 'metadata.json'), 'utf-8')
      ) as RunMetadata
      expect(written.persistError).toContain('R2 upload failed (HTTP 411)')
      expect(errorSpy).toHaveBeenCalledWith(
        'R2 upload failed for job',
        'job-img',
        'R2 upload failed (HTTP 411)'
      )
    } finally {
      errorSpy.mockRestore()
    }
  })
})
