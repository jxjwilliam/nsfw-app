# RunningHub NSFW Image Generator

Single-user Next.js app: enter a prompt, **plan** a generation path (model or ComfyUI workflow + estimated cost), **confirm**, poll until the image finishes, and save the media. One codebase, **two deployment modes** — they run with different environment variables:

| Mode | Stack | Key env vars | Output |
|------|-------|--------------|--------|
| **Local** | ComfyUI + web UI + checkpoints + local workflows (Mac) | `BACKEND=local`, `LOCAL_COMFY_URL`, `LOCAL_CKPT_<STYLE>` | `outputs/` (SamsungT7 symlink), full records |
| **Remote** | Vercel + RunningHub + Cloudflare R2 | `RH_API_KEY`, `RH_WORKFLOW_ID`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | R2 bucket `nfsw`, **media file only** (`media-<jobId>.png`) |

- **Local:** `npm run dev` on port 4000, generation via your local ComfyUI at
  `LOCAL_COMFY_URL`, using your checkpoints and `local-comfyui/workflows/`.
  Nothing leaves the Mac.
- **Remote:** deploy to Vercel, generate via RunningHub (ComfyUI workflow or
  Standard Model), and persist only the media file to Cloudflare R2 — no
  folders, no metadata.json in the bucket. See
  [Vercel + RunningHub + R2 deploy guide](docs/vercel-runninghub-deploy.md).

**Documentation**

| Doc | Contents |
|-----|----------|
| [Implementation guide](docs/implementation-guide.md) | Detailed flows, mermaid diagrams, dual-backend behavior (less code, more description) |
| [Image creation pipeline](docs/image-creation-pipeline.md) | All resources and parameters used from plan → generate → status |
| [Local ComfyUI design spec](docs/superpowers/specs/oc_2026-08-14-local-comfyui-backend-design.md) | Current `BACKEND=local` design |
| [Local ComfyUI build plan](docs/superpowers/plans/oc_2026-08-14-local-comfyui-backend.md) | Agent step-by-step implementation checklist |
| [ComfyUI workflow setup](runninghub/workflows/README.md) | Import `sdxl-*.json` on RunningHub, node map, RH 810/801 fixes |
| [Vercel + RunningHub + R2 deploy guide](docs/vercel-runninghub-deploy.md) | Remote mode: env vars, R2 bucket/token setup, storage caveats |

## App workflow

### What you do in the UI

```text
┌─────────────┐     Plan      ┌──────────────┐    Confirm     ┌─────────────┐
│  Prompt +   │ ────────────► │  Plan card   │ ─────────────► │  Generating │
│ style/ratio │               │ model, ¥, why│                │  (polling)  │
│  / quality  │ ◄──────────── │  alternatives│                └──────┬──────┘
└─────────────┘   Edit plan   └──────────────┘                       │
       ▲                                                               ▼
       │                                                    ┌─────────────────┐
       └──────────────── History (past runs on disk) ◄──────│ image.png saved │
                                                            └─────────────────┘
```

1. **Enter** prompt and chips (style, aspect ratio, quality). Defaults: **Hentai · 9:16 · High**. Choices persist in browser `localStorage` (`runninghub-nsfw-prefs-v1`).
2. **Plan** — server picks a route, shows label, estimated price (Standard mode), reason, and up to two alternatives.
3. **Confirm** — server submits a RunningHub task and returns a `jobId`.
4. **Poll** — UI calls `/api/status` every ~8s until `SUCCESS` or `FAILED` (max ~6 minutes).
5. **View** — image served from `/api/image?jobId=...`; locally the full run is written under `outputs/YYYY-MM-DD/<jobId>/`, on Vercel only the media file is mirrored to R2.

No login, no payment UI — only your RunningHub account balance is charged when you confirm.

## Screenshots

| Home |
|------|
| ![Home](screenshots/home.png) |

## Server workflow

### What the server does (plan → generate → status)

```mermaid
sequenceDiagram
  participant UI as Browser
  participant Plan as POST /api/plan
  participant Gen as POST /api/generate
  participant Status as GET /api/status
  participant RH as RunningHub

  UI->>Plan: prompt, style, aspectRatio, qualityTier
  Plan->>Plan: choose ComfyUI workflow or Standard Model route
  Plan-->>UI: planId, route, estimatedPrice, reason

  UI->>Gen: planId
  Gen->>RH: submit task for selected route
  Gen->>Gen: init outputs/.../metadata.json
  Gen-->>UI: jobId, taskId

  UI->>Status: jobId
  Status->>RH: query task status until success or failure
  Status-->>UI: RUNNING, SUCCESS, or FAILED
  Status->>Gen: on success, save image to outputs/.../image.png
```

