# Local ComfyUI Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `BACKEND=local` mode that routes plan/generate/status to the local ComfyUI at `LOCAL_COMFY_URL` (default `http://localhost:8188`), enabling uncensored local generation with no cloud cost.

**Architecture:** `createPlan` in `src/lib/router.ts` gains a first branch on `BACKEND=local` → `createLocalPlan()`, which builds a ComfyUI API-format workflow graph (7 nodes) from a style→checkpoint table, pings ComfyUI first, and persists the graph in the plan snapshot. `/api/generate` and `/api/status` get `mode === 'local-comfy'` branches: submit via `POST /api/prompt` (prompt_id = taskId), poll `GET /api/history/{prompt_id}`, on success fetch the image via `GET /view?...` and reuse the existing `finalizeSuccess` (its `downloadImage` is a plain fetch). UI/history/image/reveal routes untouched.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Vitest (colocated `src/lib/*.test.ts`), ComfyUI HTTP API.

## Global Constraints

- Repo commit style: semantic lowercase (`feat:`, `fix:`, `docs:`) — see `git log`.
- Tests colocated: `src/lib/<name>.test.ts`, Vitest, env save/restore in `beforeEach`/`afterEach` (see `comfy-plan.test.ts`).
- `BACKEND` unset ⇒ existing RunningHub behavior must be byte-identical.
- Local client errors are prefixed `LocalComfy:` so route error handlers can distinguish them from RunningHub `ComfyUI` errors (which go through `formatComfyUiError`).
- No UI changes. No new dependencies. `batch_size` stays 1.
- Spec: `docs/superpowers/specs/oc_2026-08-14-local-comfyui-backend-design.md`

---

### Task 0: Fix the broken `outputs` symlink (ops prerequisite)

**Files:**
- (filesystem only — no source files)

**Interfaces:** none

- [ ] **Step 1: Verify it is broken**

Run: `ls outputs/`
Expected: `ls: outputs/: Invalid argument` (EINVAL — SamsungT7 exFAT mount is sick). If it lists fine, skip this task.

- [ ] **Step 2: Replace symlink with a real local directory**

