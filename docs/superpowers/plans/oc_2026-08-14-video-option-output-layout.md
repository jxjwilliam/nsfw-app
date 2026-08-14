# Video Option + `nsfw/images|video` Output Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Media (Image/Video) choice to the UI — Video generates a short AnimateDiff mp4 via local ComfyUI — and restructure outputs into `outputs/nsfw/images/<jobId>/` and `outputs/nsfw/video/<jobId>/`.

**Architecture:** One `mediaType` field flows PlanRequest → PlanSnapshot → RunMetadata → job dir. The local planner branches on it (existing SDXL image graph, or an AnimateDiff SD1.5 graph ported from `scripts/generate-animatediff-video.js`). History reads the two new media dirs plus legacy `YYYY-MM-DD/` dirs. Video is local-only, guarded at plan time.

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest (colocated, no config), local ComfyUI with AnimateDiff-Evolved + VideoHelperSuite custom nodes.

**Spec:** `docs/superpowers/specs/oc_2026-08-14-video-option-output-layout-design.md`

## Global Constraints

- Commit messages: semantic lowercase (`feat:`, `fix:`, `docs:`, `test:`).
- Error prefix convention is load-bearing: local client errors start `LocalComfy:`, RunningHub comfy errors start `ComfyUI`. Keep prefixes.
- Never let Tailwind scan `local-comfyui/checkpoints/` — do not touch `src/app/globals.css`.
- `outputs/` is a symlink to an exFAT drive: every directory scan must skip dotfiles and `._*` AppleDouble entries (existing `isVisibleEntry` helper).
- No `as any`, no `@ts-ignore`, no `@ts-expect-error` anywhere, including tests.
- `mediaType` is optional in all types; normalize with `?? 'image'`. No migration of old `.plans/*.json` or `metadata.json` files.
- Do not edit `scripts/`, `runninghub/`, or `local-comfyui/workflows/`.
- Video guard message (verbatim, the plan route matches on its prefix): `Video generation requires BACKEND=local (AnimateDiff runs on your local ComfyUI). Set BACKEND=local in .env.local and restart the dev server.`
- Test convention: `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'`; save/restore env vars in `beforeEach`/`afterEach` (see `src/lib/router.test.ts`).

---

### Task 1: `MediaType` + output layout restructure

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/output-store.ts`
- Test: `src/lib/output-store.test.ts` (exists with 2 tests — extend; read it first, keep its tests passing, merge the mocks/imports below rather than duplicating them)

**Interfaces:**
- Consumes: nothing (first task).
- Produces (later tasks rely on these exact names):
  - `type MediaType = 'image' | 'video'` (from `./types`)
  - `PlanRequest.mediaType?: MediaType`, `PlanSnapshot.mediaType?: MediaType`
  - `RunMetadata.mediaType?: MediaType`, `RunMetadata.videoFile?: string`
  - `outputDirForJob(jobId: string, mediaType?: MediaType, root?: string): string`
  - `initJobDir(jobId: string, plan: PlanSnapshot, taskId: string, root?: string): Promise<string>`
  - `listHistory(limit?: number, root?: string)`, `findRunDirByJobId(jobId: string, root?: string)`

- [ ] **Step 1: Write the failing tests** — `src/lib/output-store.test.ts` already exists with 2 tests. Read it first, keep all existing tests, and merge in the following content (merge the `vi.mock('./runninghub')` call and the imports into the existing file rather than duplicating them):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

vi.mock('./runninghub', () => ({
  downloadImage: vi.fn(async () => Buffer.from('file-bytes')),
}))

import {
  initJobDir,
  listHistory,
  findRunDirByJobId,
  finalizeSuccess,
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
    jobId, taskId: 't', createdAt, prompt: 'p', enhancedPrompt: 'p',
    style: 'anime', aspectRatio: '1:1', qualityTier: 'low',
    route: 'local/comfyui', modelLabel: 'Local', estimatedPrice: 0,
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

describe('initJobDir media routing', () => {
  it('routes image jobs to nsfw/images/<jobId>', async () => {
    const dir = await initJobDir('job-img', makePlan('image'), 'task-1', root)
    expect(dir).toBe(path.join(root, 'nsfw', 'images', 'job-img'))
    const meta = JSON.parse(await readFile(path.join(dir, 'metadata.json'), 'utf-8')) as RunMetadata
    expect(meta.mediaType).toBe('image')
  })

  it('routes video jobs to nsfw/video/<jobId>', async () => {
    const dir = await initJobDir('job-vid', makePlan('video'), 'task-2', root)
    expect(dir).toBe(path.join(root, 'nsfw', 'video', 'job-vid'))
    const meta = JSON.parse(await readFile(path.join(dir, 'metadata.json'), 'utf-8')) as RunMetadata
    expect(meta.mediaType).toBe('video')
  })

  it('defaults to images when plan has no mediaType', async () => {
    const dir = await initJobDir('job-old', makePlan(undefined), 'task-3', root)
    expect(dir).toBe(path.join(root, 'nsfw', 'images', 'job-old'))
  })
})

describe('listHistory layout', () => {
  it('merges media dirs and legacy day dirs, newest first, skipping raw and dotfiles', async () => {
    const vidDir = path.join(root, 'nsfw', 'video', 'job-vid')
    const imgDir = path.join(root, 'nsfw', 'images', 'job-img')
    const legacyDir = path.join(root, '2026-08-01', 'job-legacy')
    const rawDir = path.join(root, 'nsfw', 'images', 'raw')
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
    const vidDir = path.join(root, 'nsfw', 'video', 'job-vid')
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/output-store.test.ts`
Expected: FAIL — `outputDirForJob`/`initJobDir` have no media/root params; `finalizeSuccess` always writes `image.png`.

- [ ] **Step 3: Add `MediaType` to `src/lib/types.ts`**

Add after line 2 (`QualityTier`):

```ts
export type MediaType = 'image' | 'video'
```

In `PlanRequest`, add after `qualityTier: QualityTier`:

```ts
  mediaType?: MediaType
```

In `PlanSnapshot`, add after `mode?: ApiMode`:

