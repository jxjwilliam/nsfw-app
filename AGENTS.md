# AGENTS.md

Single-user Next.js 15 app: prompt → **plan** (pick backend + cost) → **confirm** → poll → save media. Two deployment modes, same code, different env vars:

- **Local** — ComfyUI + web UI + checkpoints + local workflows (`BACKEND=local`,
  `LOCAL_COMFY_URL`, `LOCAL_CKPT_<STYLE>`); artifacts under `outputs/`
  (SamsungT7 symlink).
- **Remote (Vercel)** — Vercel + RunningHub + Cloudflare R2 (`RH_API_KEY`,
  `RH_WORKFLOW_ID`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`); only the media file is uploaded to
  R2 (`media-<jobId>.png`, flat key). Runbook: `docs/vercel-runninghub-deploy.md`.

## Commands

- `npm run dev` — dev server on `PORT` (default 4000). The script sources `.env.local` itself (`set -a && . ./.env.local`); **restart the dev server after editing `.env.local`**.
- `npm test` (= `npx vitest run`) — colocated tests in `src/lib/*.test.ts`, no vitest config. Single file: `npx vitest run src/lib/local-plan.test.ts`
- `npx tsc --noEmit` — typecheck (writes `tsconfig.tsbuildinfo`, gitignored)
- `npm run build` — prod build
- `make start` — start local ComfyUI backend on 8188 (`COMFY_DIR` defaults to `~/pinokio/api/comfy.git/app`); `make start-lowvram` for the 18GB M3

## Backend switching (most common mistake)

`.env.local` decides the backend; there is no UI toggle.
Local vs remote is decided by where the app runs and which env vars are set:
remote mode simply doesn't set `BACKEND=local` and adds the `R2_*` vars on
Vercel.

| Mode | Env | Flow |
|---|---|---|
| Local ComfyUI | `BACKEND=local` | local `POST /api/prompt` + history poll; requires ComfyUI up (else plan → 503); ¥0 |
| RH ComfyUI workflow | `RH_WORKFLOW_ID` set | RunningHub openapi task + outputs poll; no G-2 text filter |
| Standard model | neither | G-2 server-side filter; needs **Enterprise-Shared** `RH_API_KEY` |

- Style→checkpoint mapping and per-checkpoint tuning live in `src/lib/local-plan.ts` (`CHECKPOINT_BY_STYLE`, `SPEC_BY_FILE`); overridable via `LOCAL_CKPT_<STYLE>` env vars.
- Error prefix convention is load-bearing: local client errors start `LocalComfy:`, RunningHub comfy errors start `ComfyUI`. Route handlers branch on the prefix for status codes (plan: `LocalComfy:` → 503, generate: → 502) and to skip `formatComfyUiError`. Keep the prefixes when adding client errors.

## Architecture

- Thin route handlers in `src/app/api/{plan,generate,status,image,history,reveal,workflow-setup}/route.ts`; all logic in `src/lib/*.ts`. Put new logic there with colocated vitest tests (env save/restore in `beforeEach`/`afterEach`, see `router.test.ts`).
- Lifecycle: `/api/plan` saves `.plans/<planId>.json` (5 min TTL) → `/api/generate` creates `outputs/YYYY-MM-DD/<jobId>/` → `/api/status` polls the backend and finalizes `image.png`.
- `outputs/` is a **symlink to ComfyUI's output dir on the SamsungT7 exFAT drive**. `output-store.ts` skips macOS `._*` AppleDouble files — new code reading outputs must do the same. If the drive is unmounted, status/history break after a dev-server restart.
- `local-comfyui/checkpoints/` is a symlink to a multi-GB model dir. **Never let Tailwind scan it**: `src/app/globals.css` must keep `@import "tailwindcss" source(none);` + `@source "../**/*.{ts,tsx,mdx}";`. A plain `@import "tailwindcss"` makes `next build` scan the symlink and hang at ~32GB memory.
- Backend dispatch happens in `createPlan()` (`src/lib/router.ts`): `BACKEND=local` → `createLocalPlan`, else comfy-workflow or standard router.
- `src/lib/r2.ts` — dependency-free SigV4 R2 client, gated to Vercel
  (`VERCEL=1`) or `R2_ENABLED=true` (local dev never calls it). **The bucket
  holds media only** (`media-<jobId>.png`, flat key): never upload
  metadata.json, folders, or timestamps to R2. `finalizeSuccess` mirrors the
  image; `/api/image` falls back to R2 after a cold start. Keys:
  `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET_NAME` (default `nfsw`), optional `R2_ENDPOINT` / `R2_ENABLED`.

## Workflows & scripts

- `runninghub/` — everything RunningHub: `models.json` (Standard Model catalog) + `workflows/` (hand-written static RunningHub templates, `sdxl-*.json`, 1024×1024, `runninghub-nsfw` prefix). Edit by hand.
- `local-comfyui/` — everything local ComfyUI: `checkpoints/` symlink + `workflows/` (**script output; do not hand-edit**). `scripts/generate-nsfw-workflows.js` regenerates it (dated filenames, 832×1216, per-checkpoint NSFW prompts; it randomly picks DeepSeek / Kimi / Qwen from the configured keys — overridable with `DEEPSEEK_MODEL`, `KIMI_MODEL`, `QWEN_MODEL`). `scripts/run-workflows.js` submits these to local ComfyUI.
- `scripts/start_comfyui_m3.sh` — M3 Pro 18GB launcher; must run from the ComfyUI root (where `main.py` is).

## Conventions & gotchas

- Semantic lowercase commit messages (`fix:`, `feat:`, `docs:`, `chore:`, `cleanup:`) — established in history.
- R2 (remote mode) stores only the generated media file — no metadata, no
  directories. Local `outputs/` keeps the full record; remote history is
  per-instance only because Vercel `/tmp` is ephemeral.
- Standard-mode prompts go through G-2 review; explicit prompts return error `1501`. Workflow and local modes bypass it.
- RunningHub workflow errors: `810` = workflow not saved/run yet, `801` = invalid workflow ID (see README for fixes).
- New AI-generated docs under `docs/superpowers/` use a `oc_` date prefix (`oc_YYYY-MM-DD-<name>.md`); user-authored docs (`docs/`, `local-comfyui/workflows/`, `screenshots/`) keep their names.
- Gitignored (do not commit): `.env.local`, `.omo/`, `outputs/`, `checkpoints/`, `prompts/`, `logs/`, `tsconfig.tsbuildinfo`.