Run:
```bash
rm outputs
mkdir outputs
ls outputs
```
Expected: empty dir lists clean. (`outputs/` is gitignored; job dirs are metadata + a copy — the primary image lives in ComfyUI's own output dir and is fetched via `/view` HTTP, so the app never needs the exFAT path.)

- [ ] **Step 3: Commit**

```bash
GIT_MASTER=1 git add -A outputs
GIT_MASTER=1 git commit -m "chore: replace broken outputs symlink with real local dir" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```
(If nothing staged because outputs/ is ignored, commit with `--allow-empty` or fold into Task 8's commit — the dir is gitignored so the change is only on disk. Prefer on-disk only, no commit needed.)

---

### Task 1: Types — `ApiMode` + `localGraph`

**Files:**
- Modify: `src/lib/types.ts:24` (`ApiMode`), `src/lib/types.ts:26` (`PlanSnapshot`)

**Interfaces:**
- Produces: `ApiMode = 'standard' | 'comfy' | 'local-comfy'`; `PlanSnapshot.localGraph?: Record<string, unknown>`

- [ ] **Step 1: Edit `src/lib/types.ts`**

```typescript
export type ApiMode = 'standard' | 'comfy' | 'local-comfy'
```
Add to `PlanSnapshot` (after `nodeInfoList`):
```typescript
  localGraph?: Record<string, unknown>
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: exit 0 (no code uses the new mode yet, so no errors).

- [ ] **Step 3: Commit**

```bash
GIT_MASTER=1 git add src/lib/types.ts
GIT_MASTER=1 git commit -m "feat: add local-comfy ApiMode and plan localGraph field" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

### Task 2: Local ComfyUI client

**Files:**
- Create: `src/lib/local-comfy.ts`
- Test: `src/lib/local-comfy.test.ts`

**Interfaces:**
- Consumes: nothing (env: `LOCAL_COMFY_URL`)
- Produces:
  - `getLocalComfyUrl(): string`
  - `pingComfy(base?: string): Promise<void>` — throws `Error('LocalComfy not reachable at <url>')` on failure (2s abort timeout)
  - `submitPrompt(graph: Record<string, unknown>, base?: string): Promise<string>` — returns prompt_id; throws `Error('LocalComfy submit failed ...')` / `Error('LocalComfy submit error: ...')`
  - `buildViewUrl(image: ComfyImageRef, base?: string): string`
  - `getHistoryResult(promptId: string, base?: string): Promise<ComfyHistoryResult>`
  - Types: `ComfyImageRef = { filename: string; subfolder: string; type: string }`; `ComfyHistoryResult = { status: 'SUCCESS'; image: ComfyImageRef } | { status: 'FAILED'; errorMessage: string } | { status: 'RUNNING' }`

- [ ] **Step 1: Write the failing test** `src/lib/local-comfy.test.ts`

```typescript
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
    await expect(submitPrompt({ '4': { class_type: 'X' } }, BASE)).resolves.toBe(
      'abc-123'
    )
    expect(sent).toContain('"prompt"')
  })

  it('maps ComfyUI error payloads to LocalComfy errors', async () => {
    fakeFetch(async () => ({ error: { message: 'ckpt not found' } }))
    await expect(submitPrompt({}, BASE)).rejects.toThrow('LocalComfy submit error: ckpt not found')
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
    expect(buildViewUrl({ filename: 'a b.png', subfolder: 'sub/f', type: 'output' }, BASE)).toBe(
      'http://localhost:8188/view?filename=a+b.png&type=output&subfolder=sub%2Ff'
    )
  })
})

describe('getHistoryResult', () => {
  it('returns RUNNING when no history entry exists', async () => {
    fakeFetch(async () => ({}))
    await expect(getHistoryResult('p1', BASE)).resolves.toEqual({ status: 'RUNNING' })
  })

  it('returns SUCCESS with the first image', async () => {
    fakeFetch(async () => ({
      p1: {
        outputs: {
          '9': { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-comfy.test.ts`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Write the implementation** `src/lib/local-comfy.ts`

```typescript
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
    const res = await fetch(`${base}/system_stats`, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`LocalComfy health check failed: HTTP ${res.status}`)
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`LocalComfy not reachable at ${base} (timeout)`)
    }
    if (e instanceof Error && e.message.startsWith('LocalComfy')) throw e
    throw new Error(`LocalComfy not reachable at ${base}: ${e instanceof Error ? e.message : String(e)}`)
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
    throw new Error(`LocalComfy submit error: ${data.error.message ?? 'unknown error'}`)
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
      status?: { status_str?: string; completed?: boolean; messages?: unknown[] }
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-comfy.test.ts`
Expected: PASS (6 tests). Then run `npx vitest run` — all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
GIT_MASTER=1 git add src/lib/local-comfy.ts src/lib/local-comfy.test.ts
GIT_MASTER=1 git commit -m "feat: add local ComfyUI HTTP client with tests" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

### Task 3: Local plan builder

**Files:**
- Create: `src/lib/local-plan.ts`
- Test: `src/lib/local-plan.test.ts`
- Modify: `src/lib/comfy-plan.ts:31` (export `DEFAULT_NEGATIVE`)

**Interfaces:**
- Consumes: `resolveDimensions` (already exported from `./comfy-plan`), `DEFAULT_NEGATIVE` (exported in Step 1), `enhancePrompt` from `./router`, `pingComfy` from `./local-comfy`, `savePlan` from `./plans`, types from `./types`
- Produces:
  - `resolveCheckpoint(style: Style): CheckpointSpec` — honors `LOCAL_CKPT_<STYLE>` env override
  - `stepsForTier(spec: CheckpointSpec, tier: QualityTier): number`
  - `buildLocalWorkflow(request: PlanRequest, enhancedPrompt: string): Record<string, unknown>` — 7-node graph, pony prefix applied to node 6 text
  - `createLocalPlan(request: PlanRequest): Promise<PlanSnapshot>`

- [ ] **Step 1: Export `DEFAULT_NEGATIVE` in `src/lib/comfy-plan.ts`**

Change line 31 `const DEFAULT_NEGATIVE =` → `export const DEFAULT_NEGATIVE =`

- [ ] **Step 2: Write the failing test** `src/lib/local-plan.test.ts`

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildLocalWorkflow, resolveCheckpoint, stepsForTier } from './local-plan'

const REQ = {
  prompt: 'test girl',
  style: 'hentai' as const,
  aspectRatio: '9:16',
  qualityTier: 'medium' as const,
}

describe('resolveCheckpoint', () => {
  const prev = process.env.LOCAL_CKPT_REALISTIC

  afterEach(() => {
    if (prev === undefined) delete process.env.LOCAL_CKPT_REALISTIC
    else process.env.LOCAL_CKPT_REALISTIC = prev
  })

  it('maps hentai to ponyDiffusion with score prefix', () => {
    const spec = resolveCheckpoint('hentai')
    expect(spec.file).toBe('ponyDiffusionV6XL_v6StartWithThisOne.safetensors')
    expect(spec.prefix).toContain('score_9')
  })

  it('maps realistic to juggernautXL', () => {
    expect(resolveCheckpoint('realistic').file).toBe('juggernautXL_ragnarokBy.safetensors')
  })

  it('honors LOCAL_CKPT_<STYLE> env override', () => {
    process.env.LOCAL_CKPT_REALISTIC = 'realvisxlV50_v50LightningBakedvae.safetensors'
    expect(resolveCheckpoint('realistic').file).toBe('realvisxlV50_v50LightningBakedvae.safetensors')
  })
})

describe('stepsForTier', () => {
  const pony = resolveCheckpoint('hentai')

  it('adjusts steps by tier with a floor of 4', () => {
    expect(stepsForTier(pony, 'low')).toBe(18)
    expect(stepsForTier(pony, 'medium')).toBe(28)
    expect(stepsForTier(pony, 'high')).toBe(34)
  })
})

describe('buildLocalWorkflow', () => {
  it('builds the 7-node graph with correct links and pony prefix', () => {
    const graph = buildLocalWorkflow(REQ, 'test girl, anime art style')
    expect(Object.keys(graph)).toHaveLength(7)
    const sampler = graph['3'] as { inputs: Record<string, unknown> }
    expect(sampler.inputs.model).toEqual(['4', 0])
    expect(sampler.inputs.positive).toEqual(['6', 0])
    expect(sampler.inputs.negative).toEqual(['7', 0])
    const positive = graph['6'] as { inputs: { text: string } }
    expect(positive.inputs.text).toMatch(/^score_9, score_8_up, score_7_up, .*test girl/)
    const negative = graph['7'] as { inputs: { text: string } }
    expect(negative.inputs.text).toContain('score_4')
    const size = graph['5'] as { inputs: { width: number; height: number } }
    expect(size.inputs).toEqual({ batch_size: 1, width: 768, height: 1344 })
    const ckpt = graph['4'] as { inputs: { ckpt_name: string } }
    expect(ckpt.inputs.ckpt_name).toBe('ponyDiffusionV6XL_v6StartWithThisOne.safetensors')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/local-plan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation** `src/lib/local-plan.ts`

```typescript
import { randomUUID } from 'crypto'

import { DEFAULT_NEGATIVE, resolveDimensions } from './comfy-plan'
import { pingComfy } from './local-comfy'
import { savePlan } from './plans'
import { enhancePrompt } from './router'
import type { PlanRequest, PlanSnapshot, QualityTier, Style } from './types'

export type CheckpointSpec = {
  file: string
  prefix: string
  steps: number
  cfg: number
  negativeExtra: string
}

const CHECKPOINT_BY_STYLE: Record<Style, string> = {
  anime: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
  hentai: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
  hassaku: 'iniverseMixSFWNSFW_realXLV1.safetensors',
  realistic: 'juggernautXL_ragnarokBy.safetensors',
}

const SPEC_BY_FILE: Record<string, CheckpointSpec> = {
  'ponyDiffusionV6XL_v6StartWithThisOne.safetensors': {
    file: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
    prefix: 'score_9, score_8_up, score_7_up, score_6_up, ',
    steps: 28,
    cfg: 7.5,
    negativeExtra: 'score_4, score_3, score_2, score_1',
  },
  'iniverseMixSFWNSFW_realXLV1.safetensors': {
    file: 'iniverseMixSFWNSFW_realXLV1.safetensors',
    prefix: '',
    steps: 28,
    cfg: 6.5,
    negativeExtra: '',
  },
  'juggernautXL_ragnarokBy.safetensors': {
    file: 'juggernautXL_ragnarokBy.safetensors',
    prefix: 'masterpiece, best quality, photorealistic, ',
    steps: 28,
    cfg: 6.5,
    negativeExtra: '',
  },
}

export function resolveCheckpoint(style: Style): CheckpointSpec {
  const override = process.env[`LOCAL_CKPT_${style.toUpperCase()}`]?.trim()
  const file = override || CHECKPOINT_BY_STYLE[style]
  return (
    SPEC_BY_FILE[file] ?? {
      file,
      prefix: '',
      steps: 28,
      cfg: 7,
      negativeExtra: '',
    }
  )
}

export function stepsForTier(spec: CheckpointSpec, tier: QualityTier): number {
  const base = spec.steps
  const steps = tier === 'low' ? base - 10 : tier === 'high' ? base + 6 : base
  return Math.max(4, steps)
}

export function buildLocalWorkflow(
  request: PlanRequest,
  enhancedPrompt: string
): Record<string, unknown> {
  const spec = resolveCheckpoint(request.style)
  const { width, height } = resolveDimensions(request.aspectRatio)
  const steps = stepsForTier(spec, request.qualityTier)
  const seed = Math.floor(Math.random() * 2 ** 32)
  const negative = [DEFAULT_NEGATIVE, spec.negativeExtra]
    .filter(Boolean)
    .join(', ')

  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        scheduler: 'karras',
        negative: ['7', 0],
        denoise: 1,
        latent_image: ['5', 0],
        seed,
        cfg: spec.cfg,
        sampler_name: 'dpmpp_2m',
        model: ['4', 0],
        positive: ['6', 0],
        steps,
      },
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: spec.file },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { batch_size: 1, width, height },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: `${spec.prefix}${enhancedPrompt}`, clip: ['4', 1] },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negative, clip: ['4', 1] },
    },
    '37': {
      class_type: 'VAEDecode',
      inputs: { vae: ['4', 2], samples: ['3', 0] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: `nsfw-app-${request.style}`, images: ['37', 0] },
    },
  }
}

export async function createLocalPlan(
  request: PlanRequest
): Promise<PlanSnapshot> {
  await pingComfy()

  const spec = resolveCheckpoint(request.style)
  const enhanced = enhancePrompt(request.prompt, request.style)
  const graph = buildLocalWorkflow(request, enhanced)
  const planId = randomUUID()

  const snapshot: PlanSnapshot = {
    planId,
    createdAt: new Date().toISOString(),
    request,
    mode: 'local-comfy',
    route: 'local/comfyui',
    modelId: spec.file,
    modelLabel: `Local ComfyUI (${spec.file.replace('.safetensors', '')})`,
    localGraph: graph,
    params: {
      prompt: `${spec.prefix}${enhanced}`.trim(),
      aspectRatio: request.aspectRatio,
      resolution: 'workflow',
      quality: request.qualityTier,
    },
    originalPrompt: request.prompt,
    estimatedPrice: 0,
    currency: 'CNY',
    reason: `${request.style} + ${request.qualityTier} → local ComfyUI (${spec.file}) — no cloud content filter, no cost`,
    alternatives: [],
  }

  await savePlan(snapshot)
  return snapshot
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/local-plan.test.ts`
Expected: PASS (5 tests). Then `npx vitest run` — all green.

- [ ] **Step 6: Commit**

```bash
GIT_MASTER=1 git add src/lib/local-plan.ts src/lib/local-plan.test.ts src/lib/comfy-plan.ts
GIT_MASTER=1 git commit -m "feat: add local ComfyUI plan builder with checkpoint mapping" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

### Task 4: Wire `BACKEND=local` into `createPlan` + plan route 503

**Files:**
- Modify: `src/lib/router.ts:79-82` (top of `createPlan`)
- Modify: `src/app/api/plan/route.ts:52-63` (catch status mapping)
- Test: `src/lib/router.test.ts` (append describe)

**Interfaces:**
- Consumes: `createLocalPlan` from `./local-plan`
- Produces: `createPlan` returns a local-comfy plan when `BACKEND === 'local'`; plan route returns 503 for `LocalComfy` errors

- [ ] **Step 1: Write the failing test** (append to `src/lib/router.test.ts`)

```typescript
import { createLocalPlan } from './local-plan'

vi.mock('./local-plan', () => ({ createLocalPlan: vi.fn() }))
```
Add at the top imports; then append:

```typescript
describe('createPlan backend switch', () => {
  const prev = process.env.BACKEND
  const mockedCreate = vi.mocked(createLocalPlan)

  beforeEach(() => {
    mockedCreate.mockReset()
    mockedCreate.mockResolvedValue({} as never)
    process.env.BACKEND = 'local'
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.BACKEND
    else process.env.BACKEND = prev
  })

  it('delegates to createLocalPlan when BACKEND=local', async () => {
    await createPlan({
      prompt: 'test girl',
      style: 'hentai',
      aspectRatio: '1:1',
      qualityTier: 'high',
    })
    expect(mockedCreate).toHaveBeenCalledTimes(1)
  })
})
```
(Check the existing top of `router.test.ts` for whether `vi` is imported; add `import { vi } from 'vitest'` if needed.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/router.test.ts`
Expected: FAIL — createLocalPlan not called (branch missing).

- [ ] **Step 3: Edit `src/lib/router.ts`**

Add import: `import { createLocalPlan } from './local-plan'`
At the top of `createPlan` (before the `isWorkflowModeEnabled()` check):

```typescript
  if (process.env.BACKEND?.trim() === 'local') {
    return createLocalPlan(request)
  }
```

- [ ] **Step 4: Edit `src/app/api/plan/route.ts` catch**

Strip the `LocalComfy:` prefix for display and map to 503:

```typescript
  } catch (e) {
    const raw = e instanceof Error ? e.message : 'plan failed'
    const message = raw.startsWith('LocalComfy:')
      ? raw.slice('LocalComfy:'.length).trim()
      : raw
    const status = raw.startsWith('LocalComfy:')
      ? 503
      : message.includes('Enterprise-Shared')
        ? 403
        : message.includes('RH_API_KEY') ||
            message.includes('price previews failed')
          ? 503
          : message.includes('No NSFW')
            ? 422
            : 502

    return NextResponse.json({ error: message }, { status })
  }
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: all pass (existing + new).

- [ ] **Step 6: Commit**

```bash
GIT_MASTER=1 git add src/lib/router.ts src/app/api/plan/route.ts src/lib/router.test.ts
GIT_MASTER=1 git commit -m "feat: route plans to local ComfyUI when BACKEND=local" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

### Task 5: Generate route — local submit branch

**Files:**
- Modify: `src/app/api/generate/route.ts:33-47` (dispatch) and `:72-89` (catch)

**Interfaces:**
- Consumes: `submitPrompt` from `@/lib/local-comfy`; `plan.mode === 'local-comfy'`, `plan.localGraph`
- Produces: taskId = ComfyUI prompt_id; local errors → 502 without `formatComfyUiError`

- [ ] **Step 1: Edit dispatch**

Add import: `import { submitPrompt as submitLocalPrompt } from '@/lib/local-comfy'`

Replace the dispatch block:

```typescript
    let taskId: string

    if (plan.mode === 'local-comfy' && plan.localGraph) {
      taskId = await submitLocalPrompt(plan.localGraph)
    } else if (plan.mode === 'comfy' && plan.workflowId && plan.nodeInfoList) {
      const comfy = await submitComfyTask(plan.workflowId, plan.nodeInfoList)
      taskId = comfy.taskId
    } else {
```

- [ ] **Step 2: Edit catch block**

```typescript
  } catch (e) {
    const raw = e instanceof Error ? e.message : 'generate failed'
    const isLocal = raw.startsWith('LocalComfy:')
    const message = isLocal
      ? raw.slice('LocalComfy:'.length).trim()
      : raw.startsWith('ComfyUI')
        ? formatComfyUiError(raw)
        : raw
    const hint =
      message.includes('RH_API_KEY') &&
      !isLocal
        ? ` — configure RH_API_KEY in .env.local`
        : ''

    const status = isLocal
      ? 502
      : message.includes('RH_API_KEY')
        ? 503
        : message.includes('submit failed') || raw.startsWith('ComfyUI')
          ? comfyErrorStatus(raw)
          : 500

    return NextResponse.json({ error: message + hint }, { status })
  }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
GIT_MASTER=1 git add src/app/api/generate/route.ts
GIT_MASTER=1 git commit -m "feat: submit local ComfyUI prompts from generate route" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

### Task 6: Status route — local poll branch

**Files:**
- Modify: `src/app/api/status/route.ts:94-130`

**Interfaces:**
- Consumes: `getHistoryResult`, `buildViewUrl` from `@/lib/local-comfy`; `mFinal.apiMode === 'local-comfy'`
- Produces: RUNNING/SUCCESS/FAILED JSON identical in shape to existing branches

- [ ] **Step 1: Add import**

`import { buildViewUrl, getHistoryResult } from '@/lib/local-comfy'`

- [ ] **Step 2: Insert the local branch before `const isComfy = ...`**

```typescript
    const isLocal = mFinal.apiMode === 'local-comfy'

    if (isLocal) {
      const local = await getHistoryResult(job.taskId)

      if (local.status === 'FAILED') {
        await finalizeFailed(job.outputDir, mFinal, local.errorMessage)
        job.status = 'FAILED'
        job.errorMessage = local.errorMessage
        setJob(job)
        return NextResponse.json({
          status: 'FAILED' as const,
          errorMessage: job.errorMessage,
        })
      }

      if (local.status === 'SUCCESS') {
        await finalizeSuccess(job.outputDir, mFinal, buildViewUrl(local.image))
        job.status = 'SUCCESS'
        job.errorMessage = undefined
        setJob(job)
        return NextResponse.json({
          status: 'SUCCESS' as const,
          imageUrl: `/api/image?jobId=${encodeURIComponent(jobId)}`,
          outputPath: job.outputDir,
        })
      }

      return NextResponse.json({
        status: 'RUNNING' as const,
        progress: Math.min(95, Math.round(((pollCount + 1) / MAX_POLLS) * 100)),
      })
    }

    const isComfy = mFinal.apiMode === 'comfy'
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
GIT_MASTER=1 git add src/app/api/status/route.ts
GIT_MASTER=1 git commit -m "feat: poll local ComfyUI history from status route" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

### Task 7: Env docs

**Files:**
- Modify: `.env.example`
- Modify: `README.md` (Generation modes table + scripts table)

**Interfaces:** none

- [ ] **Step 1: Edit `.env.example`** — append:

```bash
# --- Local ComfyUI backend (optional; replaces RunningHub) -----------------
# Set BACKEND=local to plan/generate via the local ComfyUI at LOCAL_COMFY_URL.
# No cloud content review, no per-image cost. Leave unset for RunningHub.
# BACKEND=local
# LOCAL_COMFY_URL=http://localhost:8188
# Optional per-style checkpoint overrides (filename as shown in ComfyUI):
# LOCAL_CKPT_ANIME=ponyDiffusionV6XL_v6StartWithThisOne.safetensors
# LOCAL_CKPT_HENTAI=ponyDiffusionV6XL_v6StartWithThisOne.safetensors
# LOCAL_CKPT_HASSAKU=iniverseMixSFWNSFW_realXLV1.safetensors
# LOCAL_CKPT_REALISTIC=juggernautXL_ragnarokBy.safetensors
```

- [ ] **Step 2: Edit `README.md`** — in "Generation modes" table add a row:

| **Local ComfyUI** | `BACKEND=local` | Local `POST /api/prompt` + history polling | Uses **your** checkpoints on your machine (no G-2 filter) | Shown as ¥0 |

And in "Setup" after the `RH_WORKFLOW_ID` bullet, add:
```markdown
- Optional local mode: set `BACKEND=local` (see [Local ComfyUI backend](docs/superpowers/specs/oc_2026-08-14-local-comfyui-backend-design.md)). Start ComfyUI first (`make start`).
```

- [ ] **Step 3: Commit**

```bash
GIT_MASTER=1 git add .env.example README.md
GIT_MASTER=1 git commit -m "docs: document BACKEND=local ComfyUI mode" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

### Task 8: End-to-end verification

**Files:** none (manual QA)

**Interfaces:** none

- [ ] **Step 1: ComfyUI up**

Run: `curl -s http://localhost:8188/system_stats`
Expected: JSON with `system` key. If not, start it (`make start` or the user's usual launcher) and wait for ready.

- [ ] **Step 2: Build + tests**

Run: `npm run build && npx vitest run`
Expected: build succeeds (watch the Tailwind step — it must stay fast), all tests pass.

- [ ] **Step 3: Dev server + plan**

Run (in background): `npm run dev`
Then:
```bash
curl -sS -X POST http://localhost:4000/api/plan \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"test girl, seductive","style":"hentai","aspectRatio":"9:16","qualityTier":"high"}'
```
Expected: `"mode":"local-comfy"`, `"modelLabel":"Local ComfyUI (ponyDiffusionV6XL_v6StartWithThisOne)"`, `"estimatedPrice":0`, reason mentions local ComfyUI.

- [ ] **Step 4: Generate + poll**

```bash
curl -sS -X POST http://localhost:4000/api/generate \
  -H 'Content-Type: application/json' \
  -d "{\"planId\":\"<planId-from-step-3>\"}"
# → jobId
curl -sS "http://localhost:4000/api/status?jobId=<jobId>"   # repeat until SUCCESS (pony 28-34 steps, may take ~30-60s)
```
Expected: eventually `{"status":"SUCCESS","imageUrl":"/api/image?jobId=..."}`.

- [ ] **Step 5: Image + history**

```bash
curl -sS -o /tmp/local-test.png "http://localhost:4000/api/image?jobId=<jobId>"
file /tmp/local-test.png        # → PNG image data
curl -sS http://localhost:4000/api/history | head -c 400     # new run listed, apiMode local-comfy
ls outputs/$(date +%F)/<jobId>/ # → image.png + metadata.json + plan.json
```
Expected: valid PNG, history entry present, job dir populated.

- [ ] **Step 6: Confirm UI end-to-end** — open http://localhost:4000, Plan → Confirm → wait → image appears. The plan card shows "Local ComfyUI (ponyDiffusionV6XL_v6StartWithThisOne)".

- [ ] **Step 7: Regression — unset `BACKEND`**

Temporarily comment out `BACKEND=local`, restart dev, `curl /api/plan` → Expected: `"mode":"comfy"` (RunningHub workflow mode). Restore `BACKEND=local`.

- [ ] **Step 8: Final commit of any stragglers** (e.g. Task 0 leftover)

```bash
GIT_MASTER=1 git status
# commit anything unexpected with a justified message, or nothing
```
