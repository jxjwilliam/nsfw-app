# Local ComfyUI Backend — Design Spec

Date: 2026-08-14
Status: awaiting user review
Author: OpenCode (Sisyphus)

## 1. Goal

Switch the app's generation backend from RunningHub cloud APIs to the local
ComfyUI instance at `http://localhost:8188`, so explicit/adult generation runs
locally with no cloud content review and no per-image cost. RunningHub support
remains intact and stays the default when the new env switch is absent.

Decisions already made with the user:

- Mode switching is by **environment variable** (not a UI toggle, not
  auto-detect, not full replacement).
- Checkpoint selection is by **style-chip auto-mapping** (not a fixed env
  checkpoint, not a UI dropdown).

## 2. Configuration

New variables in `.env.local` (and documented in `.env.example`):

| Var | Default | Meaning |
|---|---|---|
| `BACKEND` | *(unset = runninghub)* | `local` routes plan/generate/status to local ComfyUI. Any other value keeps current behavior. |
| `LOCAL_COMFY_URL` | `http://localhost:8188` | Base URL of the local ComfyUI server. |
| `LOCAL_CKPT_ANIME` / `LOCAL_CKPT_HENTAI` / `LOCAL_CKPT_HASSAKU` / `LOCAL_CKPT_REALISTIC` | see §4 table | Optional per-style checkpoint filename overrides. |

`COMFYUI_URL` already exists for the `scripts/` tooling; the app code uses
`LOCAL_COMFY_URL` so the two can diverge, but `.env.example` sets both to the
same default.

## 3. Architecture & data flow

`createPlan()` in `src/lib/router.ts` gains a first branch: when
`process.env.BACKEND === 'local'`, delegate to `createLocalPlan(request)` and
skip both RunningHub paths (`isWorkflowModeEnabled` / standard router).
Everything downstream keys off `plan.mode === 'local-comfy'`.

```text
Plan    → /api/plan (unchanged validation)
        → createLocalPlan: ping ComfyUI /system_stats (2s timeout)
        → pick checkpoint by style, enhance prompt, build full workflow graph
        → persist graph inside plan snapshot (.plans/<planId>.json)
Confirm → /api/generate branch mode==='local-comfy'
        → POST {LOCAL_COMFY_URL}/api/prompt  → prompt_id (used as taskId)
        → initJobDir(jobId, plan, taskId) unchanged
Poll    → /api/status branch apiMode==='local-comfy'
        → GET /api/history/{prompt_id}
        → success → GET /view?filename=...&type=output
                  → finalizeSuccess(dir, meta, viewUrl) — unchanged,
                    downloadImage() fetches the local URL like any http URL
```

`ApiMode` becomes `'standard' | 'comfy' | 'local-comfy'`.
`PlanSnapshot` gains optional `localGraph?: Record<string, unknown>` (the
ComfyUI API-format workflow). `RunMetadata.apiMode` reuses the same enum, so
status polling after a dev-server restart still branches correctly via
`ensureJobHydrated`.

## 4. Checkpoint mapping & sampler params

| style chip | checkpoint file | prompt prefix | base steps / cfg |
|---|---|---|---|
| `anime` | `ponyDiffusionV6XL_v6StartWithThisOne.safetensors` | `score_9, score_8_up, score_7_up, score_6_up, ` | 28 / 7.5 |
| `hentai` | `ponyDiffusionV6XL_v6StartWithThisOne.safetensors` | same pony score prefix | 28 / 7.5 |
| `hassaku` | `iniverseMixSFWNSFW_realXLV1.safetensors` | *(none)* | 28 / 6.5 |
| `realistic` | `juggernautXL_ragnarokBy.safetensors` | `masterpiece, best quality, photorealistic, ` | 28 / 6.5 |

Quality tier adjusts steps only: low = base − 10, medium = base, high =
base + 6 (floor 4). cfg stays at the checkpoint base for all tiers.

Dimensions reuse the already-exported `resolveDimensions()` from
`src/lib/comfy-plan.ts` (no changes to that file beyond exporting
`DEFAULT_NEGATIVE` for the shared negative base). The negative prompt is
`DEFAULT_NEGATIVE`, extended for pony checkpoints with
`score_4, score_3, score_2, score_1`.