```ts
  mediaType?: MediaType
```

In `RunMetadata`, add after `imageFile?: string`:

```ts
  videoFile?: string
  mediaType?: MediaType
```

- [ ] **Step 4: Rewrite `src/lib/output-store.ts` layout functions**

Replace `outputDirForJob`, `initJobDir`, `finalizeSuccess`, `listHistory`, and `findRunDirByJobId` with the following (keep `outputsRoot`, `isVisibleEntry`, `finalizeFailed`, and `findRunByJobId` as they are; `listJobDirs` stays as the generic "visible subdirs" helper). Add the import: `import type { MediaType, PlanSnapshot, RunMetadata } from './types'` (replacing the existing type import line). Keep the existing `import { isR2Enabled, uploadR2Image } from './r2'` line untouched — the R2 mirror block in `finalizeSuccess` (included in the code below) must be preserved verbatim. The `root` parameter is the outputs root itself — the directory that directly contains `nsfw/` and the legacy day dirs; the default `outputsRoot()` keeps production paths unchanged.

```ts
const DAY_DIR_RE = /^\d{4}-\d{2}-\d{2}$/

async function listDayDirs(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  return entries
    .filter((e: Dirent) => e.isDirectory() && DAY_DIR_RE.test(e.name))
    .map((e) => e.name)
}

function mediaSubdir(mediaType: MediaType): string {
  return mediaType === 'video' ? 'video' : 'images'
}

export function outputDirForJob(
  jobId: string,
  mediaType: MediaType = 'image',
  root = outputsRoot()
): string {
  return path.join(root, 'nsfw', mediaSubdir(mediaType), jobId)
}

export async function initJobDir(
  jobId: string,
  plan: PlanSnapshot,
  taskId: string,
  root = outputsRoot()
): Promise<string> {
  const mediaType = plan.mediaType ?? 'image'
  const dir = outputDirForJob(jobId, mediaType, root)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2))
  const meta: RunMetadata = {
    jobId,
    taskId,
    createdAt: new Date().toISOString(),
    apiMode: plan.mode ?? (plan.route.startsWith('comfyui') ? 'comfy' : 'standard'),
    mediaType,
    prompt: plan.originalPrompt,
    enhancedPrompt: plan.params.prompt,
    style: plan.request.style,
    aspectRatio: plan.request.aspectRatio,
    qualityTier: plan.request.qualityTier,
    route: plan.route,
    modelLabel: plan.modelLabel,
    estimatedPrice: plan.estimatedPrice,
    status: 'RUNNING',
  }
  await writeFile(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2))
  return dir
}

export async function finalizeSuccess(
  dir: string,
  meta: RunMetadata,
  fileUrl: string,
  usage?: Record<string, unknown> | null
): Promise<void> {
  const buf = await downloadImage(fileUrl)
  const isVideo = meta.mediaType === 'video'
  const file = isVideo ? 'video.mp4' : 'image.png'
  await writeFile(path.join(dir, file), buf)
  meta.status = 'SUCCESS'
  if (isVideo) {
    meta.videoFile = file
  } else {
    meta.imageFile = file
  }
  meta.actualUsage = usage ?? undefined
  await writeFile(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2))

  // Cloud (Vercel) only: mirror the image to R2 so the run survives a cold
  // start wiping /tmp. Local dev never reaches this branch. (Video jobs are
  // local-only, so the mirror effectively applies to images only.)
  if (isR2Enabled()) {
    let persistError: string | undefined
    try {
      await uploadR2Image(meta.jobId, buf)
    } catch (e) {
      persistError = e instanceof Error ? e.message : String(e)
    }
    if (persistError) {
      meta.persistError = persistError
      // Keep the locally visible record in sync even when the mirror failed.
      await writeFile(
        path.join(dir, 'metadata.json'),
        JSON.stringify(meta, null, 2)
      )
    }
  }
}

async function scanJobDir(
  dir: string
): Promise<(RunMetadata & { outputDir: string }) | null> {
  try {
    const raw = await readFile(path.join(dir, 'metadata.json'), 'utf-8')
    const meta = JSON.parse(raw) as RunMetadata
    return { ...meta, outputDir: dir }
  } catch {
    return null
  }
}

async function scanParent(
  parentPath: string
): Promise<Array<RunMetadata & { outputDir: string }>> {
  const out: Array<RunMetadata & { outputDir: string }> = []
  let names: string[]
  try {
    names = await listJobDirs(parentPath)
  } catch {
    return out
  }
  for (const name of names) {
    if (name === 'raw') continue
    const hit = await scanJobDir(path.join(parentPath, name))
    if (hit) out.push(hit)
  }
  return out
}

export async function listHistory(
  limit = 50,
  root = outputsRoot()
): Promise<Array<RunMetadata & { outputDir: string }>> {
  const entries: Array<RunMetadata & { outputDir: string }> = []
  entries.push(...(await scanParent(path.join(root, 'nsfw', 'images'))))
  entries.push(...(await scanParent(path.join(root, 'nsfw', 'video'))))
  try {
    const days = await listDayDirs(root)
    for (const day of days) {
      entries.push(...(await scanParent(path.join(root, day))))
    }
  } catch {
    /* no readable root */
  }
  return entries
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

/** Direct lookup — avoids scanning full history (and survives exFAT AppleDouble junk). */
export async function findRunDirByJobId(
  jobId: string,
  root = outputsRoot()
): Promise<string | null> {
  const mediaDirs = [
    path.join(root, 'nsfw', 'images', jobId),
    path.join(root, 'nsfw', 'video', jobId),
  ]
  for (const dir of mediaDirs) {
    try {
      await readFile(path.join(dir, 'metadata.json'), 'utf-8')
      return dir
    } catch {
      /* try next */
    }
  }
  try {
    const days = (await listDayDirs(root)).sort().reverse()
    for (const day of days) {
      const dir = path.join(root, day, jobId)
      try {
        await readFile(path.join(dir, 'metadata.json'), 'utf-8')
        return dir
      } catch {
        /* try next day */
      }
    }
  } catch {
    return null
  }
  return null
}
```

