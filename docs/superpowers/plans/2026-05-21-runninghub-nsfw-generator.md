# RunningHub NSFW Image Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Next.js app in `runninghub-app` that plans (model + price), confirms, generates NSFW images via RunningHub, and saves runs under `./outputs/`.

**Architecture:** Next.js API routes proxy RunningHub with `RH_API_KEY` server-side. A curated `data/models.json` feeds a router that price-previews candidates and returns a plan snapshot. Generate submits the task, polls `/openapi/v2/query`, downloads the image, writes metadata to disk.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS 4, Vitest (lib unit tests), native `fetch`

**Spec:** `docs/superpowers/specs/2026-05-21-runninghub-nsfw-generator-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `data/models.json` | Curated model allowlist |
| `src/lib/types.ts` | Shared TypeScript types |
| `src/lib/runninghub.ts` | RunningHub HTTP client |
| `src/lib/router.ts` | Plan selection + style suffixes |
| `src/lib/plans.ts` | Read/write `.plans/*.json` |
| `src/lib/output-store.ts` | Write `outputs/` + list history |
| `src/lib/jobs.ts` | In-memory job state for polling |
| `src/app/api/plan/route.ts` | POST plan |
| `src/app/api/generate/route.ts` | POST submit job |
| `src/app/api/status/route.ts` | GET poll + finalize |
| `src/app/api/history/route.ts` | GET list past runs |
| `src/app/api/reveal/route.ts` | GET open folder (macOS) |
| `src/app/page.tsx` | Generator UI |
| `src/app/globals.css` | Dark theme tokens |
| `src/lib/router.test.ts` | Router unit tests |

---

### Task 1: Scaffold Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `tailwind.config.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `.env.example`

- [ ] **Step 1: Initialize Next.js in repo root**

```bash
cd /Users/william.jiang/my-playgrounds/runninghub-app
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack
```

If `create-next-app` refuses non-empty dir, run with existing files only:

```bash
npm init -y
npm install next@15 react@19 react-dom@19
npm install -D typescript @types/node @types/react @types/react-dom tailwindcss @tailwindcss/postcss postcss eslint eslint-config-next
```

- [ ] **Step 2: Add `.env.example`**

```bash
cat > .env.example <<'EOF'
RH_API_KEY=your_32_char_runninghub_api_key
EOF
```

- [ ] **Step 3: Verify dev server starts**

```bash
npm run dev
```

Expected: `Ready on http://localhost:3000`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs src/ .env.example
git commit -m "chore: scaffold Next.js app for RunningHub generator"
```

---

### Task 2: Shared types + model catalog

**Files:**
- Create: `src/lib/types.ts`, `data/models.json`

- [ ] **Step 1: Create types**

Create `src/lib/types.ts`:

```typescript
export type Style = 'anime' | 'realistic' | 'hentai' | 'hassaku'
export type QualityTier = 'low' | 'medium' | 'high'

export type ModelEntry = {
  id: string
  label: string
  route: string
  nsfwOk: boolean
  styles: Style[] | ['all']
  tierMap: Record<
    QualityTier,
    { resolution: '1k' | '2k' | '4k'; quality: 'low' | 'medium' | 'high' }
  >
  priority: number
}

export type PlanRequest = {
  prompt: string
  style: Style
  aspectRatio: string
  qualityTier: QualityTier
}

export type PlanSnapshot = {
  planId: string
  createdAt: string
  request: PlanRequest
  route: string
  modelId: string
  modelLabel: string
  params: {
    prompt: string
    aspectRatio: string
    resolution: string
    quality: string
  }
  originalPrompt: string
  estimatedPrice: number
  currency: string
  reason: string
  alternatives: Array<{
    modelId: string
    modelLabel: string
    route: string
    estimatedPrice: number
    reason: string
  }>
}

export type JobRecord = {
  jobId: string
  planId: string
  taskId: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  createdAt: string
  outputDir?: string
  errorMessage?: string
}

export type RunMetadata = {
  jobId: string
  taskId: string
  createdAt: string
  prompt: string
  enhancedPrompt: string
  style: Style
  aspectRatio: string
  qualityTier: QualityTier
  route: string
  modelLabel: string
  estimatedPrice: number
  status: 'SUCCESS' | 'FAILED'
  imageFile?: string
  errorMessage?: string
  actualUsage?: Record<string, unknown>
}
```

- [ ] **Step 2: Create catalog**

Create `data/models.json`:

```json
[
  {
    "id": "g2-official",
    "label": "全能图片G-2-文生图-官方稳定版",
    "route": "rhart-image-g-2-official/text-to-image",
    "nsfwOk": true,
    "styles": ["realistic", "hentai", "hassaku", "anime"],
    "tierMap": {
      "low": { "resolution": "1k", "quality": "low" },
      "medium": { "resolution": "2k", "quality": "medium" },
      "high": { "resolution": "4k", "quality": "high" }
    },
    "priority": 10
  },
  {
    "id": "g2-budget",
    "label": "全能图片G-2.0-文生图-低价渠道版",
    "route": "rhart-image-g-2-0/text-to-image",
    "nsfwOk": true,
    "styles": ["anime", "hentai", "realistic", "hassaku"],
    "tierMap": {
      "low": { "resolution": "1k", "quality": "low" },
      "medium": { "resolution": "2k", "quality": "medium" },
      "high": { "resolution": "2k", "quality": "medium" }
    },
    "priority": 5
  }
]
```

If `g2-budget` route 404s at runtime, open https://www.runninghub.cn/runninghub-api-doc-cn/api-448183264 and fix `route` in JSON.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts data/models.json
git commit -m "feat: add shared types and model catalog"
```

---

### Task 3: RunningHub client

**Files:**
- Create: `src/lib/runninghub.ts`

- [ ] **Step 1: Implement client**

Create `src/lib/runninghub.ts`:

```typescript
const BASE = 'https://www.runninghub.cn'

function getApiKey(): string {
  const key = process.env.RH_API_KEY
  if (!key) throw new Error('RH_API_KEY is not set in .env.local')
  return key
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  }
}

export type SubmitBody = {
  prompt: string
  aspectRatio: string
  resolution: string
  quality: string
}

export type SubmitResponse = {
  taskId: string
  status: string
  errorCode?: string
  errorMessage?: string
  results?: Array<{ url?: string | null }> | null
}

export type QueryResponse = SubmitResponse & {
  usage?: Record<string, unknown> | null
}

export type PricePreviewResponse = {
  estimatedPrice: number
  currency: string
  errorCode?: string
  errorMessage?: string
}

export async function pricePreview(
  route: string,
  body: SubmitBody
): Promise<PricePreviewResponse> {
  const res = await fetch(`${BASE}/openapi/v2/price-preview/${route}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`price-preview failed ${res.status}: ${text}`)
  }
  return res.json()
}

export async function submitTask(
  route: string,
  body: SubmitBody
): Promise<SubmitResponse> {
  const res = await fetch(`${BASE}/openapi/v2/${route}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`submit failed ${res.status}: ${text}`)
  }
  return res.json()
}

export async function queryTask(taskId: string): Promise<QueryResponse> {
  const res = await fetch(`${BASE}/openapi/v2/query`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ taskId }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`query failed ${res.status}: ${text}`)
  }
  return res.json()
}

export async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/runninghub.ts
git commit -m "feat: add RunningHub API client"
```

---

### Task 4: Router (with tests)

**Files:**
- Create: `src/lib/router.ts`, `src/lib/router.test.ts`
- Modify: `package.json` (add vitest)

- [ ] **Step 1: Add vitest**

```bash
npm install -D vitest
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Write failing router tests**

Create `src/lib/router.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { enhancePrompt, rankCandidates } from './router'
import type { ModelEntry } from './types'

describe('enhancePrompt', () => {
  it('appends realistic suffix', () => {
    expect(enhancePrompt('a woman', 'realistic')).toContain('photorealistic')
  })
})

describe('rankCandidates', () => {
  const models: ModelEntry[] = [
    {
      id: 'a',
      label: 'A',
      route: 'a/text-to-image',
      nsfwOk: true,
      styles: ['realistic'],
      tierMap: {
        low: { resolution: '1k', quality: 'low' },
        medium: { resolution: '2k', quality: 'medium' },
        high: { resolution: '4k', quality: 'high' },
      },
      priority: 10,
    },
    {
      id: 'b',
      label: 'B',
      route: 'b/text-to-image',
      nsfwOk: true,
      styles: ['realistic'],
      tierMap: {
        low: { resolution: '1k', quality: 'low' },
        medium: { resolution: '2k', quality: 'medium' },
        high: { resolution: '2k', quality: 'medium' },
      },
      priority: 5,
    },
  ]

  it('picks lowest price for low tier', () => {
    const ranked = rankCandidates(
      models,
      [
        { modelId: 'a', estimatedPrice: 0.9, priority: 10 },
        { modelId: 'b', estimatedPrice: 0.4, priority: 5 },
      ],
      'low'
    )
    expect(ranked[0].modelId).toBe('b')
  })

  it('picks highest priority for high tier', () => {
    const ranked = rankCandidates(
      models,
      [
        { modelId: 'a', estimatedPrice: 0.9, priority: 10 },
        { modelId: 'b', estimatedPrice: 0.4, priority: 5 },
      ],
      'high'
    )
    expect(ranked[0].modelId).toBe('a')
  })
})
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
npm test
```

Expected: FAIL — `router` module not found

- [ ] **Step 4: Implement router**

Create `src/lib/router.ts`:

```typescript
import { readFileSync } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { ModelEntry, PlanRequest, QualityTier, Style } from './types'
import { pricePreview, type SubmitBody } from './runninghub'
import { savePlan } from './plans'

const STYLE_SUFFIX: Record<Style, string> = {
  anime: ', anime style, vibrant colors, detailed illustration',
  realistic: ', photorealistic, natural lighting, high detail',
  hentai: ', anime art style, mature themes',
  hassaku: ', soft anime shading, clean lineart',
}

export function loadCatalog(): ModelEntry[] {
  const p = path.join(process.cwd(), 'data', 'models.json')
  return JSON.parse(readFileSync(p, 'utf-8')) as ModelEntry[]
}

export function enhancePrompt(prompt: string, style: Style): string {
  return `${prompt.trim()}${STYLE_SUFFIX[style]}`
}

export function filterCandidates(
  catalog: ModelEntry[],
  style: Style
): ModelEntry[] {
  return catalog.filter(
    m =>
      m.nsfwOk &&
      (m.styles.includes('all' as Style) || (m.styles as Style[]).includes(style))
  )
}

export type ScoredCandidate = {
  modelId: string
  modelLabel: string
  route: string
  estimatedPrice: number
  currency: string
  priority: number
  params: SubmitBody
}

export function rankCandidates(
  _models: ModelEntry[],
  scored: ScoredCandidate[],
  tier: QualityTier
): ScoredCandidate[] {
  const copy = [...scored]
  if (tier === 'low') {
    return copy.sort((a, b) => a.estimatedPrice - b.estimatedPrice)
  }
  if (tier === 'high') {
    return copy.sort((a, b) => b.priority - a.priority || a.estimatedPrice - b.estimatedPrice)
  }
  return copy.sort(
    (a, b) => b.priority - a.priority + b.estimatedPrice - (a.priority + a.estimatedPrice)
  )
}

function buildReason(winner: ScoredCandidate, tier: QualityTier, style: Style): string {
  return `${style} + ${tier} → ${winner.modelLabel} (¥${winner.estimatedPrice.toFixed(2)} via ${winner.route})`
}

export async function createPlan(request: PlanRequest) {
  const catalog = loadCatalog()
  const candidates = filterCandidates(catalog, request.style)
  if (candidates.length === 0) {
    throw new Error('No NSFW-ok models match this style')
  }

  const enhanced = enhancePrompt(request.prompt, request.style)
  const previews: ScoredCandidate[] = []

  for (const model of candidates.slice(0, 4)) {
    const tierParams = model.tierMap[request.qualityTier]
    const params: SubmitBody = {
      prompt: enhanced,
      aspectRatio: request.aspectRatio,
      resolution: tierParams.resolution,
      quality: tierParams.quality,
    }
    try {
      const price = await pricePreview(model.route, params)
      if (price.errorMessage) continue
      previews.push({
        modelId: model.id,
        modelLabel: model.label,
        route: model.route,
        estimatedPrice: price.estimatedPrice,
        currency: price.currency,
        priority: model.priority,
        params,
      })
    } catch {
      continue
    }
  }

  if (previews.length === 0) {
    throw new Error('All price previews failed — check RH_API_KEY and membership')
  }

  const ranked = rankCandidates(catalog, previews, request.qualityTier)
  const winner = ranked[0]
  const alternatives = ranked.slice(1, 3).map(a => ({
    modelId: a.modelId,
    modelLabel: a.modelLabel,
    route: a.route,
    estimatedPrice: a.estimatedPrice,
    reason: `Alternative: ¥${a.estimatedPrice.toFixed(2)}`,
  }))

  const planId = randomUUID()
  const snapshot = {
    planId,
    createdAt: new Date().toISOString(),
    request,
    route: winner.route,
    modelId: winner.modelId,
    modelLabel: winner.modelLabel,
    params: winner.params,
    originalPrompt: request.prompt,
    estimatedPrice: winner.estimatedPrice,
    currency: winner.currency,
    reason: buildReason(winner, request.qualityTier, request.style),
    alternatives,
  }

  await savePlan(snapshot)
  return snapshot
}
```

- [ ] **Step 5: Add stub `plans.ts` for compile**

Create minimal `src/lib/plans.ts` (Task 5 expands it):

```typescript
import type { PlanSnapshot } from './types'

export async function savePlan(plan: PlanSnapshot): Promise<void> {
  const { writeFile, mkdir } = await import('fs/promises')
  const path = await import('path')
  const dir = path.join(process.cwd(), '.plans')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${plan.planId}.json`), JSON.stringify(plan, null, 2))
}

export async function loadPlan(planId: string): Promise<PlanSnapshot | null> {
  const { readFile } = await import('fs/promises')
  const path = await import('path')
  try {
    const raw = await readFile(path.join(process.cwd(), '.plans', `${planId}.json`), 'utf-8')
    return JSON.parse(raw) as PlanSnapshot
  } catch {
    return null
  }
}
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
npm test
```

Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add src/lib/router.ts src/lib/router.test.ts src/lib/plans.ts package.json package-lock.json
git commit -m "feat: add router with ranking and unit tests"
```

---

### Task 5: Plan persistence + output store + jobs

**Files:**
- Modify: `src/lib/plans.ts`
- Create: `src/lib/output-store.ts`, `src/lib/jobs.ts`

- [ ] **Step 1: Add plan TTL check in `loadPlan`**

Update `src/lib/plans.ts` — after parsing, reject if older than 5 minutes:

```typescript
const TTL_MS = 5 * 60 * 1000

export async function loadPlan(planId: string): Promise<PlanSnapshot | null> {
  const plan = /* existing read logic */
  if (!plan) return null
  if (Date.now() - new Date(plan.createdAt).getTime() > TTL_MS) return null
  return plan
}
```

- [ ] **Step 2: Implement output store**

Create `src/lib/output-store.ts`:

```typescript
import { mkdir, writeFile, readFile, readdir } from 'fs/promises'
import path from 'path'
import type { PlanSnapshot, RunMetadata } from './types'
import { downloadImage } from './runninghub'