### Generation modes

The app chooses the backend from `.env.local`:

| Mode | When | RunningHub API | Content safety | Price on plan card |
|------|------|----------------|----------------|--------------------|
| **ComfyUI workflow** | `RH_WORKFLOW_ID` is set | `POST /task/openapi/create` + poll `outputs` | Uses **your** checkpoint/workflow on RunningHub (no G-2 text filter) | Shown as ¥0 (billing on RunningHub) |
| **Local ComfyUI** | `BACKEND=local` | Local `POST /api/prompt` + history polling | Uses **your** checkpoints on your machine (no G-2 filter) | Shown as ¥0 |
| **Standard Model** | `RH_WORKFLOW_ID` empty | `POST /openapi/v2/.../text-to-image` + `query` | G-2 **server-side** review (error `1501` on explicit prompts) | Live **price-preview** per model |

**ComfyUI setup:** import [`runninghub/workflows/sdxl-txt2img-api.json`](runninghub/workflows/sdxl-txt2img-api.json) on RunningHub, then set `RH_WORKFLOW_ID` — see [ComfyUI workflow setup](#comfyui-workflow-setup-recommended-for-nsfw) and [`runninghub/workflows/README.md`](runninghub/workflows/README.md).

### Router (Standard Model mode only)

When `RH_WORKFLOW_ID` is not set, `/api/plan` runs the curated router:

1. Load allowlist from [`runninghub/models.json`](runninghub/models.json) (`nsfwOk` + style match).
2. **Enhance** prompt with a style suffix (anime, realistic, hentai, hassaku).
3. **Price-preview** up to four candidates via RunningHub `POST /openapi/v2/price-preview/{route}`.
4. **Rank** by quality tier:
   - **Low** — cheapest estimated ¥
   - **High** — highest catalog `priority`, then price
   - **Medium** — balance `priority × 10 − price`
5. Save winning plan (+ up to two alternatives) to `.plans/<planId>.json`.

ComfyUI mode skips the router and builds a `nodeInfoList` (prompt, negative, width/height, steps, cfg, seed) mapped to nodes in `runninghub/workflows/sdxl-txt2img-api.json` — overridable via `RH_WORKFLOW_*_NODE` env vars.

### API routes

| Route | Method | Role |
|-------|--------|------|
| `/api/plan` | POST | Create plan snapshot; return `planId`, route, price, reason |
| `/api/generate` | POST | Submit task from `planId`; create `outputs/...` job folder |
| `/api/status` | GET | Poll RunningHub; finalize `image.png` or failure |
| `/api/image` | GET | Serve saved `image.png` for a `jobId` |
| `/api/history` | GET | List runs from `outputs/**/metadata.json` |
| `/api/reveal` | GET | Reveal blurred preview metadata for a run |
| `/api/workflow-setup` | GET | Validate `RH_WORKFLOW_ID` and list editable workflow nodes |

### On-disk layout

```text
runninghub-app/
├── .env.local              # RH_API_KEY, PORT, optional RH_WORKFLOW_ID
├── runninghub/             # everything RunningHub
│   ├── models.json         # Standard Model catalog (router)
│   └── workflows/          # ComfyUI JSON to import on RunningHub (see runninghub/workflows/README.md)
├── local-comfyui/          # everything local ComfyUI
│   ├── checkpoints/        # symlink to your model dir (do not scan)
│   └── workflows/          # script-generated workflows (scripts/generate-nsfw-workflows.js) + video/
├── .plans/<planId>.json    # gitignored; plan TTL ~5 min
└── outputs/YYYY-MM-DD/<jobId>/
    ├── metadata.json       # status, prompts, route, usage
    ├── plan.json           # full plan snapshot
    └── image.png           # after SUCCESS
```

`outputs/` is gitignored. You may use a **symlink** to external storage (e.g. exFAT) — `listHistory` and job hydration skip macOS `._*` AppleDouble junk so `/api/status` and `/api/history` keep working after a dev-server restart.

On **Vercel**, `outputs/` and `.plans/` live in ephemeral `/tmp`; on success the
image is uploaded to R2 as `media-<jobId>.png` (nothing else) and
`/api/image` falls back to R2 after a cold start. Metadata stays local-only in
both modes.

## Prerequisites

- Node.js 18+ (align with your Next.js 15 toolchain)
- A RunningHub API key ([RunningHub console](https://www.runninghub.cn))

## Setup

```bash
cp .env.example .env.local
# Edit .env.local: set RH_API_KEY from RunningHub API console (server-side only).
# Optional: PORT=4000 (default dev port; change in .env.local).
# Optional: set RH_WORKFLOW_ID after importing the ComfyUI workflow (see below).
# Optional local mode: set BACKEND=local (see the Local ComfyUI backend row
# above and docs/superpowers/specs/oc_2026-08-14-local-comfyui-backend-design.md).
# Start ComfyUI first (`make start`), then plan cards show the local checkpoint.

npm install
npm run dev
```

Open http://localhost:4000 (`npm run dev` reads `PORT` from `.env.local`, default **4000**).

Use **Plan** → review the card → **Confirm** to generate.

Production-style run (after build):

```bash
npm run build
npm run start
```

For the **remote (Vercel + RunningHub + R2)** variant, the code is the same —
only the environment variables differ; see
[`docs/vercel-runninghub-deploy.md`](docs/vercel-runninghub-deploy.md) for the
full runbook.

Without `RH_API_KEY`, plan/generate routes return **503** with a message about the missing key — add it to `.env.local` and restart the dev server.

## RunningHub notes

**API key tier (Standard Model):** G-2 text-to-image requires an **Enterprise-Shared** key. Consumer keys return error `1014` on Plan.

**Content safety (G-2):** No API or env switch disables review on Standard Model routes. Error `1501` means the prompt was blocked — use ComfyUI workflow mode or softer wording.

**ComfyUI workflow readiness:** Error **810** (`WORKFLOW_NOT_SAVED_OR_NOT_RUNNING`) means the ID is set but the workflow was not saved/run in the RunningHub UI yet. `/api/generate` and `/api/workflow-setup` return **502** with steps to fix. Error **801** means the workflow ID is invalid.

### ComfyUI workflow setup (recommended for NSFW)

1. Import [`runninghub/workflows/sdxl-txt2img-api.json`](runninghub/workflows/sdxl-txt2img-api.json) on [RunningHub](https://www.runninghub.cn) ([`runninghub/workflows/README.md`](runninghub/workflows/README.md)).
2. Set an uncensored SDXL checkpoint in **Load Checkpoint** and run the workflow once.
3. Copy the numeric ID from the workflow URL into `.env.local`:
   ```env
   RH_WORKFLOW_ID=1980237776367083521
   ```
4. Restart `npm run dev`.
5. Verify:
   ```bash
   curl -sS http://localhost:4000/api/workflow-setup
   ```

Plan should then show **ComfyUI workflow (RH_WORKFLOW_ID)** instead of a G-2 model.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Next.js dev server (`PORT` from `.env.local`, default **4000**) |
| `npm run build` | Production build |
| `npm run start` | Serve production build (after `build`) |
| `npm run lint` | ESLint via Next.js |
| `npm test` | Router, Comfy plan, and output-store unit tests (Vitest) |
| `node scripts/generate-nsfw-workflows.js` | Regenerate `local-comfyui/workflows/` (1 per checkpoint, 832×1216, NSFW prompts from a random pick of DeepSeek / Kimi / Qwen) |
| `node scripts/run-workflows.js --source=generated` | Submit generated workflows to local ComfyUI |
| `node scripts/generate-animatediff-video.js` | Generate a short NSFW video via local ComfyUI (AnimateDiff) |

LLM prompt generation needs at least one of `DEEPSEEK_API_KEY`, `KIMI_API_KEY`,
or `DASHSCOPE_API_KEY` in `.env.local` (see `.env.example` for defaults).

## Quick API smoke test

With the dev server running:

```bash
curl -sS -X POST http://localhost:4000/api/plan \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"test","style":"hentai","aspectRatio":"9:16","qualityTier":"high"}'
```

Expect JSON with `planId`, `modelLabel`, `estimatedPrice` (Standard) or ComfyUI workflow fields — or an error if the key, tier, or network fails.