Note: the old `listHistory` body and old `listDayDirs` (which accepted any visible dir as a day) are fully replaced. `findRunByJobId` keeps its signature and now benefits from the widened `findRunDirByJobId`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/output-store.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Run existing suites for regressions**

Run: `npx vitest run`
Expected: PASS — all pre-existing suites still green (`listHistory`/`findRunDirByJobId` defaults keep production behavior; `image.png` write preserved for image jobs).

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/output-store.ts src/lib/output-store.test.ts
git commit -m "feat: route job outputs to nsfw/images and nsfw/video by mediaType"
```

---

### Task 2: AnimateDiff video builder + image raw prefix in the local planner

**Files:**
- Modify: `src/lib/local-plan.ts`
- Test: `src/lib/local-plan.test.ts` (extend)

**Interfaces:**
- Consumes: `MediaType` + `PlanRequest.mediaType` (Task 1).
- Produces:
  - `buildLocalVideoWorkflow(request: PlanRequest, enhancedPrompt: string): Record<string, unknown>`
  - `resolveVideoDimensions(aspectRatio: string): { width: number; height: number }`
  - `createLocalPlan` sets `PlanSnapshot.mediaType = 'video'` for video requests; image SaveImage prefix becomes `nsfw/images/raw/nsfw-app-<style>`.
  - Env overrides: `LOCAL_VIDEO_CKPT` (default `realisticVisionV51_v51VAE.safetensors`), `LOCAL_VIDEO_MOTION` (default `mm_sd_v15_v2.ckpt`).

- [ ] **Step 1: Write the failing tests** — append to `src/lib/local-plan.test.ts` (merge the new imports into the existing import from `'./local-plan'`; keep everything already in the file). Define this helper at the top of the new block:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  buildLocalVideoWorkflow,
  resolveVideoDimensions,
  buildLocalWorkflow,
} from './local-plan'
import type { PlanRequest } from './types'

type Graph = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>

function videoRequest(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    prompt: 'a woman dancing',
    style: 'realistic',
    aspectRatio: '1:1',
    qualityTier: 'medium',
    mediaType: 'video',
    ...overrides,
  }
}

describe('resolveVideoDimensions', () => {
  it('maps aspect ratios to AnimateDiff-safe sizes', () => {
    expect(resolveVideoDimensions('1:1')).toEqual({ width: 512, height: 512 })
    expect(resolveVideoDimensions('9:16')).toEqual({ width: 512, height: 768 })
    expect(resolveVideoDimensions('2:3')).toEqual({ width: 512, height: 768 })
    expect(resolveVideoDimensions('3:4')).toEqual({ width: 512, height: 768 })
    expect(resolveVideoDimensions('16:9')).toEqual({ width: 768, height: 512 })
    expect(resolveVideoDimensions('3:2')).toEqual({ width: 768, height: 512 })
    expect(resolveVideoDimensions('4:3')).toEqual({ width: 768, height: 512 })
  })
})

describe('buildLocalVideoWorkflow', () => {
  const prevCkpt = process.env.LOCAL_VIDEO_CKPT
  const prevMotion = process.env.LOCAL_VIDEO_MOTION

  beforeEach(() => {
    delete process.env.LOCAL_VIDEO_CKPT
    delete process.env.LOCAL_VIDEO_MOTION
  })

  afterEach(() => {
    if (prevCkpt === undefined) delete process.env.LOCAL_VIDEO_CKPT
    else process.env.LOCAL_VIDEO_CKPT = prevCkpt
    if (prevMotion === undefined) delete process.env.LOCAL_VIDEO_MOTION
    else process.env.LOCAL_VIDEO_MOTION = prevMotion
  })

  it('builds the AnimateDiff graph with defaults', () => {
    const g = buildLocalVideoWorkflow(videoRequest(), 'enhanced prompt') as Graph

    expect(g['4'].class_type).toBe('CheckpointLoaderSimple')
    expect(g['4'].inputs.ckpt_name).toBe('realisticVisionV51_v51VAE.safetensors')

    expect(g['6'].class_type).toBe('ADE_AnimateDiffLoaderGen1')
    expect(g['6'].inputs.model_name).toBe('mm_sd_v15_v2.ckpt')
    expect(g['6'].inputs.beta_schedule).toBe('sqrt_linear (AnimateDiff)')
    expect(g['6'].inputs.model).toEqual(['4', 0])

    expect(g['5'].inputs.batch_size).toBe(24)
    expect(g['5'].inputs.width).toBe(512)
    expect(g['5'].inputs.height).toBe(512)

    expect(g['3'].inputs.steps).toBe(20)
    expect(g['3'].inputs.cfg).toBe(7.5)
    expect(g['3'].inputs.model).toEqual(['6', 0])
    expect(g['3'].inputs.positive).toEqual(['7', 0])
    expect(g['3'].inputs.negative).toEqual(['8', 0])

    expect(String(g['7'].inputs.text)).toContain('masterpiece, best quality, photorealistic, enhanced prompt')
    expect(String(g['8'].inputs.text)).toContain('static, no motion, flickering, jumpy motion, lowres')

    expect(g['10'].class_type).toBe('VHS_VideoCombine')
    expect(g['10'].inputs.filename_prefix).toBe('nsfw/video/raw/nsfw-video')
    expect(g['10'].inputs.format).toBe('video/h264-mp4')
    expect(g['10'].inputs.frame_rate).toBe(8)
    expect(g['10'].inputs.save_output).toBe(true)
  })

  it('maps quality tiers to frames/steps', () => {
    const low = buildLocalVideoWorkflow(videoRequest({ qualityTier: 'low' }), 'x') as Graph
    expect(low['5'].inputs.batch_size).toBe(16)
    expect(low['3'].inputs.steps).toBe(16)

    const high = buildLocalVideoWorkflow(videoRequest({ qualityTier: 'high' }), 'x') as Graph
    expect(high['5'].inputs.batch_size).toBe(32)
    expect(high['3'].inputs.steps).toBe(24)
  })

  it('honors LOCAL_VIDEO_CKPT and LOCAL_VIDEO_MOTION overrides', () => {
    process.env.LOCAL_VIDEO_CKPT = 'customSd15.safetensors'
    process.env.LOCAL_VIDEO_MOTION = 'custom_motion.ckpt'
    const g = buildLocalVideoWorkflow(videoRequest(), 'x') as Graph
    expect(g['4'].inputs.ckpt_name).toBe('customSd15.safetensors')
    expect(g['6'].inputs.model_name).toBe('custom_motion.ckpt')
  })

  it('uses portrait dimensions for 2:3', () => {
    const g = buildLocalVideoWorkflow(videoRequest({ aspectRatio: '2:3' }), 'x') as Graph
    expect(g['5'].inputs.width).toBe(512)
    expect(g['5'].inputs.height).toBe(768)
  })
})

describe('buildLocalWorkflow raw output redirect', () => {
  it('writes SaveImage output under nsfw/images/raw', () => {
    const req: PlanRequest = {
      prompt: 'p', style: 'anime', aspectRatio: '1:1', qualityTier: 'medium',
    }
    const g = buildLocalWorkflow(req, 'enhanced') as Graph
    expect(g['9'].inputs.filename_prefix).toBe('nsfw/images/raw/nsfw-app-anime')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/local-plan.test.ts`