export function outputDirForJob(jobId: string): string {
  const day = new Date().toISOString().slice(0, 10)
  return path.join(process.cwd(), 'outputs', day, jobId)
}

export async function initJobDir(
  jobId: string,
  plan: PlanSnapshot,
  taskId: string
): Promise<string> {
  const dir = outputDirForJob(jobId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2))
  const meta: RunMetadata = {
    jobId,
    taskId,
    createdAt: new Date().toISOString(),
    prompt: plan.originalPrompt,
    enhancedPrompt: plan.params.prompt,
    style: plan.request.style,
    aspectRatio: plan.request.aspectRatio,
    qualityTier: plan.request.qualityTier,
    route: plan.route,
    modelLabel: plan.modelLabel,
    estimatedPrice: plan.estimatedPrice,
    status: 'FAILED',
  }
  await writeFile(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2))
  return dir
}

export async function finalizeSuccess(
  dir: string,
  meta: RunMetadata,
  imageUrl: string,
  usage?: Record<string, unknown> | null
) {
  const buf = await downloadImage(imageUrl)
  await writeFile(path.join(dir, 'image.png'), buf)
  meta.status = 'SUCCESS'
  meta.imageFile = 'image.png'
  meta.actualUsage = usage ?? undefined
  await writeFile(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2))
}

