# Scripts

Four local tools for the image/video generation pipeline. All Node scripts
talk to the local ComfyUI (`COMFYUI_URL`, default `http://localhost:8188`).

| Script | What it does | When to use |
|--------|--------------|-------------|
| [`generate-nsfw-workflows.js`](#1-generate-nsfw-workflowsjs) | Batch-generate dated NSFW workflow JSONs, one per SDXL checkpoint | Refresh the image workflows in `local-comfyui/workflows/` |
| [`run-workflows.js`](#2-run-workflowsjs) | Submit workflow JSONs to local ComfyUI and optionally copy outputs | Fire the generated image workflows |
| [`start_comfyui_m3.sh`](#3-start_comfyui_m3sh) | Launch ComfyUI with M3 Pro 18GB-friendly flags | Start the backend (also `make start` / `make start-lowvram`) |
| [`generate-animatediff-video.js`](#4-generate-animatediff-videojs) | Build/submit/poll one AnimateDiff short video, report the mp4 | Generate a short NSFW-capable video |
| [`generate-image-workflows.js`](#5-generate-image-workflowsjs) | Offline generator for API-format image workflows (14 checkpoints, curated prompts) | Regenerate `img_*.api.json` without LLM keys |
| [`generate-ltx-video.js`](#6-generate-ltx-videojs) | LTX-Video T2V/I2V short-video generator; copies mp4 to the outputs folder | Higher-quality short videos than AnimateDiff |
| [`run-all-workflows.js`](#7-run-all-workflowsjs) | Batch runner: submits every API-format workflow, waits, copies outputs, Telegram summary | The one command Hermes/cron/Telegram triggers |

Common prerequisites: ComfyUI running on 8188, checkpoints present
(SDXL for images; **SD1.5** + `mm_sd_v15_v2.ckpt` motion module for videos).

Default output destination for generated files (both new scripts):
`/Users/william.jiang/Samsung/playground-2026/comfyui/outputs/` (images under
`images/`, videos under `videos/`). ComfyUI's own `output/` keeps the raw
files; the scripts copy the finished artifacts there. Override with
`NSFW_OUT_DIR` or `--out`.

---

## 1. generate-nsfw-workflows.js

Generates image workflows for the 5 SDXL checkpoints in `CHECKPOINTS`
(iniverseMix, pony, xxmix9, juggernaut, realvisxl) and writes them to
`local-comfyui/workflows/<checkpoint>-MMDD-1.json`.

For each checkpoint it randomly picks **DeepSeek, Kimi (Moonshot), or Qwen**
(any one configured key suffices) to write an NSFW positive prompt, falling
back to the next provider if the first fails or returns empty, then wraps the
result in the fixed workflow skeleton (832×1216, per-model tuning: Pony gets
`score_9...` style tags, the Lightning model uses 6 steps + cfg 3.0, the rest
28 steps).

```bash
node scripts/generate-nsfw-workflows.js   # no args; runs all 5 checkpoints
```

Needs at least one key in `.env.local` (the script loads it itself via
dotenv): `DEEPSEEK_API_KEY`, `KIMI_API_KEY`, or `DASHSCOPE_API_KEY`.
Overrides: `DEEPSEEK_MODEL` (default `deepseek-v4-flash`), `KIMI_MODEL`,
`QWEN_MODEL`, `*_BASE_URL`, `COMFYUI_URL`.

Output is **script-generated — do not hand-edit** `local-comfyui/workflows/`;
rerun the script to refresh.

## 2. run-workflows.js

Submits API-format workflow JSON files to local ComfyUI:

```bash
node scripts/run-workflows.js                      # runninghub/workflows/ folder
node scripts/run-workflows.js --source=generated   # local-comfyui/workflows/ folder
node scripts/run-workflows.js --source=all         # both
node scripts/run-workflows.js --output=./outputs   # copy saved images after success
node scripts/run-workflows.js --delay=2000         # ms between submissions
```

Env: `COMFYUI_URL`, `COMFYUI_OUTPUT` (where ComfyUI saves files; defaults to
the SamsungT7 output dir). Expects **API-format** JSON — both
`runninghub/workflows/` (hand-written, primarily for RunningHub import) and
`local-comfyui/workflows/` (script-generated) qualify. No argument =
`--source=workflows`.

## 3. start_comfyui_m3.sh

M3 Pro 18GB ComfyUI launcher. Copy it into the ComfyUI root (where `main.py`
lives) and run from there:

```bash
./start_comfyui_m3.sh
```

It refuses to run outside the ComfyUI directory and applies 18GB-friendly
flags (`--force-fp16 --lowvram --use-pytorch-cross-attention`). Equivalent
one-liners from the repo root: `make start`, `make start-lowvram`.

## 4. generate-animatediff-video.js

One-shot AnimateDiff short-video generator: builds the workflow, submits to
ComfyUI, polls until done, and prints/copies the mp4.

```bash
# defaults: RV V5.1 (SD1.5) · 512×512 · 16 frames @ 8fps · 20 steps · cfg 7.5
node scripts/generate-animatediff-video.js

# custom run with output copy:
node scripts/generate-animatediff-video.js \
  --prompt="a woman dancing in a bedroom" \
  --width=512 --height=768 --frames=16 --steps=24 --seed=42 --out=./outputs
```

Options: `--prompt --negative --ckpt --motion --frames --width --height
--steps --cfg --fps --prefix --seed --out --timeout`. Full docs and gotchas
(AppleDouble files, loader schema, frames = latent batch) in
[`local-comfyui/workflows/video/README.md`](../local-comfyui/workflows/video/README.md).

## 5. generate-image-workflows.js

Offline, deterministic image-workflow generator — no LLM API keys needed.
Writes one API-format workflow per supported checkpoint
(`local-comfyui/workflows/img_<slug>.api.json`), covering 14 checkpoints
(SDXL, SDXL-Turbo, Lightning, SD1.5) with curated NSFW prompts and per-model
steps/CFG/resolution:

```bash
node scripts/generate-image-workflows.js                # all 14
node scripts/generate-image-workflows.js --ckpt=pony    # one model
node scripts/generate-image-workflows.js --list         # config table
node scripts/generate-image-workflows.js --prompt="..." --seed=42
```

Then submit with `node scripts/run-workflows.js --source=generated` or run a
single file via the ComfyUI API. The prompt presets are just defaults —
override with `--prompt` / `--negative` for full control.

## 6. generate-ltx-video.js

One-shot LTX-Video generator (native ComfyUI support, no custom video node
needed beyond VHS). Uses `ltx-video-2b-v0.9.5.safetensors` +
`t5xxl_fp8_e4m3fn_scaled.safetensors` (type `ltxv`) + the extracted LTX VAE
(`ltx-video-2b-v0.9.5-vae.safetensors` in models/vae). Text-to-video by
default; image-to-video with `--mode=i2v`.

```bash
# default: 512x768 portrait, 49 frames (~2s @ 24fps), 30 steps, cfg 3
node scripts/generate-ltx-video.js --prompt="..."

# image-to-video from a first frame (auto-uploads the image)
node scripts/generate-ltx-video.js --mode=i2v --image=./frame.png --prompt="..."

# tweaks
node scripts/generate-ltx-video.js --width=768 --height=512 --frames=33 --steps=20
node scripts/generate-ltx-video.js --seed=42 --out=./outputs
```

Options: `--mode --image --prompt --negative --width --height --frames
--steps --cfg --sampler --te --fps --prefix --seed --out --timeout`.
`--frames` must satisfy `frames ≡ 1 (mod 8)` (LTX constraint). The finished
mp4 is copied to `/Users/william.jiang/Samsung/playground-2026/comfyui/
outputs/videos/` by default. On the 18GB M3 start at 512x512–512x768 and
49–65 frames; VAE decode is the memory-heavy part.

## 7. run-all-workflows.js — the one-command batch runner

Scans `local-comfyui/workflows/` (recursively), runs every API-format
workflow sequentially against ComfyUI, waits for each to finish, copies
outputs, and (optionally) sends a Telegram summary. UI-format JSONs are
skipped automatically; image-to-video workflows are skipped unless
`--i2v-image` is given.

```bash
# everything → ~/Samsung/playground-2026/comfyui/outputs/{images,videos}
node scripts/run-all-workflows.js --notify=telegram

# variants
node scripts/run-all-workflows.js --dry-run          # show what would run
node scripts/run-all-workflows.js --only=images
node scripts/run-all-workflows.js --pattern=pony
node scripts/run-all-workflows.js --i2v-image=./frame.png
node scripts/run-all-workflows.js --background       # detach + log to logs/
```

Reports land in `logs/comfyui-run-<timestamp>.json` (gitignored). Full run on
the M3 takes ~15–25 min (20 images + 2 videos). For the Telegram flow see
`../hermes/comfyui-nsfw/SKILL.md` — Hermes triggers this script in the
background and it notifies the Telegram DM on completion (`hermes send`).