Expected: FAIL — `buildLocalVideoWorkflow`/`resolveVideoDimensions` not exported; image prefix assertion fails (`nsfw-app-anime`).

- [ ] **Step 3: Implement in `src/lib/local-plan.ts`**

Add the import of `MediaType` is **not** needed; add these constants and functions after `stepsForTier` (line 66), and change the SaveImage prefix inside `buildLocalWorkflow` (line 119):

```ts
export const VIDEO_DEFAULT_CKPT = 'realisticVisionV51_v51VAE.safetensors'
export const VIDEO_DEFAULT_MOTION = 'mm_sd_v15_v2.ckpt'
const VIDEO_PROMPT_PREFIX = 'masterpiece, best quality, photorealistic, '
const VIDEO_NEGATIVE_EXTRA = 'static, no motion, flickering, jumpy motion, lowres'
const VIDEO_FPS = 8

const VIDEO_TIER: Record<QualityTier, { frames: number; steps: number }> = {
  low: { frames: 16, steps: 16 },
  medium: { frames: 24, steps: 20 },
  high: { frames: 32, steps: 24 },
}

export function resolveVideoDimensions(aspectRatio: string): {
  width: number
  height: number
} {
  if (aspectRatio === '1:1') return { width: 512, height: 512 }
  if (['9:16', '2:3', '3:4'].includes(aspectRatio)) {
    return { width: 512, height: 768 }
  }
  return { width: 768, height: 512 }
}

function resolveVideoCkpt(): string {
  return process.env.LOCAL_VIDEO_CKPT?.trim() || VIDEO_DEFAULT_CKPT
}

function resolveVideoMotion(): string {
  return process.env.LOCAL_VIDEO_MOTION?.trim() || VIDEO_DEFAULT_MOTION
}

export function buildLocalVideoWorkflow(
  request: PlanRequest,
  enhancedPrompt: string
): Record<string, unknown> {
  const ckpt = resolveVideoCkpt()
  const motion = resolveVideoMotion()
  const { width, height } = resolveVideoDimensions(request.aspectRatio)
  const { frames, steps } = VIDEO_TIER[request.qualityTier]
  const seed = Math.floor(Math.random() * 2 ** 32)
  const negative = [DEFAULT_NEGATIVE, VIDEO_NEGATIVE_EXTRA].join(', ')

  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        scheduler: 'karras',
        negative: ['8', 0],
        denoise: 1,
        latent_image: ['5', 0],
        seed,
        cfg: 7.5,
        sampler_name: 'dpmpp_2m',
        model: ['6', 0],
        positive: ['7', 0],
        steps,
      },
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: ckpt },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { batch_size: frames, width, height },
    },
    '6': {
      class_type: 'ADE_AnimateDiffLoaderGen1',
      inputs: {
        model: ['4', 0],
        model_name: motion,
        beta_schedule: 'sqrt_linear (AnimateDiff)',
      },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: `${VIDEO_PROMPT_PREFIX}${enhancedPrompt}`,
        clip: ['4', 1],
      },
    },
    '8': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negative, clip: ['4', 1] },
    },
    '9': {
      class_type: 'VAEDecode',
      inputs: { vae: ['4', 2], samples: ['3', 0] },
    },
    '10': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['9', 0],
        frame_rate: VIDEO_FPS,
        loop_count: 0,
        filename_prefix: 'nsfw/video/raw/nsfw-video',
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
      },
    },
  }
}
```

In `buildLocalWorkflow`, change the SaveImage node:

```ts
        filename_prefix: `nsfw/images/raw/nsfw-app-${request.style}`,
```

Then branch `createLocalPlan` on media type — insert immediately after `await pingComfy()` and before the existing `const spec = ...` lines, keeping the existing image path below it:

```ts
  const enhanced = enhancePrompt(request.prompt, request.style)
  const planId = randomUUID()

  if ((request.mediaType ?? 'image') === 'video') {
    const ckpt = resolveVideoCkpt()
    const motion = resolveVideoMotion()
    const graph = buildLocalVideoWorkflow(request, enhanced)
    const { frames, steps } = VIDEO_TIER[request.qualityTier]
    const { width, height } = resolveVideoDimensions(request.aspectRatio)
    const seconds = (frames / VIDEO_FPS).toFixed(1)

    const snapshot: PlanSnapshot = {
      planId,
      createdAt: new Date().toISOString(),
      request,
      mediaType: 'video',
      mode: 'local-comfy',
      route: 'local/comfyui',
      modelId: ckpt,
      modelLabel: `Local AnimateDiff (${ckpt.replace('.safetensors', '')} + ${motion.replace('.ckpt', '')})`,
      localGraph: graph,
      params: {
        prompt: `${VIDEO_PROMPT_PREFIX}${enhanced}`.trim(),
        aspectRatio: request.aspectRatio,
        resolution: `${width}x${height}`,
        quality: request.qualityTier,
      },
      originalPrompt: request.prompt,
      estimatedPrice: 0,
      currency: 'CNY',
      reason: `${request.style} + ${request.qualityTier} → local AnimateDiff: ${frames} frames @ ${VIDEO_FPS}fps (~${seconds}s), ${steps} steps, ${width}x${height} — no cloud content filter, no cost`,
      alternatives: [],
    }

    await savePlan(snapshot)
    return snapshot
  }
```

