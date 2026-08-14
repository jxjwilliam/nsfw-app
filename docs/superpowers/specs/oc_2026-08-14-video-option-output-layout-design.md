# Video Option + `nsfw/images|video` Output Layout — Design

- Date: 2026-08-14
- Status: awaiting user review
- Approach: A — extend the existing plan/job pipeline with a `mediaType` field (rejected: B separate video pipeline — duplicates the plan→confirm→poll machinery; C full media-agnostic refactor — refactor risk disproportionate to one new graph shape)

## Locked decisions (from user)

1. **Video engine**: AnimateDiff + SD1.5 on local ComfyUI only. All assets verified on disk: `mm_sd_v15_v2.ckpt` in `animatediff_models/`, `realisticVisionV51_v51VAE.safetensors` + V60B1 in ComfyUI `models/checkpoints/`, custom nodes `ComfyUI-AnimateDiff-Evolved` + `comfyui-videohelpersuite`. Proven by `scripts/generate-animatediff-video.js`.
2. **Folder layout**: flat by job — `outputs/nsfw/images/<jobId>/` and `outputs/nsfw/video/<jobId>/`. No date nesting. Legacy `outputs/YYYY-MM-DD/` dirs stay in place and remain readable by history.

## Goals

- UI gains a `Media: [Image | Video]` choice; Video generates a short AnimateDiff mp4 through the same plan → confirm → poll → result lifecycle as images.
- Output dir becomes self-explanatory in Finder: `nsfw/images/` and `nsfw/video/`, with ComfyUI raw save files redirected under `raw/` subfolders instead of the output top level.

## Non-goals

- LTX-Video / HunyuanVideo / RunningHub cloud video (design leaves room via `mediaType` + plan-mode branching).
- HTTP range requests for video streaming (short local clips play fine on full 200 responses).
- Custom duration/frames UI control (tiers carry fixed mappings).
- Migrating existing `YYYY-MM-DD/` output dirs.
- Video in `comfy` (RH workflow) or `standard` modes — guarded with a clear 400.

## Current state (relevant facts)

- `outputs/` is a symlink → `/Volumes/SamsungT7/pinokio/api/comfy.git/app/output`. Jobs land in `outputs/YYYY-MM-DD/<jobId>/{plan.json,metadata.json,image.png}` (`src/lib/output-store.ts`).
- Local image mode: `buildLocalWorkflow` (`src/lib/local-plan.ts:68`) writes SaveImage with `filename_prefix: nsfw-app-<style>` → raw files pile up at the ComfyUI output top level; `/api/status` later downloads the file via ComfyUI `/view` into the job dir.
- `listHistory` / `findRunDirByJobId` treat every visible dir under `outputs/` as a day dir; dotfiles (`._*` AppleDouble) already filtered by `isVisibleEntry`.
- VHS_VideoCombine results appear in ComfyUI history under `gifs[]`, not `images[]` (see `scripts/generate-animatediff-video.js:148`).
- UI: `src/app/page.tsx` — Style/Aspect/Quality chip rows, `[ Plan ]` → plan card → Confirm Generate → 8s status poll → `<img>` preview via `/api/image?jobId=`; prefs persisted via `src/lib/nsfw-defaults.ts`.

## Data model (`src/lib/types.ts`)

```ts
export type MediaType = 'image' | 'video'
```

- `PlanRequest.mediaType?: MediaType` — absent means `'image'` (old callers unaffected).
- `PlanSnapshot.mediaType?: MediaType` — absent means `'image'` (old `.plans/*.json` readable).
- `RunMetadata.mediaType?: MediaType` and `RunMetadata.videoFile?: string` (parallel to `imageFile`).
- Normalization happens at read time with `?? 'image'`; no migration of old files.
- `ApiMode` unchanged: video is `mode: 'local-comfy'` + `mediaType: 'video'`, route stays `'local/comfyui'`.

## Storage layout (`src/lib/output-store.ts`)

New on-disk shape:

```
outputs/  (symlink → ComfyUI output)
  nsfw/
    images/
      <jobId>/{plan.json, metadata.json, image.png}
      raw/            # ComfyUI SaveImage raw files (redirected)
    video/
      <jobId>/{plan.json, metadata.json, video.mp4}
      raw/            # VHS_VideoCombine raw mp4s (redirected)
  YYYY-MM-DD/         # legacy job dirs — untouched, still read
```

Changes:

- `outputDirForJob(jobId, mediaType)` → `outputs/nsfw/<images|video>/<jobId>/`.
- `initJobDir(jobId, plan, taskId)` reads `plan.mediaType ?? 'image'` — signature unchanged.
- `finalizeSuccess(dir, meta, fileUrl, usage?)` picks the filename from `meta.mediaType`: `video.mp4` + `meta.videoFile`, or `image.png` + `meta.imageFile`. `downloadImage` is a generic byte fetch and works for mp4 unchanged.
- Legacy day-dir detection becomes explicit: only names matching `/^\d{4}-\d{2}-\d{2}$/` are treated as day dirs (prevents `nsfw/` being scanned as one).
- `listHistory(limit, root?)` scans `nsfw/images/*`, `nsfw/video/*`, and legacy day dirs; skips `raw/` entries and dotfiles. `findRunDirByJobId(jobId, root?)` directly probes `nsfw/images/<jobId>`, `nsfw/video/<jobId>`, then day dirs (newest first). The optional `root` param (default `outputsRoot()`) is the test seam.
- Job dirs never collide with `raw/`: `raw` contains no `metadata.json`, and is skipped explicitly regardless.

## Planner (`src/lib/router.ts`, `src/lib/local-plan.ts`)

`createPlan` guard, before backend dispatch:

```ts
const mediaType = request.mediaType ?? 'image'
if (mediaType === 'video' && process.env.BACKEND?.trim() !== 'local') {
  throw new Error('Video generation requires BACKEND=local (AnimateDiff runs on your local ComfyUI).')
}
```

The `/api/plan` route must return this as **400** with the message (verify its error mapping during implementation; only `LocalComfy:`-prefixed errors map to 503 today).

`createLocalPlan` branches on `mediaType`:

**Image** — as today, one change: SaveImage `filename_prefix` becomes `nsfw/images/raw/nsfw-app-<style>`. ComfyUI treats `/` in the prefix as subfolders; history entries then carry `subfolder: 'nsfw/images/raw'`, which the existing `buildViewUrl` already appends to `/view`.

**Video** — new `buildLocalVideoWorkflow(request, enhanced)`:

| Input | Mapping |
|---|---|
| Checkpoint | `LOCAL_VIDEO_CKPT` env override, default `realisticVisionV51_v51VAE.safetensors` |
| Motion module | `LOCAL_VIDEO_MOTION` env override, default `mm_sd_v15_v2.ckpt` |
| Aspect `1:1` | 512×512 |
| Aspect `9:16`, `2:3`, `3:4` | 512×768 |
| Aspect `16:9`, `3:2`, `4:3` | 768×512 |
| Tier `low` | 16 frames, 16 steps (~2s) |
| Tier `medium` | 24 frames, 20 steps (~3s) |
| Tier `high` | 32 frames, 24 steps (~4s) |
| Fixed | cfg 7.5, fps 8, `dpmpp_2m` + karras, denoise 1, random seed |

Constants: `VIDEO_PROMPT_PREFIX = 'masterpiece, best quality, photorealistic, '`; `VIDEO_NEGATIVE_EXTRA = 'static, no motion, flickering, jumpy motion, lowres'` appended to `DEFAULT_NEGATIVE`. Positive text = `VIDEO_PROMPT_PREFIX + enhanced` (the existing style suffix from `enhancePrompt` still applies; style does **not** change the video checkpoint — SD1.5 only).

Graph (ported from `scripts/generate-animatediff-video.js`):

```
4  CheckpointLoaderSimple        ckpt_name = <videoCkpt>
6  ADE_AnimateDiffLoaderGen1     model=[4,0], model_name=<motion>, beta_schedule='sqrt_linear (AnimateDiff)'
5  EmptyLatentImage              batch_size=<frames>, width, height
7  CLIPTextEncode (positive)     text=VIDEO_PROMPT_PREFIX+enhanced, clip=[4,1]
8  CLIPTextEncode (negative)     text=DEFAULT_NEGATIVE+VIDEO_NEGATIVE_EXTRA, clip=[4,1]
3  KSampler                      model=[6,0], pos=[7,0], neg=[8,0], latent=[5,0], seed, steps, cfg
9  VAEDecode                     samples=[3,0], vae=[4,2]
10 VHS_VideoCombine              images=[9,0], frame_rate=8, loop_count=0,
                                 filename_prefix='nsfw/video/raw/nsfw-video',
                                 format='video/h264-mp4', pingpong=false, save_output=true
```

Video plan snapshot: `mediaType: 'video'`, `mode: 'local-comfy'`, `modelLabel: 'Local AnimateDiff (<ckpt> + <motion>)'`, `estimatedPrice: 0`, `localGraph` as above, reason string includes frames/steps/approx duration.

## Routes

