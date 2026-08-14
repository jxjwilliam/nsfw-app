# Deploy to Vercel with RunningHub (no local ComfyUI)

Brief runbook for deploying this app to Vercel using only the RunningHub
backends (Standard Model and/or RunningHub ComfyUI workflow mode). The app
is already Vercel-aware — storage paths switch to `/tmp` when `VERCEL=1` — so
successful images are mirrored to Cloudflare R2 as flat media files, which is
what keeps them after a cold start. No further code changes are required to
deploy.

## Prerequisites

- The repo pushed to GitHub (`.env.local`, `outputs/`, and the
  `local-comfyui/checkpoints/` symlink are gitignored and won't deploy).
- A Vercel account (import the GitHub repo; framework auto-detects Next.js).
- A RunningHub account and API key from
  [runninghub.cn](https://www.runninghub.cn).
- A Cloudflare account with an R2 bucket named `nfsw` (recommended; keeps
  generated images after Vercel cold starts).
- If using ComfyUI workflow mode: import
  [`runninghub/workflows/sdxl-txt2img-api.json`](../runninghub/workflows/README.md),
  set an uncensored checkpoint, and run the workflow once in the RunningHub UI
  so it's saved (otherwise you'll hit error `810`).

## Environment variables

Set these in **Vercel Project Settings → Environment Variables** (Production,
Preview, and Development). `.env.local` is never used on Vercel.

| Variable | Required | Notes |
|---|---|---|
| `RH_API_KEY` | Yes | RunningHub API key (server-side only). Standard Model mode needs an **Enterprise-Shared** key. |
| `RH_WORKFLOW_ID` | Recommended | Numeric workflow ID from the RunningHub workflow URL. Enables ComfyUI workflow mode, which **bypasses the G-2 text filter** (important for this app's use case). |
| `RH_WORKFLOW_PROMPT_NODE` / `RH_WORKFLOW_NEGATIVE_NODE` / `RH_WORKFLOW_SIZE_NODE` / `RH_WORKFLOW_SAMPLER_NODE` | No | Node overrides, only if your exported workflow JSON differs from the defaults. |
| `R2_ACCESS_KEY_ID` | For R2 | Access Key ID from a Cloudflare **Account** API token. |
| `R2_SECRET_ACCESS_KEY` | For R2 | Secret Access Key from the same token. |
| `R2_ACCOUNT_ID` | For R2 | Cloudflare account ID (the `<account-id>` in `dash.cloudflare.com/<account-id>/...`). |
| `R2_BUCKET_NAME` | No | R2 bucket name, defaults to `nfsw`. |
| `R2_ENDPOINT` | No | Optional custom S3-compatible endpoint; defaults to `https://<account-id>.r2.cloudflarestorage.com`. |
| `R2_ENABLED` | No | Set `true` only to enable R2 outside Vercel (local testing). On Vercel, R2 is enabled automatically once credentials are present. |
| `KV_REST_API_URL` | Recommended | From the KV store's "Connect Project" env vars (see Vercel KV section). |
| `KV_REST_API_TOKEN` | Recommended | From the same place. |

Do **not** set `BACKEND=local` or `LOCAL_COMFY_URL` — there is no local ComfyUI
behind Vercel, and local mode will fail with `LocalComfy:` errors. `PORT` is
ignored on Vercel, and the `DEEPSEEK_*` / `KIMI_*` / `DASHSCOPE_*` keys are only
used by local scripts, not the deployed app.

## Cloudflare R2 bucket

R2 keeps generated media durable on Vercel. The app stores **only media
files** in the bucket — flat keys like `media-<jobId>.png`, no folders, no
timestamps, and no `metadata.json` — so browsing the `nfsw` bucket shows
images/videos only. Run records stay in local `/tmp` (see the storage caveat
in Notes & caveats).

### One-time setup

1. **Create the bucket.** In the Cloudflare dashboard go to **R2 → Create
   bucket** and name it `nfsw` (or set `R2_BUCKET_NAME` to the name you pick).
2. **Create an Account API token** — **R2 → Manage API Tokens → Create Account
   API token**. The **Account** token is recommended over a User token for
   Next.js/production: it's scoped to the account (persists even if your user
   account leaves or changes roles in the org) and can be locked down to a
   single bucket.
   - Name it, e.g. `nextjs-nfsw-uploader`.
   - Permissions: **Object Read & Write** (or **Admin Read & Write** if you'll
     manage bucket rules via API).
   - Under **Specify bucket(s)**, target only the `nfsw` bucket.
   - Click **Create API Token** and immediately save the **Access Key ID** and
     **Secret Access Key**.
3. **Add the env vars** from the table above in Vercel Project Settings:
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` (the
   `<account-id>` in `dash.cloudflare.com/<account-id>/...`), and
   `R2_BUCKET_NAME=nfsw`. `R2_ENDPOINT` is only needed for a custom
   S3-compatible endpoint. Keep the same values in `.env.local` if you want
   them in one place — local dev won't use them unless `R2_ENABLED=true`.
4. **Redeploy** so the new env vars take effect, then run one generation.

### Verify

- After a successful run, open **R2 → nfsw** — you should see one
  `media-<uuid>.png` object per run, nothing else.
- CLI check (optional), with the credentials configured for the S3 CLI:

  ```bash
  aws s3 ls s3://nfsw --endpoint-url https://<account-id>.r2.cloudflarestorage.com
  ```

### Local behavior

R2 only activates on Vercel (`VERCEL=1`) or when you explicitly set
`R2_ENABLED=true`. Local ComfyUI on port 4000 is completely unaffected — it
keeps writing to `outputs/` exactly as before.

## Vercel KV (recommended)

Without durable state, `/api/status` can return **404 "job not found"**:
Vercel routes each request to any serverless instance, and the job record
lives only in that instance's memory and `/tmp`. Vercel KV fixes this by
storing plan and job records (with TTLs) so any instance can resume a poll —
including the Plan → Confirm hop.

Setup:

1. In the Vercel dashboard, open the project → **Storage** → **Create
   Database** → choose **KV**.
2. Name it (e.g. `nsfw-app-kv`), pick a region (default is fine), and create
   it.
3. On the store page, Vercel generates `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` (plus `KV_URL`, only needed by the SDK). Click
   **Connect Project**, select this project and the environments you want —
   Vercel adds the two vars automatically. Or copy them into Project Settings
   → Environment Variables manually (values without quotes).
4. Redeploy Production so the env vars take effect.

The app uses KV automatically when those vars are present; without them it
falls back to the old per-instance behavior (fine locally, flaky on Vercel).

## Deploy steps

1. Import the repo in Vercel (Framework Preset: **Next.js**; Build Command:
   `npm run build` — the defaults work).
2. Add the env vars above.
3. Deploy. `next build` does not need `RH_API_KEY`, so the first build succeeds
   even before env vars are set.
4. Verify:
   - `GET /api/workflow-setup` returns `{ ok: true, workflowId, ... }` when
     `RH_WORKFLOW_ID` is set.
   - Run a prompt through Plan → Confirm → poll until the image shows.
   - Without `RH_API_KEY`, plan/generate return 503 (expected until configured).

## Notes & caveats

- **Storage.** With R2 configured, each successful run uploads only the media
  file to the `nfsw` bucket under a flat key like `media-<jobId>.png` — no
  folders, no timestamps, and no `metadata.json` in the bucket, so browsing R2
  shows images/videos only. After a cold start wipes `/tmp`, `/api/image`
  still serves the file from R2 (the key is derived from `jobId`), but
  `/api/history` only shows runs from the current instance and can be empty
  after a cold start — the run record was never stored in R2. With Vercel KV
  configured, plan snapshots and in-flight RUNNING jobs are durable across
  instances; without it they are per-instance (`/tmp`). If the R2 upload
  fails, the run still finishes locally and `persistError` is recorded in
  local metadata rather than failing the job.
- **`/api/reveal` is macOS-only** (opens Finder) and returns 501 on Vercel —
  expected, not a deployment failure.
- **Content safety.** ComfyUI workflow mode bypasses G-2; Standard Model mode
  does not (explicit prompts return error `1501`). Choose `RH_WORKFLOW_ID`
  mode for this app.
- **Billing.** The plan card shows ¥0 in workflow mode, but RunningHub still
  bills your account balance per run.
- **No auth.** The app is single-user with no login. Anyone with the deployed
  URL can spend your RunningHub balance. Keep the deployment private or add
  auth before sharing it.
- **Latency (optional).** Vercel functions default to `iad1` (US East) while
  RunningHub is China-hosted. For closer proximity, you can pin route handlers
  with `export const config = { regions: ['hkg1'] }` (check Vercel's current
  region list). Each `/api/status` poll is a single quick RunningHub query, so
  function duration limits aren't a concern — the UI drives the polling.