Remove the now-duplicated `const enhanced = enhancePrompt(...)` and `const planId = randomUUID()` lines from the image path below (they moved up). The image path keeps `resolveCheckpoint`, `buildLocalWorkflow`, and its snapshot unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/local-plan.test.ts`
Expected: PASS (new + existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-plan.ts src/lib/local-plan.test.ts
git commit -m "feat: add AnimateDiff video workflow builder for local backend"
```

---

### Task 3: `createPlan` video guard + `/api/plan` mediaType handling

**Files:**
- Modify: `src/lib/router.ts`
- Modify: `src/app/api/plan/route.ts`
- Test: `src/lib/router.test.ts` (extend)

**Interfaces:**
- Consumes: `MediaType` (Task 1), `createLocalPlan` video branch (Task 2 — mocked here).
- Produces: `POST /api/plan` accepts optional `mediaType` (`'image' | 'video'`, default `'image'`), 400s invalid values and non-local video requests.

- [ ] **Step 1: Write the failing tests** — append to `src/lib/router.test.ts`:

```ts
describe('createPlan video guard', () => {
  const prevBackend = process.env.BACKEND
  const prevWorkflow = process.env.RH_WORKFLOW_ID
  const mockedCreate = vi.mocked(createLocalPlan)

  beforeEach(() => {
    mockedCreate.mockReset()
    mockedCreate.mockResolvedValue({} as never)
    delete process.env.BACKEND
    delete process.env.RH_WORKFLOW_ID
  })

  afterEach(() => {
    if (prevBackend === undefined) delete process.env.BACKEND
    else process.env.BACKEND = prevBackend
    if (prevWorkflow === undefined) delete process.env.RH_WORKFLOW_ID
    else process.env.RH_WORKFLOW_ID = prevWorkflow
  })

  const baseReq = {
    prompt: 'test girl',
    style: 'hentai' as const,
    aspectRatio: '9:16',
    qualityTier: 'high' as const,
  }

  it('rejects video when BACKEND is not local', async () => {
    await expect(
      createPlan({ ...baseReq, mediaType: 'video' })
    ).rejects.toThrow('Video generation requires BACKEND=local')
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('rejects video in workflow mode', async () => {
    process.env.RH_WORKFLOW_ID = '123'
    await expect(
      createPlan({ ...baseReq, mediaType: 'video' })
    ).rejects.toThrow('Video generation requires BACKEND=local')
  })

  it('passes mediaType through to createLocalPlan when local', async () => {
    process.env.BACKEND = 'local'
    await createPlan({ ...baseReq, mediaType: 'video' })
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: 'video' })
    )
  })

  it('treats missing mediaType as image and delegates locally', async () => {
    process.env.BACKEND = 'local'
    await createPlan(baseReq)
    expect(mockedCreate).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/router.test.ts`
Expected: FAIL — video requests currently fall through to workflow/standard mode (price-preview network calls or catalog errors, not the guard message).

- [ ] **Step 3: Implement the guard in `src/lib/router.ts`**

At the top of `createPlan` (line 80), before the `BACKEND` check:

```ts
export async function createPlan(request: PlanRequest) {
  const mediaType = request.mediaType ?? 'image'
  if (mediaType === 'video' && process.env.BACKEND?.trim() !== 'local') {
    throw new Error(
      'Video generation requires BACKEND=local (AnimateDiff runs on your local ComfyUI). Set BACKEND=local in .env.local and restart the dev server.'
    )
  }

  if (process.env.BACKEND?.trim() === 'local') {
    return createLocalPlan(request)
  }
  // ... rest unchanged
```

- [ ] **Step 4: Handle `mediaType` in `src/app/api/plan/route.ts`**

Add to imports: `import type { MediaType, PlanRequest, QualityTier, Style } from '@/lib/types'` (replacing the existing type import). Add next to the existing validators (after line 14):

```ts
const mediaTypes: MediaType[] = ['image', 'video']

function isMediaType(m: unknown): m is MediaType {
  return typeof m === 'string' && mediaTypes.includes(m as MediaType)
}
```

Inside `POST`, after the `qualityTier` validation (after line 41):

```ts
    const mediaType = body.mediaType === undefined ? 'image' : body.mediaType
    if (!isMediaType(mediaType)) {
      return NextResponse.json({ error: 'invalid mediaType' }, { status: 400 })
    }
```

Change the request construction (line 43) to include it:

```ts
    const request: PlanRequest = {
      prompt,
      style,
      aspectRatio,
      qualityTier,
      mediaType,
    }
```

In the catch block's status chain, add a 400 branch for the guard — insert before the `message.includes('Enterprise-Shared')` line:

```ts
    const status = raw.startsWith('LocalComfy:')
      ? 503
      : message.startsWith('Video generation requires')
          ? 400
          : message.includes('Enterprise-Shared')
```