- `/api/plan` — passes `mediaType` through; guard above → 400.
- `/api/generate` — unchanged (submits `plan.localGraph`).
- `/api/status` — unchanged flow; `finalizeSuccess` handles mp4 via `meta.mediaType`.
- `src/lib/local-comfy.ts` `getHistoryResult` — on `success`, also scan `nodeOutput.gifs[]` when `images[]` is empty; returns the first ref either way (same `ComfyImageRef` shape). Empty both → `FAILED: 'LocalComfy succeeded but produced no output file'`.
- `/api/image` — serves `meta.imageFile ?? meta.videoFile` from the job dir; content-type by extension (`image/png` / `video/mp4`). One route feeds both `<img>` and `<video>`.
- `/api/history`, `/api/reveal` — unchanged (both ride on `listHistory`/`findRunByJobId`).

## UI (`src/app/page.tsx`, `src/lib/nsfw-defaults.ts`)

- New `MEDIA_TYPES` chip row (`Image` / `Video`) above the Style row; `mediaType` state persisted in stored prefs (default `'image'`).
- `mediaType === 'video'`: Style row hidden (AnimateDiff is SD1.5-realistic only); Aspect ratio and Quality stay, with their video meanings shown in the plan card. Note: the hidden style value is still sent to the API and still contributes its `enhancePrompt` suffix — always visible in the plan card's enhanced prompt. This is deliberate (keeps `PlanRequest` whole); the plan review step makes it transparent.
- `handlePlan` body gains `mediaType`.
- Plan card (video): model label, frames/steps/approx duration, ¥0.
- Result preview: `<video controls src="/api/image?jobId=…">` when the previewed job's metadata has `mediaType === 'video'`; `<img>` otherwise.
- History dropdown labels gain a `· image` / `· video` suffix (no emoji).

## Error handling

- Video + `BACKEND≠local` → 400 at plan time with an explicit message (no silent fallback to image).
- Missing AnimateDiff custom nodes / motion module → ComfyUI submit or execution error surfaces through the existing `LocalComfy:` conventions (502 at generate, FAILED at status with `extractComfyError`). No new code.
- SamsungT7 unmounted → identical behavior to today (mkdir/readdir failures surface as 500s).
- High-tier video runs ~5–10 min; the existing 8s UI poll has no timeout and needs none.
- `raw/` never appears in history (no `metadata.json` + explicit skip).

## Testing

Colocated vitest, env save/restore in `beforeEach`/`afterEach` per repo convention.

- `src/lib/local-plan.test.ts` (extend): video graph node shapes (ADE node + motion name, `batch_size` per tier, dimension buckets per aspect, VHS prefix `nsfw/video/raw/nsfw-video`, negative contains extras); `LOCAL_VIDEO_CKPT` / `LOCAL_VIDEO_MOTION` overrides; image SaveImage prefix now `nsfw/images/raw/…`.
- `src/lib/router.test.ts` (extend): `mediaType` passthrough to `createLocalPlan`; video + `BACKEND` unset → throws the guard error; video + `RH_WORKFLOW_ID` set → throws; absent `mediaType` → image plan.
- `src/lib/output-store.test.ts` (new, uses the `root` seam + tmp dirs): `initJobDir` routes to `nsfw/images` vs `nsfw/video`; `listHistory` merges media dirs + legacy day dirs, skips `raw/` and `._*`; `findRunDirByJobId` finds jobs in all three roots.
- `src/lib/local-comfy.test.ts` (new, mock fetch): `getHistoryResult` returns a `gifs[]` ref on video success; `images[]` still preferred when present; error path intact.
- `npx tsc --noEmit` and `npm run build` clean.

Manual end-to-end (BACKEND=local, ComfyUI running):

1. Image job → lands in `outputs/nsfw/images/<jobId>/image.png`; raw file under `nsfw/images/raw/`; nothing new at output top level.
2. Low-tier video job → `outputs/nsfw/video/<jobId>/video.mp4`, plays in the UI `<video>` element; raw mp4 under `nsfw/video/raw/`.
3. History lists both jobs with the correct media tag; a pre-change `YYYY-MM-DD` run still appears and previews.
4. Reveal opens the correct folder for a video job.

## Files touched

- `src/lib/types.ts`, `src/lib/router.ts`, `src/lib/local-plan.ts`, `src/lib/local-comfy.ts`, `src/lib/output-store.ts`, `src/lib/nsfw-defaults.ts`
- `src/app/api/image/route.ts`, `src/app/page.tsx`
- Tests: extend `local-plan.test.ts`, `router.test.ts`; new `output-store.test.ts`, `local-comfy.test.ts`
- `AGENTS.md` — Architecture section: new output layout + video mode + `LOCAL_VIDEO_*` env vars
- This doc

## Future extensions (enabled, not built)

- LTX-Video / RunningHub video as new plan branches keyed on `mediaType: 'video'` + mode.
- `<video>` range streaming if clips get long.
- Frames/duration UI control overriding the tier mapping.