Workflow graph: the 7-node skeleton already proven by
`scripts/generate-nsfw-workflows.js` — KSampler(3), CheckpointLoaderSimple(4),
EmptyLatentImage(5), CLIPTextEncode positive(6), CLIPTextEncode negative(7),
VAEDecode(37), SaveImage(9) with `filename_prefix` `nsfw-app-<style>`. Seed is
random 32-bit per plan.

## 5. Files

| File | Change |
|---|---|
| `src/lib/local-comfy.ts` | **New.** ComfyUI client: `pingComfy()`, `submitPrompt(graph)`, `getHistoryEntry(promptId)`, `buildViewUrl(img)`. Types for history entries/images. |
| `src/lib/local-plan.ts` | **New.** checkpoint table, `buildLocalWorkflow(request, enhanced)`, `createLocalPlan(request)`. |
| `src/lib/types.ts` | `ApiMode` + `'local-comfy'`; `PlanSnapshot.localGraph?` |
| `src/lib/router.ts` | `createPlan` BACKEND branch (one `if` + import) |
| `src/lib/comfy-plan.ts` | export `DEFAULT_NEGATIVE` (currently module-private) |
| `src/app/api/generate/route.ts` | `mode === 'local-comfy'` submit branch |
| `src/app/api/status/route.ts` | `apiMode === 'local-comfy'` poll branch |
| `.env.example`, `README.md` | document `BACKEND`, `LOCAL_COMFY_URL`, overrides |
| `tests/local-plan.test.ts` | **New.** mapping, prefixes, tier steps, graph wiring |
| `tests/local-comfy.test.ts` | **New.** mocked-fetch client state machine |

Existing UI (`page.tsx`), `/api/image`, `/api/history`, `/api/reveal`,
`jobs.ts`, `output-store.ts`, RunningHub modules: **untouched**.

## 6. Status & error semantics (local mode)

| ComfyUI state | App result |
|---|---|
| no history entry yet / queue non-empty | `RUNNING` (progress = existing pollCount estimate) |
| `status.status_str === 'success'` + image in outputs | `SUCCESS`, image saved to job dir |
| `status.status_str === 'error'` | `FAILED` with node's exception message |
| `status.completed === false` + `status_str` unknown | `FAILED` with raw status json (defensive) |

Error handling:

- Plan-time: `pingComfy()` fails → 503 "local ComfyUI not reachable at
  \<LOCAL_COMFY_URL\> — start ComfyUI or unset BACKEND".
- Submit-time: ComfyUI `error`/`node_errors` in the `/api/prompt` response →
  502 with the first node error message (e.g. checkpoint not found).
- Poll timeout: existing `MAX_POLLS` (~6 min) logic applies unchanged.

## 7. Testing

- `tests/local-plan.test.ts`: style→checkpoint mapping incl. env override;
  pony/realistic prefixes; low/medium/high step counts; graph has all 7 nodes
  with correct input links (`["4",0]`→model etc.); snapshot shape (`mode`,
  `localGraph`, `estimatedPrice: 0`).
- `tests/local-comfy.test.ts`: `submitPrompt` returns prompt_id, maps
  node_errors to thrown Error; `getHistoryEntry` maps success/error/missing to
  the status union; `buildViewUrl` encodes filename/subfolder.
- Regression: full `npm test` green with `BACKEND` unset; `npm run build`
  green.

## 8. Prerequisite ops item (not code)

The `outputs` symlink currently points at the sick SamsungT7 mount
(`ls outputs/` → EINVAL). `initJobDir` writes `plan.json`/`metadata.json`
there, so **Confirm fails in every mode until this is fixed**. Implementation
plan step 0: either remount SamsungT7, or replace the symlink with a real
`outputs/` directory inside the project (job dirs are only metadata + a copy;
the primary image also lives in ComfyUI's own output dir). Default choice if
the user doesn't care: real local directory.

## 9. Out of scope (YAGNI)

- UI backend toggle, UI checkpoint dropdown
- ComfyUI websocket progress (history polling is sufficient)
- LoRA / ControlNet / img2img / upscaling pipelines
- Queue management UI (cancel, list)
- Multi-image batches (batch_size stays 1)