(The rest of the existing ternary chain is unchanged — only indentation shifts.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/router.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck the route change**

Run: `npx tsc --noEmit`
Expected: clean (no test coverage for the route file exists; type check is the gate here — repo convention).

- [ ] **Step 7: Commit**

```bash
git add src/lib/router.ts src/lib/router.test.ts src/app/api/plan/route.ts
git commit -m "feat: guard video plans to the local backend and accept mediaType in /api/plan"
```

---

### Task 4: Completion wiring — `gifs[]` outputs, video poll cap, video file serving

**Files:**
- Modify: `src/lib/local-comfy.ts`
- Modify: `src/app/api/status/route.ts`
- Modify: `src/app/api/image/route.ts`
- Test: `src/lib/local-comfy.test.ts` (exists with 7 tests — extend; read it first, keep its tests passing, merge the new describe block in)

**Interfaces:**
- Consumes: `RunMetadata.mediaType` + `videoFile` (Task 1).
- Produces: `getHistoryResult` returns a `gifs[]` ref when no `images[]` exists; `/api/status` allows 180 polls (~24 min at the 8s UI interval) for video jobs and every SUCCESS response carries a `mediaType` field; `/api/image?jobId=` serves `video.mp4` as `video/mp4` or `image.png` as `image/png`.

- [ ] **Step 1: Write the failing tests** — `src/lib/local-comfy.test.ts` already exists with 7 tests. Read it first, keep all existing tests, and merge in the following describe block (align fetch mocking with the file's existing pattern):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getHistoryResult } from './local-comfy'

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('getHistoryResult', () => {
  const realFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = realFetch
  })

  it('returns a gifs ref when only video output exists', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      okJson({
        p1: {
          status: { status_str: 'success' },
          outputs: {
            '10': {
              gifs: [
                {
                  filename: 'nsfw-video_00001.mp4',
                  subfolder: 'nsfw/video/raw',
                  type: 'output',
                },
              ],
            },
          },
        },
      })
    )
    const r = await getHistoryResult('p1', 'http://localhost:8188')
    expect(r).toEqual({
      status: 'SUCCESS',
      image: {
        filename: 'nsfw-video_00001.mp4',
        subfolder: 'nsfw/video/raw',
        type: 'output',
      },
    })
  })

  it('prefers images over gifs when both exist', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      okJson({
        p1: {
          status: { status_str: 'success' },
          outputs: {
            '9': {
              images: [
                { filename: 'img_00001.png', subfolder: '', type: 'output' },
              ],
              gifs: [
                { filename: 'vid_00001.mp4', subfolder: '', type: 'output' },
              ],
            },
          },
        },
      })
    )
    const r = await getHistoryResult('p1', 'http://localhost:8188')
    expect(r.status).toBe('SUCCESS')
    if (r.status === 'SUCCESS') {
      expect(r.image.filename).toBe('img_00001.png')
    }
  })

  it('fails when success produced no output files', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      okJson({ p1: { status: { status_str: 'success' }, outputs: {} } })
    )
    const r = await getHistoryResult('p1', 'http://localhost:8188')
    expect(r.status).toBe('FAILED')
    if (r.status === 'FAILED') {
      expect(r.errorMessage).toContain('no output file')
    }
  })

  it('reports RUNNING when no status yet', async () => {
    vi.mocked(global.fetch).mockResolvedValue(okJson({ p1: {} }))
    const r = await getHistoryResult('p1', 'http://localhost:8188')
    expect(r.status).toBe('RUNNING')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-comfy.test.ts`
Expected: FAIL — video-only success currently reports `FAILED: LocalComfy succeeded but produced no image`.

- [ ] **Step 3: Implement the `gifs[]` read in `src/lib/local-comfy.ts`**

Widen the response type (lines 103-113) — add `gifs` to the outputs record:

```ts
  const data = (await res.json()) as Record<
    string,
    {
      outputs?: Record<
        string,
        { images?: ComfyImageRef[]; gifs?: ComfyImageRef[] }
      >
      status?: {
        status_str?: string
        completed?: boolean
        messages?: unknown[]
      }
    }
  >
```

Replace the success branch (lines 118-127):

```ts
  if (s === 'success') {
    for (const nodeOutput of Object.values(entry.outputs ?? {})) {
      const file = nodeOutput.images?.[0] ?? nodeOutput.gifs?.[0]
      if (file) return { status: 'SUCCESS', image: file }
    }
    return {
      status: 'FAILED',
      errorMessage: 'LocalComfy succeeded but produced no output file',
    }
  }
```

(The `image` field of `ComfyHistoryResult` intentionally keeps its name — it now holds an image-or-video ref; add a one-line comment saying so.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-comfy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Raise the poll cap for video jobs in `src/app/api/status/route.ts`**

Add next to `MAX_POLLS` (line 16):

```ts
const MAX_POLLS_VIDEO = 180
```

Inside the `try`, replace the `pollCount >= MAX_POLLS` block's first line so the cap is media-aware (`meta` is already in scope from line 57):

```ts
    const maxPolls = meta?.mediaType === 'video' ? MAX_POLLS_VIDEO : MAX_POLLS
    if (pollCount >= maxPolls) {
```

Update the timeout message in that block (line 72):

```ts
        `Timed out after maximum polling attempts (~${Math.round((maxPolls * 8) / 60)} minutes)`
```

Replace the three `Math.round(((pollCount + 1) / MAX_POLLS) * 100)` progress expressions (lines 125, 163, 201) with:

```ts
Math.round(((pollCount + 1) / maxPolls) * 100)
```

Also add `mediaType` to every SUCCESS JSON response so the UI can choose `<img>` vs `<video>` immediately, without waiting for a history refresh:

- Early-return branch (lines 38-46, `meta` in scope): add `mediaType: meta?.mediaType ?? 'image',`
- Local finalize branch (lines 116-121, `mFinal` in scope): add `mediaType: mFinal.mediaType ?? 'image',`
- Comfy (lines 153-158) and standard (lines 190-196) branches: same one-liner via `mFinal`.

- [ ] **Step 6: Serve video files in `src/app/api/image/route.ts`**

Change the jobs import (line 9) to include `getMeta`, and add the types import:

```ts
import { ensureJobHydrated, getJob, getMeta } from '@/lib/jobs'
import { findRunByJobId } from '@/lib/output-store'
import type { RunMetadata } from '@/lib/types'
```

Replace the dir-resolution block (lines 21-25) so the run row is reused for metadata:

```ts
  let dir = getJob(jobId)?.outputDir
  let row: (RunMetadata & { outputDir: string }) | null = null
  if (!dir) {
    row = await findRunByJobId(jobId)
    dir = row?.outputDir
  }
```

Replace the file-read block (lines 45-50):

```ts
  const meta = getMeta(jobId) ?? row ?? undefined
  const file = meta?.videoFile ?? meta?.imageFile ?? 'image.png'
  const contentType = file.endsWith('.mp4') ? 'video/mp4' : 'image/png'

  try {
    const buf = await readFile(path.join(resolvedDir, file))
    return new NextResponse(buf, {
      headers: { 'Content-Type': contentType },
    })
  } catch {
```

(The catch's R2 fallback and 404 stay exactly as they are — R2 only mirrors images.)

- [ ] **Step 7: Verify — full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, typecheck clean (route changes have no unit tests; tsc + Task 6 manual e2e are their gate).

- [ ] **Step 8: Commit**

```bash
git add src/lib/local-comfy.ts src/lib/local-comfy.test.ts src/app/api/status/route.ts src/app/api/image/route.ts
git commit -m "feat: finalize and serve local video outputs end to end"
```

---

### Task 5: UI — Media chips, prefs, video preview, history tag

**Files:**
- Modify: `src/lib/nsfw-defaults.ts`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `MediaType` (Task 1); `/api/plan` accepts `mediaType` (Task 3); `/api/image` serves mp4 (Task 4).
- Produces: stored prefs gain `mediaType`; no exported API changes (page-local).

No unit tests exist for the UI in this repo — the gate for this task is `npx tsc --noEmit`, `npm run build`, and the Task 6 manual checklist.

- [ ] **Step 1: Extend `src/lib/nsfw-defaults.ts`**

Update the type import (line 1), defaults (line 4), `StoredPrefs` (line 13), and `mergePrefs` (line 40):

```ts
import type { MediaType, QualityTier, Style } from './types'

/** App is NSFW-only; these are the defaults on first visit and reset targets. */
export const NSFW_DEFAULTS = {
  style: 'hentai' as Style,
  aspectRatio: '9:16',
  qualityTier: 'high' as QualityTier,
  mediaType: 'image' as MediaType,
  prompt: '',
} as const
```

```ts
export type StoredPrefs = {
  style: Style
  aspectRatio: string
  qualityTier: QualityTier
  mediaType: MediaType
  prompt: string
}
```

In `mergePrefs`, add (localStorage is untyped — validate explicitly):

```ts
    mediaType: stored?.mediaType === 'video' ? 'video' : NSFW_DEFAULTS.mediaType,
```

(Storage key `runninghub-nsfw-prefs-v1` stays — the new field is additive.)

- [ ] **Step 2: Add media state and chips to `src/app/page.tsx`**

Update the type import (line 11) to include `MediaType`. Add after the `QUALITIES` const (line 33):

```tsx
const MEDIA_TYPES: { value: MediaType; label: string }[] = [
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
];
```

Add state after the `qualityTier` useState (line 131):

```tsx
  const [mediaType, setMediaType] = useState<MediaType>(NSFW_DEFAULTS.mediaType);
```

Add a `doneMediaType` state after the `gen` useState (line 134) so a just-finished video job renders `<video>` immediately, before the history refresh lands:

```tsx
  const [doneMediaType, setDoneMediaType] = useState<MediaType | undefined>(undefined);
```

In the status-poll SUCCESS branch (after `setGen({ phase: "done", jobId, status: "SUCCESS" });`, line 235), add:

```tsx
          setDoneMediaType(body.mediaType === "video" ? "video" : "image");
```

In `handlePlan`, reset it with the other plan state (after `setGen({ phase: "idle" });`, line 292):

```tsx
      setDoneMediaType(undefined);
```

In the prefs-load effect (lines 164-171), add `setMediaType(p.mediaType);`. In the prefs-save effect (lines 173-176), change to:

```tsx
    saveStoredPrefs({ prompt, style, aspectRatio, qualityTier, mediaType });
  }, [prefsReady, prompt, style, aspectRatio, qualityTier, mediaType]);
```

In the controls section, replace the Style `ChipRow` (line 426) with:

```tsx
          <ChipRow label="Media" options={MEDIA_TYPES} value={mediaType} onChange={setMediaType} />

          {mediaType === "image" && (
            <ChipRow label="Style" options={STYLES} value={style} onChange={setStyle} />
          )}
```

In `handlePlan` (lines 278-283), add `mediaType` to the JSON body.

- [ ] **Step 3: Video-aware preview, download, and history labels in `src/app/page.tsx`**

After the `imageSrc` const (line 365), add:

```tsx
  const previewIsVideo =
    previewMeta?.mediaType === "video" ||
    (gen.phase === "done" && gen.jobId === previewJobId && doneMediaType === "video");
```

In the preview pane, replace the `{imageSrc && (<img ... />)}` block (lines 602-612) with:

```tsx
              {imageSrc && previewIsVideo && (
                <video
                  key={previewJobId ?? undefined}
                  src={imageSrc}
                  controls
                  playsInline
                  className="max-h-[min(70vh,520px)] w-full object-contain"
                />
              )}
              {imageSrc && !previewIsVideo && (
                // eslint-disable-next-line @next/next/no-img-element -- same-origin PNG from /api/image
                <img
                  key={previewJobId ?? undefined}
                  src={imageSrc}
                  alt="Generated output"
                  className="max-h-[min(70vh,520px)] w-full object-contain"
                  onLoad={() => setImageLoadError(null)}
                  onError={() => setImageLoadError("Could not load image for this job (missing or failed run).")}
                />
              )}
```

Change the spinner text (line 599) to `Working on your {mediaType === "video" ? "video" : "image"}…`.

Change the Download link's `download` attribute (line 637) to:

```tsx
                    download={`runninghub-${previewJobId}.${previewIsVideo ? "mp4" : "png"}`}
```

Change the history option label (lines 470-473) to include the media tag:

```tsx
                        {new Date(h.createdAt).toLocaleString()} — {h.status} —{" "}
                        {h.mediaType === "video" ? "video" : "image"} — {h.modelLabel.slice(0, 24)}
                        {h.modelLabel.length > 24 ? "…" : ""}
```

The plan card needs no structural change: video plans display `modelLabel` (`Local AnimateDiff (…)`), the `resolution` cell shows e.g. `512x768`, and the reason line carries frames/steps/duration.

- [ ] **Step 4: Verify — typecheck and production build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean typecheck; build exits 0 (watch that Tailwind does not scan `local-comfyui/checkpoints/` — build must complete without hanging; per AGENTS.md the `source(none)` import already guards this, and this task does not touch `globals.css`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/nsfw-defaults.ts src/app/page.tsx
git commit -m "feat: add media type selector with video preview to the generator UI"
```

---

### Task 6: Docs + full verification

**Files:**
- Modify: `AGENTS.md` (Architecture section)
- Modify: `README.md` (On-disk layout section + API routes table row for `/api/image`)

**Interfaces:**
- Consumes: all previous tasks.
- Produces: documentation matching behavior; verified feature.

- [ ] **Step 1: Update `AGENTS.md`**

In the Architecture section, replace the `outputs/` lifecycle bullet and add the video bullets:

```markdown
- Lifecycle: `/api/plan` saves `.plans/<planId>.json` (5 min TTL) → `/api/generate` creates `outputs/nsfw/images/<jobId>/` (or `outputs/nsfw/video/<jobId>/` for `mediaType: 'video'`) → `/api/status` polls the backend and finalizes `image.png` (or `video.mp4`).
- `outputs/` is a **symlink to ComfyUI's output dir on the SamsungT7 exFAT drive**. Jobs live under `nsfw/images/<jobId>/` and `nsfw/video/<jobId>/`; ComfyUI's raw save files are redirected to `nsfw/images/raw/` and `nsfw/video/raw/` via `filename_prefix`. Legacy `outputs/YYYY-MM-DD/<jobId>/` dirs are still read by history. `output-store.ts` skips macOS `._*` AppleDouble files — new code reading outputs must do the same.
- Video mode (`mediaType: 'video'` in the UI): local-only (`BACKEND=local` required, else `/api/plan` → 400). AnimateDiff + SD1.5 (`realisticVisionV51` + `mm_sd_v15_v2`, overridable via `LOCAL_VIDEO_CKPT` / `LOCAL_VIDEO_MOTION`), 16/24/32 frames and 16/20/24 steps by tier, 512×512 / 512×768 / 768×512 by aspect, mp4 via `VHS_VideoCombine`. Status polling allows 180 polls (~24 min) for video vs 60 for images.
```

- [ ] **Step 2: Update `README.md`**

In the On-disk layout block, replace the `outputs/YYYY-MM-DD/<jobId>/` tree with:

```text
└── outputs/nsfw/
    ├── images/<jobId>/{metadata.json, plan.json, image.png}   # image jobs
    ├── video/<jobId>/{metadata.json, plan.json, video.mp4}    # video jobs
    └── {images,video}/raw/                                    # ComfyUI raw save files
```

(Mention that legacy `outputs/YYYY-MM-DD/` dirs are still read by history.) Update the `/api/image` row in the API routes table: `Serve saved image.png or video.mp4 for a jobId`.

- [ ] **Step 3: Full automated gate**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all suites PASS, typecheck clean, build exits 0.

- [ ] **Step 4: Manual end-to-end (requires ComfyUI on 8188 + SamsungT7 mounted; run `make start` first, dev server on :4000 with `BACKEND=local`)**

1. Image job: pick Media=Image, Plan → Confirm → SUCCESS. Verify `outputs/nsfw/images/<jobId>/image.png` exists, raw file landed in `outputs/nsfw/images/raw/`, nothing new at the output top level, preview `<img>` works.
2. Video job: Media=Video (Style row hides), Quality=Low, Plan (card shows `Local AnimateDiff …`, `16 frames @ 8fps (~2.0s)` in Reason) → Confirm → wait (~1-3 min) → SUCCESS. Verify `outputs/nsfw/video/<jobId>/video.mp4` plays in the `<video>` element, raw mp4 in `outputs/nsfw/video/raw/`, Download yields `.mp4`.
3. History lists both with `— image` / `— video` tags; a pre-change `YYYY-MM-DD` run still appears and previews.
4. `[ Open folder ]` on the video job opens `outputs/nsfw/video/<jobId>/`.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md README.md
git commit -m "docs: document video mode and the nsfw/images + nsfw/video output layout"
```

---

## Self-Review Log

- **Spec coverage:** data model → Task 1; storage layout → Task 1; planner (video builder + image raw prefix) → Task 2; plan guard + `/api/plan` → Task 3; `gifs[]` + `/api/image` serving → Task 4; UI → Task 5; AGENTS.md + e2e → Task 6. Spec's error-handling rows map to Task 3 (400 guard), Task 4 (no-output-file failure), and Global Constraints (prefix conventions, exFAT skipping).
- **Deviation from spec (intentional):** the spec claimed status polling had no timeout; the code caps at `MAX_POLLS = 60` (~8 min at the 8s UI interval), too short for high-tier video. Task 4 adds `MAX_POLLS_VIDEO = 180` (~24 min) instead of leaving the cap untouched.
- **Placeholder scan:** every code step contains complete code; no TBD/TODO.
- **Type consistency:** `mediaType` optional everywhere with `?? 'image'` normalization; `ComfyHistoryResult.image` name retained deliberately (documented in Task 4); `scanParent`/`scanJobDir` names used consistently in Task 1; `buildLocalVideoWorkflow`/`resolveVideoDimensions` signatures identical in Tasks 2's tests and implementation.
- **Post-write fixes (applied inline):** (1) Task 1 test paths corrected — the `root` seam is the outputs root itself, so test expectations are `<root>/nsfw/...` with no `outputs/` segment. (2) Closed a preview race: a just-finished video job previously rendered `<img>` until the history refresh arrived (flashing a false load error); `/api/status` SUCCESS responses now carry `mediaType`, and the UI tracks it via `doneMediaType`. `tsconfig` has no `exactOptionalPropertyTypes`, so optional-`mediaType` object literals in tests compile as written.
- **Pre-execution fix (applied inline):** the R2/Vercel work found uncommitted in the working tree was committed first (its own commit). The plan's `finalizeSuccess` now preserves the R2 mirror block and the `./r2` import verbatim — applying the earlier draft would have silently deleted the R2 mirror. Both pre-existing test files (`output-store.test.ts`, `local-comfy.test.ts`) are extended, not created.
