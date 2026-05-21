# RunningHub NSFW Image Generator (local)

Single-user Next.js app: plan a RunningHub text-to-image route (with estimated price), confirm, poll until the image finishes, and save artifacts under `./outputs/`. Intended for **local Mac use only** (`npm run dev`). See [`docs/superpowers/specs/2026-05-21-runninghub-nsfw-generator-design.md`](docs/superpowers/specs/2026-05-21-runninghub-nsfw-generator-design.md) for architecture and API contracts.

## Prerequisites

- Node.js 18+ (align with your Next.js 15 toolchain)
- A RunningHub API key ([RunningHub console](https://www.runninghub.cn)) with membership that allows price preview and generation

## Setup

```bash
cp .env.example .env.local
# Edit .env.local: set RH_API_KEY from RunningHub API console (server-side only).

npm install
npm run dev
```

Open http://localhost:3002 (dev server uses port 3002 by default).

**API key tier:** Standard Model APIs (全能图片G-2 text-to-image) require an **Enterprise-Shared** RunningHub API key. Consumer keys return error `1014`; the app shows this when you click **Plan**.

Use **Plan** → review the card → **Confirm** to generate.

Production-style run (after build):

```bash
npm run build
npm run start
```

Without `RH_API_KEY`, plan/generate routes return an error JSON (typically **503**) with a message that mentions the missing key — fix by adding the variable to `.env.local` and restarting the dev server.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Next.js dev server on port **3002** |
| `npm run build` | Production build |
| `npm run start` | Serve production build (after `build`) |
| `npm run lint` | ESLint via Next.js |
| `npm test` | Router / unit tests (Vitest) |

## Outputs folder

Runs are stored on disk under `outputs/` (directory is gitignored). Each completed or in-progress job lives at:

```text
outputs/YYYY-MM-DD/<jobId>/
├── metadata.json   # job id, timestamps, prompts, route, status, paths, usage when available
├── plan.json       # snapshot of the plan used for this run
└── image.png       # present after a successful generation
```

**History** in the UI is built by scanning `./outputs/**/metadata.json`. Plan snapshots awaiting confirmation live under `./.plans/` (also gitignored) with a short TTL.

## Quick API smoke test (optional)

With the dev server running and a valid key:

```bash
curl -sS -X POST http://localhost:3002/api/plan \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"test","style":"realistic","aspectRatio":"1:1","qualityTier":"medium"}'
```

Expect JSON with `planId`, `modelLabel`, `estimatedPrice`, and related fields — or an error payload if the key or network/API is unavailable.