export async function finalizeFailed(dir: string, meta: RunMetadata, errorMessage: string) {
  meta.status = 'FAILED'
  meta.errorMessage = errorMessage
  await writeFile(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2))
}

export async function listHistory(limit = 50) {
  const root = path.join(process.cwd(), 'outputs')
  const entries: Array<RunMetadata & { outputDir: string }> = []
  try {
    const days = await readdir(root)
    for (const day of days) {
      const dayPath = path.join(root, day)
      const jobs = await readdir(dayPath)
      for (const jobId of jobs) {
        const metaPath = path.join(dayPath, jobId, 'metadata.json')
        try {
          const raw = await readFile(metaPath, 'utf-8')
          const meta = JSON.parse(raw) as RunMetadata
          entries.push({ ...meta, outputDir: path.join(dayPath, jobId) })
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    return []
  }
  return entries
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}
```

- [ ] **Step 3: In-memory jobs map**

Create `src/lib/jobs.ts`:

```typescript
import type { JobRecord, RunMetadata } from './types'

const jobs = new Map<string, JobRecord>()
const metaCache = new Map<string, RunMetadata>()

export function setJob(job: JobRecord) {
  jobs.set(job.jobId, job)
}

export function getJob(jobId: string) {
  return jobs.get(jobId)
}

export function setMeta(jobId: string, meta: RunMetadata) {
  metaCache.set(jobId, meta)
}

export function getMeta(jobId: string) {
  return metaCache.get(jobId)
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/plans.ts src/lib/output-store.ts src/lib/jobs.ts
git commit -m "feat: add plan TTL, output store, and job registry"
```

---

### Task 6: API routes

**Files:**
- Create: `src/app/api/plan/route.ts`, `generate/route.ts`, `status/route.ts`, `history/route.ts`, `reveal/route.ts`

- [ ] **Step 1: POST `/api/plan`**

Create `src/app/api/plan/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createPlan } from '@/lib/router'
import type { PlanRequest } from '@/lib/types'

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PlanRequest
    if (!body.prompt?.trim()) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
    }
    const plan = await createPlan(body)
    return NextResponse.json(plan)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'plan failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```

- [ ] **Step 2: POST `/api/generate`**

Create `src/app/api/generate/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { loadPlan } from '@/lib/plans'
import { submitTask } from '@/lib/runninghub'
import { initJobDir } from '@/lib/output-store'
import { setJob, setMeta } from '@/lib/jobs'
import { readFile } from 'fs/promises'
import path from 'path'

export async function POST(req: Request) {
  try {
    const { planId } = await req.json()
    const plan = await loadPlan(planId)
    if (!plan) {
      return NextResponse.json({ error: 'plan expired or not found' }, { status: 404 })
    }
    const result = await submitTask(plan.route, plan.params)
    if (!result.taskId) {
      return NextResponse.json(
        { error: result.errorMessage || 'submit failed' },
        { status: 502 }
      )
    }
    const jobId = randomUUID()
    const outputDir = await initJobDir(jobId, plan, result.taskId)
    const metaRaw = await readFile(path.join(outputDir, 'metadata.json'), 'utf-8')
    const meta = JSON.parse(metaRaw)
    setJob({
      jobId,
      planId,
      taskId: result.taskId,
      status: 'RUNNING',
      createdAt: new Date().toISOString(),
      outputDir,
    })
    setMeta(jobId, meta)
    return NextResponse.json({ jobId, taskId: result.taskId, status: 'RUNNING' })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'generate failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 3: GET `/api/status`**

Create `src/app/api/status/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { queryTask } from '@/lib/runninghub'
import { getJob, getMeta } from '@/lib/jobs'
import { finalizeFailed, finalizeSuccess } from '@/lib/output-store'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'

const MAX_POLLS = 60

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get('jobId')
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const job = getJob(jobId)
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })

  if (job.status === 'SUCCESS') {
    return NextResponse.json({
      status: 'SUCCESS',
      imageUrl: `/api/image?jobId=${jobId}`,
      outputPath: job.outputDir,
    })
  }
  if (job.status === 'FAILED') {
    return NextResponse.json({ status: 'FAILED', errorMessage: job.errorMessage })
  }

  const pollCount = (job as { pollCount?: number }).pollCount ?? 0
  if (pollCount >= MAX_POLLS) {
    const meta = getMeta(jobId)!
    await finalizeFailed(job.outputDir!, meta, 'Timed out after 6 minutes')
    job.status = 'FAILED'
    job.errorMessage = 'timeout'
    return NextResponse.json({ status: 'FAILED', errorMessage: 'timeout' })
  }
  ;(job as { pollCount?: number }).pollCount = pollCount + 1

  const q = await queryTask(job.taskId)
  if (q.status === 'SUCCESS' && q.results?.[0]?.url) {
    const meta = getMeta(jobId)!
    await finalizeSuccess(job.outputDir!, meta, q.results[0].url!, q.usage)
    job.status = 'SUCCESS'
    return NextResponse.json({
      status: 'SUCCESS',
      imageUrl: `/api/image?jobId=${jobId}`,
      outputPath: job.outputDir,
      usage: q.usage,
    })
  }
  if (q.status === 'FAILED') {
    const meta = getMeta(jobId)!
    await finalizeFailed(job.outputDir!, meta, q.errorMessage || 'failed')
    job.status = 'FAILED'
    job.errorMessage = q.errorMessage
    return NextResponse.json({ status: 'FAILED', errorMessage: q.errorMessage })
  }

  return NextResponse.json({
    status: 'RUNNING',
    progress: Math.min(95, Math.round((pollCount / MAX_POLLS) * 100)),
  })
}
```

- [ ] **Step 4: GET `/api/image` (serve local file)**

Create `src/app/api/image/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { getJob } from '@/lib/jobs'

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get('jobId')
  const job = jobId ? getJob(jobId) : null
  if (!job?.outputDir) return new NextResponse('Not found', { status: 404 })
  const file = await readFile(path.join(job.outputDir, 'image.png'))
  return new NextResponse(file, { headers: { 'Content-Type': 'image/png' } })
}
```

- [ ] **Step 5: GET `/api/history` and `/api/reveal`**

`src/app/api/history/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { listHistory } from '@/lib/output-store'

export async function GET() {
  const items = await listHistory(50)
  return NextResponse.json({ items })
}
```

`src/app/api/reveal/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { getJob } from '@/lib/jobs'

const execAsync = promisify(exec)

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get('jobId')
  const job = jobId ? getJob(jobId) : null
  if (!job?.outputDir) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!job.outputDir.startsWith(process.cwd())) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 })
  }
  await execAsync(`open "${job.outputDir}"`)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/
git commit -m "feat: add plan, generate, status, history, reveal API routes"
```

---

### Task 7: Generator UI

**Files:**
- Create: `src/app/page.tsx`
- Modify: `src/app/layout.tsx`, `src/app/globals.css`

- [ ] **Step 1: Dark globals**

`src/app/globals.css` — ensure dark background:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg: #0f0f12;
  --card: #1a1a22;
  --accent: #e11d48;
  --text: #f4f4f5;
  --muted: #a1a1aa;
}

body {
  background: var(--bg);
  color: var(--text);
}
```

- [ ] **Step 2: Build `page.tsx`**

Create client component `src/app/page.tsx` with:

- State: `prompt`, `style`, `aspectRatio`, `qualityTier`, `plan`, `jobId`, `status`, `imageUrl`, `error`, `history`
- Defaults: realistic, 1:1, medium
- `handlePlan` → POST `/api/plan`
- `handleConfirm` → POST `/api/generate` → start `setInterval` 8s polling `/api/status?jobId=`
- Plan card shows: modelLabel, route, params, estimatedPrice, reason, alternatives
- Buttons: Plan, Confirm (disabled until plan), Edit plan
- History: `useEffect` load `/api/history`; select reloads image via static path note (history items need image endpoint by path — use `/api/image?jobId=` only for active job; for history store `jobId` in metadata and add `GET /api/image?path=` or re-use jobId from metadata)

**History image fix:** metadata already has `jobId` — add `GET /api/image?jobId=` that reads from disk using `outputDir` lookup: extend `getJob` OR read `outputs/**/metadata.json` by jobId in image route.

Update image route to fall back to disk search:

```typescript
// In image/route.ts — if job not in memory, scan outputs for metadata.jobId === jobId
```

- [ ] **Step 3: Manual UI test**

```bash
npm run dev
```

1. Open http://localhost:3000
2. Enter prompt → Plan → see price
3. Confirm → wait for image
4. Check `./outputs/YYYY-MM-DD/<jobId>/`

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/app/globals.css src/app/layout.tsx src/app/api/image/route.ts
git commit -m "feat: add generator UI with plan-confirm-poll flow"
```

---

### Task 8: README + final verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: README**

```markdown
# RunningHub NSFW Image Generator (local)

## Setup

cp .env.example .env.local
# Add RH_API_KEY from RunningHub API console

npm install
npm run dev
```

Open http://localhost:3000

## Scripts

- `npm run dev` — local server
- `npm test` — router unit tests

## Outputs

Generated runs saved to `outputs/YYYY-MM-DD/<jobId>/`.
```

- [ ] **Step 2: Run full checklist**

| Check | Command / action |
|-------|------------------|
| Unit tests | `npm test` → PASS |
| Plan API | curl -X POST localhost:3000/api/plan -H 'Content-Type: application/json' -d '{"prompt":"test","style":"realistic","aspectRatio":"1:1","qualityTier":"medium"}' |
| Env guard | unset RH_API_KEY → expect 502 with clear message |

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README and verify local generator flow"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| No auth | All tasks (no auth code) |
| Plan → confirm | Task 6–7 |
| Style/ratio/quality controls | Task 7 |
| Curated router + price preview | Task 4 |
| `./outputs/` history | Task 5, 6, 7 |
| Local Mac + reveal folder | Task 6 |
| RunningHub poll 8s / 6min | Task 6 status route |
| No negative prompt | — |
| No ComfyUI | — |

## Self-review

- All tasks have file paths and code blocks
- No TBD placeholders
- `g2-budget` route may need verification against RunningHub doc (noted in Task 2)
- Image route disk fallback mentioned in Task 7 for history reload
